import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { TAMANHO_MINIMO_DO_TOKEN_DE_VISITANTE } from '@autoconnect/shared';
import { ChatEventosService } from '../../gateway/chat-eventos.service';
import { EmailService } from '../../common/email/email.service';
import {
  hashDoToken, hashesIguais, linkDoVisitante, novoTokenDeVisitante,
} from './visitante';

/** Últimas mensagens e dados do veículo, iguais nas duas listagens. */
const RESUMO = {
  vehicle: {
    select: {
      id: true, versionName: true, yearModel: true,
      brand: { select: { name: true } },
      model: { select: { name: true } },
      images: { where: { isCover: true }, take: 1, select: { url: true } },
    },
  },
  messages: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { body: true, createdAt: true, kind: true },
  },
};

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    /**
     * Consolidado da plataforma para o super admin — e o **único** lookup sem
     * contexto do caminho do visitante: achar a loja da conversa a partir do
     * token. Mesma forma do webhook de assinatura, que resolve o tenant do
     * envelope antes de trabalhar dentro dele.
     */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly eventos: ChatEventosService,
    private readonly email: EmailService,
  ) {}

  /** Lista conversas de uma concessionária */
  async findAllByTenant(escopo: Escopo, opts: { status?: string; page?: number }): Promise<unknown> {
    const { status, page = 1 } = opts;
    const take = 20;
    const skip = (page - 1) * take;

    const where = {
      ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }),
      ...(status ? { status: status as never } : {}),
    };

    const consultar = async (tx: ScopedClient) => {
      const [items, total] = await Promise.all([
        tx.conversation.findMany({
          where,
          skip,
          take,
          orderBy: { lastMessageAt: 'desc' },
          include: {
            customer:    { select: { id: true, fullName: true, email: true, avatarUrl: true } },
            salesperson: { select: { id: true, fullName: true, email: true } },
            vehicle:     RESUMO.vehicle,
            messages:    RESUMO.messages,
          },
        }),
        tx.conversation.count({ where }),
      ]);

      return { items, total, page, perPage: take };
    };

    return ehGlobal(escopo)
      ? consultar(this.privilegiado)
      : this.prisma.withTenant(escopo.tenantId, consultar);
  }

  /** Lista conversas de um cliente (todas as lojas) */
  async findAllByCustomer(customerUserId: string, opts: { status?: string; page?: number }): Promise<unknown> {
    const { status, page = 1 } = opts;
    const take = 20;
    const skip = (page - 1) * take;

    const where = {
      customerUserId,
      ...(status ? { status: status as never } : {}),
    };

    // Atravessa concessionárias de propósito — o cliente conversa com várias
    // lojas. Quem isola é `app.user_id`, pela policy `acesso_cliente`.
    return this.prisma.withUser(customerUserId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.conversation.findMany({
          where, skip, take,
          orderBy: { lastMessageAt: 'desc' },
          include: {
            tenant:      { select: { id: true, tradeName: true, logoUrl: true } },
            salesperson: { select: { id: true, fullName: true } },
            vehicle:     RESUMO.vehicle,
            messages:    RESUMO.messages,
          },
        }),
        tx.conversation.count({ where }),
      ]);

      return { items, total, page, perPage: take };
    });
  }

  /** Mensagens de uma conversa */
  async getMessages(tenantId: string | null, userId: string, conversationId: string): Promise<unknown> {
    const buscar = async (tx: Parameters<Parameters<PrismaService['withUser']>[1]>[0]) => {
      const conv = await tx.conversation.findFirst({
        where: {
          id: conversationId,
          OR: [
            ...(tenantId ? [{ tenantId }] : []),
            { customerUserId: userId },
            { salespersonId:  userId },
          ],
        },
      });
      if (!conv) throw new NotFoundException('Conversa não encontrada');

      return tx.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
      });
    };

    // O cliente não tem tenant; o vendedor tem. Cada um entra pelo seu contexto.
    return tenantId
      ? this.prisma.withTenant(tenantId, buscar)
      : this.prisma.withUser(userId, buscar);
  }

  /** Cria ou retorna conversa existente entre customer e tenant (por veículo) */
  async getOrCreate(customerUserId: string, tenantId: string, vehicleId?: string, leadId?: string): Promise<unknown> {
    // Quem inicia é o cliente, então o contexto é o dele.
    return this.prisma.withUser(customerUserId, async (tx) => {
      const existing = await tx.conversation.findFirst({
        where: {
          customerUserId,
          tenantId,
          ...(vehicleId ? { vehicleId } : {}),
          status: { not: 'closed' },
        },
      });
      if (existing) return existing;

      return tx.conversation.create({
        data: { customerUserId, tenantId, vehicleId: vehicleId ?? null, leadId: leadId ?? null },
      });
    });
  }

  /**
   * Lojista abre (ou retoma) conversa a partir de um lead — **com ou sem conta**.
   *
   * Antes, lead sem conta era recusado com 400, e a tela nem mostrava o botão.
   * O lead da Onda 0 nasce sem conta por definição: o chat que o produto
   * anuncia não existia para o lead que ele mesmo captura.
   *
   * Sem conta, a conversa nasce com o contato **copiado** (como o agendamento
   * sem conta) e com um link de acesso para o visitante. O link cru sai daqui
   * uma vez, em `linkDoVisitante`, e é o que a loja manda pelo WhatsApp — o
   * e-mail sai junto quando há endereço.
   */
  async getOrCreateFromLead(
    tenantId: string,
    salespersonId: string,
    leadId: string,
  ): Promise<unknown> {
    const resultado = await this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id: leadId, tenantId },
        select: {
          id: true, customerUserId: true, vehicleId: true,
          contactName: true, contactPhone: true, contactEmail: true,
        },
      });
      if (!lead) throw new NotFoundException('Lead não encontrado');

      const existente = await tx.conversation.findFirst({
        where: {
          tenantId,
          status: { not: 'closed' },
          ...(lead.customerUserId
            ? { customerUserId: lead.customerUserId }
            : { leadId: lead.id, customerUserId: null }),
        },
      });

      if (existente) {
        // garante que o vendedor fique atribuído
        const conversa = existente.salespersonId
          ? existente
          : await tx.conversation.update({
              where: { id: existente.id },
              data: { salespersonId },
            });
        return { conversa, token: null as string | null, email: null as string | null };
      }

      if (lead.customerUserId) {
        const conversa = await tx.conversation.create({
          data: {
            customerUserId: lead.customerUserId,
            tenantId,
            vehicleId: lead.vehicleId ?? null,
            leadId: lead.id,
            salespersonId,
          },
        });
        return { conversa, token: null as string | null, email: null as string | null };
      }

      // Sem conta: contato copiado + porta de entrada. A constraint
      // `conversations_tem_quem_responde` recusa um sem o outro, de propósito —
      // conversa sem conta e sem link seria uma caixa de saída sem destinatário.
      const { token, hash } = novoTokenDeVisitante();
      const conversa = await tx.conversation.create({
        data: {
          tenantId,
          customerUserId: null,
          leadId: lead.id,
          vehicleId: lead.vehicleId ?? null,
          salespersonId,
          contactName: lead.contactName,
          contactPhone: lead.contactPhone,
          contactEmail: lead.contactEmail,
          guestTokenHash: hash,
        },
      });
      return { conversa, token, email: lead.contactEmail };
    });

    if (resultado.token) {
      await this.avisarVisitante(tenantId, resultado.email, resultado.token);
    }

    return {
      ...resultado.conversa,
      /** Só na criação: o valor cru não é guardado. */
      guestUrl: resultado.token ? linkDoVisitante(resultado.token) : null,
    };
  }

  /**
   * Gera um link de acesso novo para o visitante e invalida o anterior.
   *
   * É o "reenviar convite" do chat: o hash é o que fica no banco, então o link
   * não pode ser mostrado duas vezes. A tela diz que o anterior deixa de valer.
   */
  async novoLinkDeVisitante(tenantId: string, conversationId: string): Promise<unknown> {
    const { token, hash } = novoTokenDeVisitante();

    const conversa = await this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.conversation.findFirst({
        where: { id: conversationId, tenantId },
        select: { id: true, customerUserId: true, contactName: true, contactEmail: true },
      });
      if (!atual) throw new NotFoundException('Conversa não encontrada');
      if (atual.customerUserId) {
        throw new BadRequestException(
          'Esta conversa é de um cliente com conta — ele entra pelo próprio login.',
        );
      }
      return tx.conversation.update({
        where: { id: conversationId },
        data: { guestTokenHash: hash },
        select: { id: true, contactEmail: true },
      });
    });

    await this.avisarVisitante(tenantId, conversa.contactEmail, token);

    return { id: conversa.id, guestUrl: linkDoVisitante(token) };
  }

  /**
   * Manda o link por e-mail quando há endereço.
   *
   * Falha de e-mail não derruba a abertura da conversa: a loja recebe o link na
   * própria tela para copiar, que é o caminho que uma revenda usa de fato
   * (WhatsApp). Mesmo princípio do contrato que é emitido sem ser arquivado.
   */
  private async avisarVisitante(
    tenantId: string,
    email: string | null,
    token: string,
  ): Promise<void> {
    if (!email) return;
    try {
      const loja = await this.prisma.withTenant(tenantId, (tx) =>
        tx.tenant.findUnique({ where: { id: tenantId }, select: { tradeName: true } }),
      );
      await this.email.sendConviteDeConversa({
        to: email,
        dealerName: loja?.tradeName ?? 'a concessionária',
        url: linkDoVisitante(token),
      });
    } catch {
      // Silencioso com motivo: o link está na tela da loja, e um provedor de
      // e-mail ausente não pode impedir a conversa de existir.
    }
  }

  /* ── O visitante sem conta ────────────────────────────────── */

  /**
   * Resolve a conversa a partir do token do link.
   *
   * O lookup por hash é o único passo privilegiado: não existe `app.tenant_id`
   * nem `app.user_id` antes de saber de quem é a conversa. Achada a loja, tudo
   * o mais roda dentro de `withTenant`.
   */
  private async conversaDoToken(token: string): Promise<{ id: string; tenantId: string }> {
    if (!token || token.length < TAMANHO_MINIMO_DO_TOKEN_DE_VISITANTE) {
      throw new NotFoundException('Conversa não encontrada');
    }
    const hash = hashDoToken(token);
    const conversa = await this.privilegiado.conversation.findFirst({
      where: { guestTokenHash: hash },
      select: { id: true, tenantId: true, guestTokenHash: true },
    });
    if (!conversa?.guestTokenHash || !hashesIguais(conversa.guestTokenHash, hash)) {
      throw new NotFoundException('Conversa não encontrada');
    }
    return { id: conversa.id, tenantId: conversa.tenantId };
  }

  /** A conversa e as mensagens, para a página pública do visitante. */
  async visitanteLe(token: string): Promise<unknown> {
    const { id, tenantId } = await this.conversaDoToken(token);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const conversa = await tx.conversation.findFirstOrThrow({
        where: { id, tenantId },
        select: {
          id: true, status: true, contactName: true, lastMessageAt: true,
          tenant: { select: { tradeName: true, logoUrl: true, slug: true, primaryPhone: true } },
          vehicle: RESUMO.vehicle,
          salesperson: { select: { fullName: true } },
        },
      });

      const mensagens = await tx.message.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, body: true, kind: true, createdAt: true, senderUserId: true,
          sender: { select: { fullName: true } },
        },
      });

      return {
        conversa,
        // `senderUserId` nulo é o próprio visitante: ele não tem usuário.
        mensagens: mensagens.map((m) => ({
          id: m.id,
          body: m.body,
          kind: m.kind,
          createdAt: m.createdAt,
          deLoja: m.senderUserId !== null,
          autor: m.senderUserId === null ? conversa.contactName : (m.sender?.fullName ?? null),
        })),
      };
    });
  }

  /** O visitante responde. Sem conta, sem anexo, sem proposta. */
  async visitanteEscreve(token: string, body: string): Promise<unknown> {
    const { id, tenantId } = await this.conversaDoToken(token);

    const mensagem = await this.prisma.withTenant(tenantId, async (tx) => {
      const conversa = await tx.conversation.findFirst({
        where: { id, tenantId },
        select: { id: true, status: true, contactName: true },
      });
      if (!conversa) throw new NotFoundException('Conversa não encontrada');
      if (conversa.status === 'closed') {
        throw new BadRequestException('Esta conversa foi encerrada pela loja.');
      }

      const criada = await tx.message.create({
        data: {
          conversationId: id,
          tenantId,
          // Sem usuário: é o visitante. É o que distingue os dois lados na tela.
          senderUserId: null,
          body,
          kind: 'text',
        },
        select: { id: true, body: true, kind: true, createdAt: true, senderUserId: true },
      });

      await tx.conversation.update({
        where: { id },
        data: {
          lastMessageAt: new Date(),
          customerLastMessageAt: new Date(),
          unreadCountSalesperson: { increment: 1 },
        },
      });

      return { ...criada, autor: conversa.contactName };
    });

    // O vendedor com a conversa aberta vê na hora; o visitante não tem socket.
    this.eventos.emitir(id, 'conversation:message', {
      ...mensagem,
      conversationId: id,
      tenantId,
      sender: null,
    });

    return {
      id: mensagem.id,
      body: mensagem.body,
      kind: mensagem.kind,
      createdAt: mensagem.createdAt,
      deLoja: false,
      autor: mensagem.autor,
    };
  }

  /** Fecha conversa */
  async close(tenantId: string, conversationId: string): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const conv = await tx.conversation.findFirst({ where: { id: conversationId, tenantId } });
      if (!conv) throw new NotFoundException('Conversa não encontrada');
      return tx.conversation.update({ where: { id: conversationId }, data: { status: 'closed' } });
    });
  }
}
