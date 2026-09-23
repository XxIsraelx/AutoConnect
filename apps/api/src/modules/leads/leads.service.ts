import {
  Injectable, Logger, NotFoundException, BadRequestException, ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { EmailService } from '../../common/email/email.service';
import {
  normalizarTelefoneBr,
  type CreateLeadInput,
  type UpdateLeadStatusInput,
  type LeadPublicoInput,
  type LeadManualInput,
  type LeadInteractionKind,
} from '@autoconnect/shared';
import { acharLeadDuplicado, registrarContatoRepetido } from './deduplicacao';
import { LimitePorIp, chaveDoEnvio } from './limite-por-ip';

/** Dados do e-mail de "lead novo", montados dentro da transação e enviados fora. */
interface AvisoDeLeadNovo {
  dealerEmail: string | null;
  dealerName: string;
  customerName: string;
  vehicleInfo: string;
  message: string | null;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    /** Consolidado da plataforma para o super admin. */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly email: EmailService,
    /**
     * Teto de envios do formulário público. Em memória, de processo — ver o
     * arquivo do limite para o porquê de não haver Redis nem CAPTCHA.
     */
    private readonly limitePublico: LimitePorIp,
  ) {}

  /** Cria um lead. O userId vem do token JWT (customer logado). */
  async create(
    userId: string,
    tenantId: string,
    input: CreateLeadInput,
  ): Promise<unknown> {
    const { lead, deduplicado, aviso } = await this.prisma.withTenantAndUser(
      tenantId,
      userId,
      async (tx) => {
    // Busca dados do cliente
    const customer = await tx.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true, phone: true },
    });
    if (!customer) throw new NotFoundException('Usuário não encontrado');

    // Busca dados da concessionária (para o e-mail)
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { tradeName: true, primaryPhone: true, branches: {
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { email: true },
      }},
    });
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');

    const vehicleInfo = await this.descreverVeiculo(tx, input.vehicleId ?? null);

    const contactEmail = input.contactEmail ?? customer.email;
    const contactPhone = input.contactPhone ?? customer.phone ?? null;

    // Mesmo o cliente logado passa pela deduplicação: é justamente ele que
    // clica em "tenho interesse" três vezes esperando resposta.
    const existente = await acharLeadDuplicado(tx, tenantId, { contactPhone, contactEmail });
    if (existente) {
      await registrarContatoRepetido(tx, {
        tenantId,
        leadId: existente.id,
        actorUserId: userId,
        vehicleId: input.vehicleId ?? null,
        vehicleIdAtual: existente.vehicleId,
        source: input.source,
        message: input.message ?? null,
        origem: 'cliente',
      });

      const lead = await tx.lead.findUniqueOrThrow({ where: { id: existente.id } });
      // Sem e-mail: a loja já foi avisada deste lead. Um aviso por clique
      // repetido treinaria o lojista a ignorar a caixa de entrada.
      return { lead, deduplicado: true, aviso: null };
    }

    const lead = await tx.lead.create({
      data: {
        tenantId,
        customerUserId: userId,
        vehicleId: input.vehicleId ?? null,
        branchId: input.branchId ?? null,
        contactName: input.contactName ?? customer.fullName,
        contactEmail,
        contactPhone,
        contactPhoneNormalized: normalizarTelefoneBr(contactPhone),
        source: input.source,
        message: input.message ?? null,
        status: 'new',
      },
    });

    await this.registrarCriacao(tx, tenantId, lead.id, userId, 'formulário do site');

    return {
      lead,
      deduplicado: false,
      aviso: {
        dealerEmail: tenant.branches[0]?.email ?? null,
        dealerName: tenant.tradeName,
        customerName: customer.fullName,
        vehicleInfo,
        message: input.message ?? null,
      } satisfies AvisoDeLeadNovo,
    };
      },
    );

    this.avisarLojaDeLeadNovo(aviso);

    return { ...lead, deduplicado };
  }

  /* ── Lead anônimo (formulário público) ─────────────────── */

  /**
   * Captura de lead **sem conta**: o visitante preenche o formulário do
   * catálogo ou da página da loja e vira lead.
   *
   * Sobre o contexto de RLS — é a decisão mais delicada desta rota:
   *
   *  1. a resolução da loja roda em `withPublic`, **sem** `app.tenant_id`.
   *     Sobra a policy `leitura_publica`, que é o que já está na vitrine:
   *     veículo `available` e loja ativa. É de onde o `tenantId` sai;
   *  2. a gravação roda em `withTenant(tenantId)`, porque `leads` só tem
   *     `tenant_isolation` — em `withPublic` o INSERT seria recusado pelo
   *     `WITH CHECK`, e essa recusa é a proteção, não um obstáculo.
   *
   * O `tenantId` usado no passo 2 **nunca** é o do corpo quando há veículo: é o
   * do veículo, lido do banco. Se o corpo trouxer outro, a requisição é
   * recusada com 404 — confirmar "esse veículo não é dessa loja" já é contar
   * mais do que um visitante precisa saber.
   */
  async criarPublico(
    input: LeadPublicoInput,
    ip: string,
  ): Promise<{ ok: true; deduplicado: boolean; leadId: string | null }> {
    // Honeypot: campo escondido que só um robô preenche. A resposta é a mesma
    // de sucesso, de propósito — dizer "detectei" ensina a contornar.
    if (input.website && input.website.trim() !== '') {
      this.logger.warn(`Formulário público descartado pelo honeypot (ip ${ip})`);
      return { ok: true, deduplicado: false, leadId: null };
    }

    const { tenantId, vehicleId } = await this.resolverLojaPublica(input);

    if (!this.limitePublico.permitir(chaveDoEnvio(ip, tenantId, vehicleId))) {
      throw new ConflictException(
        'Recebemos seu contato há pouco. A loja já foi avisada e vai responder em breve.',
      );
    }

    const contactEmail = input.contactEmail?.trim() || null;

    const { deduplicado, leadId, aviso } = await this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: {
          tradeName: true,
          branches: {
            where: { isActive: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { email: true },
          },
        },
      });
      if (!tenant) throw new NotFoundException('Concessionária não encontrada');

      const existente = await acharLeadDuplicado(tx, tenantId, {
        contactPhone: input.contactPhone,
        contactEmail,
      });

      if (existente) {
        await registrarContatoRepetido(tx, {
          tenantId,
          leadId: existente.id,
          // Sem ator: não há usuário por trás do clique, e inventar um seria
          // atribuir a alguém da loja o que o visitante fez.
          actorUserId: null,
          vehicleId,
          vehicleIdAtual: existente.vehicleId,
          source: 'website',
          message: input.message ?? null,
          origem: 'publico',
        });
        return { deduplicado: true, leadId: existente.id, aviso: null };
      }

      const vehicleInfo = await this.descreverVeiculo(tx, vehicleId);

      const lead = await tx.lead.create({
        data: {
          tenantId,
          // Sempre nulo aqui: esta rota é a do visitante sem conta. Quem está
          // logado continua indo por `POST /leads`, que vincula o usuário — a
          // tela escolhe a rota pelo token que tem em mãos.
          customerUserId: null,
          vehicleId,
          contactName: input.contactName,
          contactEmail,
          contactPhone: input.contactPhone,
          contactPhoneNormalized: normalizarTelefoneBr(input.contactPhone),
          source: 'website',
          status: 'new',
          message: input.message ?? null,
          consentedAt: new Date(),
          consentText: input.consentText,
        },
      });

      await this.registrarCriacao(tx, tenantId, lead.id, null, 'formulário público do site');

      return {
        deduplicado: false,
        leadId: lead.id,
        aviso: {
          dealerEmail: tenant.branches[0]?.email ?? null,
          dealerName: tenant.tradeName,
          customerName: input.contactName,
          vehicleInfo,
          message: input.message ?? null,
        } satisfies AvisoDeLeadNovo,
      };
    });

    this.avisarLojaDeLeadNovo(aviso);

    // O id do lead não é segredo (quem o criou sabe o que enviou), mas nada da
    // loja volta para a página pública além disso.
    return { ok: true, deduplicado, leadId };
  }

  /**
   * De qual loja é este formulário.
   *
   * Roda em `withPublic` — sem contexto de tenant, exatamente como o catálogo.
   * É a única leitura possível aqui: o visitante não tem loja, e confiar no
   * `tenantId` do corpo sem conferir deixaria qualquer um criar lead em
   * qualquer concessionária.
   */
  private async resolverLojaPublica(
    input: LeadPublicoInput,
  ): Promise<{ tenantId: string; vehicleId: string | null }> {
    if (input.vehicleId) {
      const vehicleId = input.vehicleId;
      const veiculo = await this.prisma.withPublic((tx) =>
        tx.vehicle.findFirst({
          where: { id: vehicleId, status: 'available' },
          select: { id: true, tenantId: true },
        }),
      );
      // 404 também quando o veículo existe mas está fora da vitrine: a policy
      // `leitura_publica` já não o devolveria, e a mensagem é a mesma.
      if (!veiculo) throw new NotFoundException('Veículo não encontrado');

      if (input.tenantId && input.tenantId !== veiculo.tenantId) {
        throw new NotFoundException('Veículo não encontrado');
      }
      return { tenantId: veiculo.tenantId, vehicleId: veiculo.id };
    }

    const tenantId = input.tenantId!;
    const loja = await this.prisma.withPublic((tx) =>
      tx.tenant.findFirst({ where: { id: tenantId, isActive: true }, select: { id: true } }),
    );
    if (!loja) throw new NotFoundException('Concessionária não encontrada');

    return { tenantId: loja.id, vehicleId: null };
  }

  /* ── Lead manual (vendedor cadastrando quem chegou por fora) ── */

  /**
   * O cliente ligou, mandou mensagem ou apareceu no balcão.
   *
   * Passa pela mesma deduplicação da rota pública: é comum a pessoa preencher o
   * formulário e ligar em seguida, e o vendedor não tem como saber disso antes
   * de cadastrar.
   */
  async criarManual(
    escopo: Escopo,
    criadorId: string,
    input: LeadManualInput,
  ): Promise<unknown> {
    if (ehGlobal(escopo)) {
      // Super admin sem loja selecionada não tem a qual loja cadastrar. Falha
      // alto em vez de escolher uma.
      throw new ForbiddenException(
        'Selecione uma concessionária para cadastrar um lead.',
      );
    }
    const tenantId = escopo.tenantId;
    const contactEmail = input.contactEmail?.trim() || null;

    const { lead, deduplicado } = await this.prisma.withTenant(tenantId, async (tx) => {
      if (input.vehicleId) {
        const veiculo = await tx.vehicle.findFirst({
          where: { id: input.vehicleId, tenantId },
          select: { id: true },
        });
        if (!veiculo) throw new NotFoundException('Veículo não encontrado');
      }

      const responsavel = input.assignedTo ?? criadorId;
      const vendedor = await tx.user.findFirst({
        where: { id: responsavel, tenantId, status: 'active' },
        select: { id: true },
      });
      if (!vendedor) throw new NotFoundException('Vendedor não encontrado');

      const existente = await acharLeadDuplicado(tx, tenantId, {
        contactPhone: input.contactPhone,
        contactEmail,
      });

      if (existente) {
        await registrarContatoRepetido(tx, {
          tenantId,
          leadId: existente.id,
          actorUserId: criadorId,
          vehicleId: input.vehicleId ?? null,
          vehicleIdAtual: existente.vehicleId,
          source: input.source,
          message: input.message ?? null,
          origem: 'manual',
        });
        const lead = await tx.lead.findUniqueOrThrow({ where: { id: existente.id } });
        return { lead, deduplicado: true };
      }

      const lead = await tx.lead.create({
        data: {
          tenantId,
          vehicleId: input.vehicleId ?? null,
          branchId: input.branchId ?? null,
          assignedTo: responsavel,
          contactName: input.contactName,
          contactEmail,
          contactPhone: input.contactPhone,
          contactPhoneNormalized: normalizarTelefoneBr(input.contactPhone),
          source: input.source,
          status: 'new',
          message: input.message ?? null,
        },
      });

      await this.registrarCriacao(tx, tenantId, lead.id, criadorId, 'cadastro manual');

      return { lead, deduplicado: false };
    });

    return { ...lead, deduplicado };
  }

  /* ── Auxiliares compartilhados ─────────────────────────── */

  /** Primeira linha da timeline: sem ela, o lead novo nasce com histórico vazio. */
  private async registrarCriacao(
    tx: ScopedClient,
    tenantId: string,
    leadId: string,
    actorUserId: string | null,
    comoChegou: string,
  ): Promise<void> {
    await tx.leadInteraction.create({
      data: {
        leadId,
        tenantId,
        actorUserId,
        kind: 'created' satisfies LeadInteractionKind,
        content: `Lead criado — ${comoChegou}`,
      },
    });
  }

  /** "Marca Modelo Versão Ano", ou "veículo" quando não há carro no lead. */
  private async descreverVeiculo(tx: ScopedClient, vehicleId: string | null): Promise<string> {
    if (!vehicleId) return 'veículo';

    const vehicle = await tx.vehicle.findUnique({
      where: { id: vehicleId },
      select: {
        versionName: true,
        yearModel: true,
        brand: { select: { name: true } },
        model: { select: { name: true } },
      },
    });
    if (!vehicle) return 'veículo';

    return `${vehicle.brand.name} ${vehicle.model.name} ${vehicle.versionName ?? ''} ${vehicle.yearModel}`
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** E-mail de "lead novo" para a loja. Fora da transação e não bloqueante. */
  private avisarLojaDeLeadNovo(aviso: AvisoDeLeadNovo | null): void {
    if (!aviso?.dealerEmail) return;

    this.email
      .sendLeadNotification({
        to: aviso.dealerEmail,
        dealerName: aviso.dealerName,
        customerName: aviso.customerName,
        vehicleInfo: aviso.vehicleInfo,
        message: aviso.message,
        leadUrl: `${process.env.WEB_URL ?? 'http://localhost:3000'}/dashboard/leads`,
      })
      .catch((err) => this.logger.warn(`Falha ao notificar a loja do lead novo: ${err}`));
  }

  /** Lista leads da concessionária autenticada (dealer/admin) */
  async findAll(escopo: Escopo, opts: {
    status?: string;
    vehicleId?: string;
    page?: number;
    perPage?: number;
  }): Promise<unknown> {
    const { status, vehicleId, page = 1, perPage = 20 } = opts;
    const skip = (page - 1) * perPage;

    const where = {
      ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }),
      ...(status ? { status: status as 'new' | 'contacted' | 'qualified' | 'negotiating' | 'won' | 'lost' | 'archived' } : {}),
      ...(vehicleId ? { vehicleId } : {}),
    };

    const consultar = async (tx: ScopedClient) => {
      const [items, total] = await Promise.all([
        tx.lead.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          vehicle: {
            select: {
              id: true,
              versionName: true,
              yearModel: true,
              price: true,
              brand: { select: { name: true } },
              model: { select: { name: true } },
              images: { where: { isCover: true }, take: 1, select: { url: true } },
            },
          },
          customer: {
            select: { id: true, fullName: true, email: true, phone: true },
          },
          // Quem é o responsável precisa vir na listagem: é onde o gerente
          // distribui a fila, e sem isto o botão de atribuir não teria o que
          // exibir nem como saber se já há alguém.
          assignee: {
            select: { id: true, fullName: true, email: true, role: true },
          },
        },
      }),
        tx.lead.count({ where }),
      ]);

      return { items, total, page, perPage };
    };

    return ehGlobal(escopo)
      ? consultar(this.privilegiado)
      : this.prisma.withTenant(escopo.tenantId, consultar);
  }

  /** Atualiza status de um lead (dealer/admin) */
  async updateStatus(
    tenantId: string,
    leadId: string,
    input: UpdateLeadStatusInput,
  ): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId } });
      if (!lead) throw new NotFoundException('Lead não encontrado');

      // `won` deixou de ser o fim do lead e passou a significar "gerou
      // negócio". Sem esta checagem o funil de leads e o de negócios divergem:
      // a tela mostra a venda ganha e não há negócio nenhum por trás dela,
      // nem margem, nem contrato. A regra vive aqui, e não só na tela, porque
      // a rota é pública para o painel inteiro.
      if (input.status === 'won') {
        const negocios = await tx.deal.count({ where: { leadId, tenantId } });
        if (negocios === 0) {
          throw new ConflictException(
            'Para marcar o lead como ganho, abra o negócio correspondente — ' +
              'é ele que carrega valor, pagamento e margem.',
          );
        }
      }

      return tx.lead.update({
        where: { id: leadId },
        data: { status: input.status },
      });
    });
  }

  /** Conta leads por status para o dashboard (dealer/admin) */
  async getStats(escopo: Escopo): Promise<unknown> {
    const agrupar = (tx: ScopedClient) =>
      tx.lead.groupBy({
        by: ['status'],
        where: ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId },
        _count: { _all: true },
      });

    const groups = await (ehGlobal(escopo)
      ? agrupar(this.privilegiado)
      : this.prisma.withTenant(escopo.tenantId, agrupar));

    const stats: Record<string, number> = {};
    for (const g of groups) {
      stats[g.status] = g._count._all;
    }
    return stats;
  }

  /** Deleta / arquiva um lead (dealer/admin) */
  async remove(tenantId: string, leadId: string): Promise<{ deleted: boolean }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId } });
      if (!lead) throw new NotFoundException('Lead não encontrado');
      await tx.lead.delete({ where: { id: leadId } });
    });
    return { deleted: true };
  }

  /** Atribui lead a um vendedor */
  async assign(tenantId: string, leadId: string, salesPersonId: string | null): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId } });
      if (!lead) throw new NotFoundException('Lead não encontrado');

      if (salesPersonId) {
        const sp = await tx.user.findFirst({
          where: { id: salesPersonId, tenantId, status: 'active' },
        });
        if (!sp) throw new NotFoundException('Vendedor não encontrado');
      }

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: { assignedTo: salesPersonId },
        include: { assignee: { select: { id: true, fullName: true, email: true } } },
      });

      await tx.leadInteraction.create({
        data: {
          leadId,
          tenantId,
          kind: 'assignment',
          content: salesPersonId ? `Lead atribuído` : 'Atribuição removida',
          payload: { salesPersonId } as never,
        },
      });

      return updated;
    });
  }

  /** Histórico completo de um lead (timeline) */
  async getHistory(tenantId: string, leadId: string): Promise<unknown> {
    const lead = await this.prisma.withTenant(tenantId, (tx) =>
      tx.lead.findFirst({
      where: { id: leadId, tenantId },
      include: {
        vehicle: {
          select: {
            id: true, versionName: true, yearModel: true, price: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
            images: { where: { isCover: true }, take: 1, select: { url: true } },
          },
        },
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
        assignee:  { select: { id: true, fullName: true, email: true } },
        interactions: {
          orderBy: { occurredAt: 'asc' },
          include: { actor: { select: { id: true, fullName: true } } },
        },
        appointments: {
          orderBy: { scheduledStart: 'asc' },
          select: { id: true, scheduledStart: true, scheduledEnd: true, status: true, type: true, notes: true },
        },
      },
      }),
    );
    if (!lead) throw new NotFoundException('Lead não encontrado');
    return lead;
  }

  /**
   * Adiciona interação manual a um lead.
   *
   * `kind` chega validado pelo Zod contra `LEAD_INTERACTION_KINDS_MANUAIS` —
   * antes era `string` livre, e qualquer palavra entrava na timeline sem
   * rótulo na tela. É por aqui que o clique no WhatsApp e no telefone vira
   * registro.
   */
  async addInteraction(
    tenantId: string,
    leadId: string,
    actorUserId: string,
    kind: string,
    content: string | null,
  ): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId } });
      if (!lead) throw new NotFoundException('Lead não encontrado');

      const interaction = await tx.leadInteraction.create({
        data: {
          leadId, tenantId, actorUserId, kind, content,
        },
      });

      // Atualiza lastActivityAt
      await tx.lead.update({
        where: { id: leadId },
        data: { lastActivityAt: new Date() },
      });

      return interaction;
    });
  }

  /**
   * Avaliação de um lead de troca: o vendedor informa quanto vale o veículo
   * oferecido. Guarda na metadata, registra na timeline e avisa o cliente.
   */
  async setTradeInAppraisal(
    tenantId: string,
    leadId: string,
    actorUserId: string,
    input: { value: number; note?: string; status?: 'offered' | 'rejected' },
  ): Promise<unknown> {
    const { lead, updated, offered } = await this.prisma.withTenant(tenantId, async (tx) => {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, tenantId },
      include: {
        tenant:  { select: { tradeName: true } },
        vehicle: {
          select: {
            price: true, versionName: true, yearModel: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
          },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (lead.source !== 'trade_in') throw new BadRequestException('Este lead não é uma proposta de troca');

    const meta = (lead.metadata && typeof lead.metadata === 'object' ? lead.metadata : {}) as Record<string, unknown>;
    const tradeIn = (meta.tradeIn && typeof meta.tradeIn === 'object' ? meta.tradeIn : {}) as Record<string, unknown>;
    const offered = (tradeIn.vehicle ?? {}) as { brandName?: string; modelName?: string; versionName?: string; yearModel?: number };

    const appraisal = {
      value: input.value,
      note: input.note ?? null,
      status: input.status ?? 'offered',
      evaluatedBy: actorUserId,
      evaluatedAt: new Date().toISOString(),
    };
    const newMeta = { ...meta, tradeIn: { ...tradeIn, appraisal } };

    const updated = await tx.lead.update({
      where: { id: leadId },
      data: {
        metadata: newMeta as Prisma.InputJsonValue,
        lastActivityAt: new Date(),
      },
    });

    await tx.leadInteraction.create({
      data: {
        leadId, tenantId, actorUserId,
        kind: 'trade_in_appraisal',
        content: input.status === 'rejected'
          ? 'Proposta de troca recusada'
          : `Veículo avaliado em R$ ${input.value.toLocaleString('pt-BR')}`,
        payload: { value: input.value, status: appraisal.status } as never,
      },
    });

      return { lead, updated, offered };
    });

    // Avisa o cliente (e-mail de contato do lead)
    if (lead.contactEmail && input.status !== 'rejected') {
      const offeredInfo = `${offered.brandName ?? ''} ${offered.modelName ?? ''} ${offered.versionName ?? ''} ${offered.yearModel ?? ''}`.replace(/\s+/g, ' ').trim();
      const desiredInfo = lead.vehicle
        ? `${lead.vehicle.brand.name} ${lead.vehicle.model.name} ${lead.vehicle.versionName ?? ''} ${lead.vehicle.yearModel}`.replace(/\s+/g, ' ').trim()
        : null;
      this.email.sendTradeInAppraisal({
        to: lead.contactEmail,
        customerName: lead.contactName ?? 'cliente',
        dealerName: lead.tenant.tradeName,
        offeredVehicle: offeredInfo || 'seu veículo',
        value: input.value,
        desiredVehicle: desiredInfo,
        desiredPrice: lead.vehicle ? Number(lead.vehicle.price) : null,
        note: input.note ?? null,
      }).catch(() => {/* silencia erros de e-mail */});
    }

    return updated;
  }

  /** Exporta leads como CSV */
  async exportCsv(tenantId: string, opts: { status?: string; from?: string; to?: string }): Promise<string> {
    const where = {
      tenantId,
      ...(opts.status ? { status: opts.status as never } : {}),
      ...(opts.from || opts.to ? {
        createdAt: {
          ...(opts.from ? { gte: new Date(opts.from) } : {}),
          ...(opts.to   ? { lte: new Date(opts.to)   } : {}),
        },
      } : {}),
    };

    const leads = await this.prisma.withTenant(tenantId, (tx) =>
      tx.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        vehicle: { select: { versionName: true, yearModel: true, price: true, brand: { select: { name: true } }, model: { select: { name: true } } } },
        customer: { select: { fullName: true, email: true, phone: true } },
        assignee:  { select: { fullName: true } },
      },
      take: 5000,
      }),
    );

    const header = ['ID', 'Nome', 'E-mail', 'Telefone', 'Veículo', 'Preço', 'Fonte', 'Status', 'Vendedor', 'Mensagem', 'Criado em'];
    const rows = leads.map((l) => [
      l.id,
      l.contactName ?? l.customer?.fullName ?? '',
      l.contactEmail ?? l.customer?.email ?? '',
      l.contactPhone ?? l.customer?.phone ?? '',
      l.vehicle ? `${l.vehicle.brand.name} ${l.vehicle.model.name} ${l.vehicle.versionName ?? ''} ${l.vehicle.yearModel}` : '',
      l.vehicle?.price?.toString() ?? '',
      l.source,
      l.status,
      l.assignee?.fullName ?? '',
      (l.message ?? '').replace(/[\r\n,]/g, ' '),
      l.createdAt.toISOString(),
    ]);

    return [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  }
}
