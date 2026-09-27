import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import {
  notificacaoDeLeadNovo,
  notificacaoDeMensagem,
  type InscricaoDePushInput,
  type NotificacaoPush,
  type ProvedorDePush,
} from '@autoconnect/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../../common/prisma/privileged-prisma.service';
import { PROVEDOR_DE_PUSH } from './provedor';

/** Papéis que recebem o lead que ficou sem responsável. */
const GERENCIA = ['tenant_admin', 'manager'] as const;

/**
 * Notificação push do vendedor: inscrições por aparelho e o envio.
 *
 * **O envio nunca derruba quem chamou.** Os avisos saem depois do commit, sem
 * `await` de quem chamou (`void`), e falha vira log — o lead e a mensagem já
 * estão gravados, e um serviço de push fora do ar não pode fazer o webhook do
 * WhatsApp responder erro nem o formulário do site parecer que falhou.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    /**
     * Um uso só: o aparelho que muda de dono. Quem tem o endpoint é o próprio
     * navegador (é uma URL secreta do serviço de push), e ele pode estar
     * inscrito para a pessoa que usava o celular antes — em outra loja, que o
     * RLS não deixa ver. Sem tomar a inscrição, os leads da pessoa anterior
     * continuariam aparecendo no aparelho da nova.
     */
    private readonly privilegiado: PrivilegedPrismaService,
    @Inject(PROVEDOR_DE_PUSH)
    private readonly provedor: ProvedorDePush,
  ) {}

  async capacidade(tenantId: string, userId: string) {
    const aparelhos = this.provedor.disponivel
      ? await this.prisma.withTenant(tenantId, (tx) =>
          tx.pushSubscription.count({ where: { tenantId, userId } }),
        )
      : 0;
    return { disponivel: this.provedor.disponivel, chavePublica: this.provedor.chavePublica, aparelhos };
  }

  /** O mesmo aparelho reinscrito atualiza a linha, em vez de duplicar o aviso. */
  async inscrever(tenantId: string, userId: string, inscricao: InscricaoDePushInput, userAgent: string | null) {
    const dados = {
      tenantId, userId,
      p256dh: inscricao.keys.p256dh,
      auth: inscricao.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    };
    // Sem `upsert`: o do Prisma vira `INSERT … ON CONFLICT DO UPDATE`, e o
    // conflito com a linha de outra loja (invisível pelo RLS) sai como erro de
    // política, não de unicidade — a tomada do aparelho abaixo nunca rodaria.
    // Buscar, depois atualizar ou criar, faz o conflito ser o P2002 esperado.
    const gravar = () => this.prisma.withTenant(tenantId, async (tx) => {
      const existente = await tx.pushSubscription.findFirst({
        where: { endpoint: inscricao.endpoint },
        select: { id: true },
      });
      return existente
        ? tx.pushSubscription.update({ where: { id: existente.id }, data: dados, select: { id: true } })
        : tx.pushSubscription.create({ data: { endpoint: inscricao.endpoint, ...dados }, select: { id: true } });
    });
    try {
      await gravar();
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      // O aparelho está inscrito para alguém de outra loja: ele muda de dono.
      await this.privilegiado.pushSubscription.deleteMany({ where: { endpoint: inscricao.endpoint } });
      await gravar();
    }
    return { ok: true };
  }

  /** Ao sair da conta, e no botão "Desativar" deste aparelho. */
  async desinscrever(tenantId: string, userId: string, endpoint: string) {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.pushSubscription.deleteMany({ where: { tenantId, userId, endpoint } }),
    );
    return { ok: true };
  }

  async teste(tenantId: string, userId: string) {
    const enviados = await this.enviarAgora(tenantId, [userId], {
      titulo: 'AutoConnect',
      corpo: 'Notificações ativas. É assim que o lead novo vai chegar.',
      url: '/leads',
      etiqueta: 'teste',
    });
    return { enviados };
  }

  /* ── Os avisos ────────────────────────────────────────────── */

  /**
   * Lead novo: para o vendedor da vez; sem responsável (rodízio desligado ou
   * ninguém de plantão), para a gerência — é quem distribui.
   */
  avisarLeadNovo(
    tenantId: string,
    dados: { leadId: string; assignedTo: string | null; nome: string | null; veiculo: string | null; origem: string },
  ): void {
    void (async () => {
      const destino = dados.assignedTo
        ? [dados.assignedTo]
        : await this.prisma.withTenant(tenantId, async (tx) =>
            (await tx.user.findMany({
              where: { tenantId, status: 'active', role: { in: [...GERENCIA] } },
              select: { id: true },
            })).map((u) => u.id),
          );
      await this.enviarAgora(
        tenantId,
        destino,
        notificacaoDeLeadNovo({ ...dados, semResponsavel: !dados.assignedTo }),
      );
    })().catch((err) => this.logger.warn(`Push de lead novo não saiu: ${err}`));
  }

  /** O cliente escreveu numa conversa do vendedor. Sem responsável, ninguém é acordado. */
  avisarMensagem(
    tenantId: string,
    dados: { conversationId: string; salespersonId: string | null; nome: string | null; canal: string; texto: string },
  ): void {
    if (!dados.salespersonId) return;
    const para = dados.salespersonId;
    void this.enviarAgora(tenantId, [para], notificacaoDeMensagem(dados))
      .catch((err) => this.logger.warn(`Push de mensagem não saiu: ${err}`));
  }

  /**
   * Manda para todos os aparelhos dos usuários. Inscrição expirada sai do
   * banco; as demais falhas ficam no log. Devolve quantos saíram.
   */
  private async enviarAgora(tenantId: string, userIds: string[], notificacao: NotificacaoPush): Promise<number> {
    if (!this.provedor.disponivel || userIds.length === 0) return 0;

    const inscricoes = await this.prisma.withTenant(tenantId, (tx) =>
      tx.pushSubscription.findMany({
        where: { tenantId, userId: { in: userIds } },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
      }),
    );
    if (inscricoes.length === 0) return 0;

    const resultados = await Promise.all(
      inscricoes.map(async (i) => ({ i, r: await this.provedor.enviar(i, notificacao) })),
    );
    const expiradas = resultados.filter((x) => !x.r.ok && x.r.expirada).map((x) => x.i.id);
    const entregues = resultados.filter((x) => x.r.ok).map((x) => x.i.id);

    if (expiradas.length || entregues.length) {
      await this.prisma.withTenant(tenantId, async (tx) => {
        if (expiradas.length) await tx.pushSubscription.deleteMany({ where: { id: { in: expiradas } } });
        if (entregues.length) {
          await tx.pushSubscription.updateMany({ where: { id: { in: entregues } }, data: { lastSuccessAt: new Date() } });
        }
      });
    }
    return entregues.length;
  }
}
