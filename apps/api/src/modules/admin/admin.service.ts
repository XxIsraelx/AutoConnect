import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SchedulerRegistry } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import { Prisma } from '@autoconnect/db';
import {
  avaliarCobranca,
  CATALOGO_DE_PLANOS,
  DIAS_PARA_ESCOLHER_PLANO_APOS_CORTESIA,
  PLANO_DA_CORTESIA,
  ROTULO_MOTIVO_DE_CORTESIA,
  type MotivoDeCortesia,
  DEAL_FATURADO_STATUSES,
  DEAL_TERMINAL_STATUSES,
  type FornecedorDeConsulta,
  type SubscriptionPlanValue,
  type ProvedorDeAssinatura,
  type ProvedorDeCobranca,
} from '@autoconnect/shared';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { EmailService } from '../../common/email/email.service';
import { DocumentosStorage } from '../../common/armazenamento/documentos.storage';
import { PROVEDOR_DE_ASSINATURA } from '../contracts/assinatura/provedor';
import { FORNECEDOR_DE_CONSULTA } from '../consultas/fornecedor';
import { PROVEDOR_DE_COBRANCA } from '../cobranca/provedor';
import { EstadoDaLojaService } from '../cobranca/estado-da-loja.service';

const DIA_MS = 86_400_000;

/** Papéis filtráveis na lista de usuários — `super_admin` fica de fora. */
export const PAPEIS_FILTRAVEIS = ['tenant_admin', 'manager', 'salesperson', 'customer'] as const;
export type UserRoleFiltro = (typeof PAPEIS_FILTRAVEIS)[number];

/**
 * Primeiro instante do mês corrente no fuso das lojas (São Paulo, UTC−3 fixo
 * desde 2019). A API roda em UTC no Railway: sem isto, entre 21h e meia-noite
 * do último dia do mês o painel já mostraria o mês seguinte zerado.
 */
export function inicioDoMesEmSaoPaulo(agora = new Date()): Date {
  const local = new Date(agora.getTime() - 3 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 3));
}

/** `up` funciona; `down` está configurado e falha; `off` não foi configurado de propósito. */
export type StatusDoServico = 'up' | 'down' | 'off';

export interface ServicoVerificado {
  key: string;
  label: string;
  status: StatusDoServico;
  latencyMs?: number;
  /** Nome do fornecedor montado (clicksign, resend…). */
  provider?: string;
  detail?: string;
}

/**
 * O que a aba Sistema mostra sobre o gateway de cobrança.
 *
 * Pura de propósito: são três respostas de regra ("não pedido", "pedido e não
 * subiu", "montado") e uma delas é a que faltava — o gateway que tira dinheiro
 * da conta do lojista era **o único serviço externo fora do painel**. Assinatura,
 * consulta, e-mail, Google, Cloudinary, BrasilAPI e ViaCEP estavam lá; a cobrança,
 * não. E com ela faltava o aviso de sandbox: a Asaas de homologação não move
 * dinheiro nenhum, e nada na tela dizia isso.
 *
 * Não chama o gateway. A Asaas cobra por chamada de API, e abrir a aba não pode
 * custar dinheiro — o mesmo critério de `verificarConsulta`.
 */
export function estadoDaCobrancaNoPainel(
  gateway: { nome: string; disponivel: boolean; sandbox?: boolean },
  pedido: string | undefined,
): ServicoVerificado {
  const base = { key: 'billing', label: 'Cobrança', provider: gateway.nome };

  if (!gateway.disponivel) {
    // Pedido e não montado = configuração incompleta (o motivo está no log da
    // subida). Não pedido = desligado de propósito, e o bloqueio por vencimento
    // continua valendo: o que some é o caminho para pagar.
    return pedido
      ? {
        ...base,
        provider: pedido,
        status: 'down',
        detail: `COBRANCA_FORNECEDOR=${pedido}, mas o gateway não subiu — veja o log de inicialização.`,
      }
      : {
        ...base,
        status: 'off',
        detail: 'Sem gateway: a contratação some da tela e quem desbloqueia uma loja é o super admin, à mão.',
      };
  }

  if (gateway.nome === 'simulado') {
    return { ...base, status: 'up', detail: 'Simulado: nenhuma cobrança sai deste servidor.' };
  }

  return {
    ...base,
    status: 'up',
    detail: gateway.sandbox
      ? 'Sandbox: as cobranças existem no gateway, mas nada aqui é dinheiro de verdade.'
      : undefined,
  };
}

/** Métricas de uso por concessionária — as mesmas na lista e no detalhe. */
export interface MetricasDaLoja {
  invoicedDeals30d: number;
  gmv30d: string;
  vehicleQueriesMonth: number;
  vehicleQuerySpendMonthCents: number;
  lastActivityAt: Date | null;
}

const METRICAS_VAZIAS: MetricasDaLoja = {
  invoicedDeals30d: 0,
  gmv30d: '0.00',
  vehicleQueriesMonth: 0,
  vehicleQuerySpendMonthCents: 0,
  lastActivityAt: null,
};

function maisRecente(...datas: (Date | null | undefined)[]): Date | null {
  let max: Date | null = null;
  for (const d of datas) if (d && (!max || d > max)) max = d;
  return max;
}

/** Faturas que ainda dá para cancelar: as que ninguém pagou. */
const FATURAS_EM_ABERTO = ['pendente', 'vencida'] as const;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  /**
   * Usa a conexão privilegiada de propósito: o painel do super admin consulta
   * todas as concessionárias por natureza, e `withTenant` não faria sentido
   * aqui. A travessia fica declarada no tipo, não escondida num `this.privilegiado`
   * igual ao de todo mundo.
   */
  constructor(
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly estadoDaLoja: EstadoDaLojaService,
    private readonly jwt:    JwtService,
    private readonly email:  EmailService,
    private readonly config: ConfigService,
    private readonly documentos: DocumentosStorage,
    private readonly agendador: SchedulerRegistry,
    @Inject(PROVEDOR_DE_ASSINATURA) private readonly assinatura: ProvedorDeAssinatura,
    @Inject(FORNECEDOR_DE_CONSULTA) private readonly consulta: FornecedorDeConsulta,
    /**
     * O gateway de cobrança, para cancelar fatura e assinatura de uma loja pelo
     * painel. Só o super admin chega aqui; quem confere o papel é o controller.
     */
    @Inject(PROVEDOR_DE_COBRANCA) private readonly cobranca: ProvedorDeCobranca,
  ) {}

  /* ── KPIs ──────────────────────────────────────────────────────────── */

  /**
   * KPIs da plataforma inteira.
   *
   * Tudo é contagem ou agregado, e tudo sai num único `Promise.all`: a API
   * roda em Virgínia e o banco em São Paulo (~0,6s por ida e volta), então
   * consultas em série somariam segundos ao carregamento do painel.
   *
   * Dinheiro sai como string (`Decimal.toFixed(2)`), nunca `number`.
   */
  async getStats() {
    const agora = new Date();
    const thirtyDaysAgo = new Date(agora.getTime() - 30 * DIA_MS);
    const inicioMes = inicioDoMesEmSaoPaulo(agora);
    // Mesma regra do relatório de margem da loja: faturado, pela data de
    // fechamento. Assim o número daqui bate com o `/relatorios` de cada loja.
    const faturados = { status: { in: [...DEAL_FATURADO_STATUSES] } };

    const [
      totalTenants, activeTenants, inactiveTenants,
      trialTenants, paidTenants,
      newTenantsMonth,
      totalUsers, totalVehicles, totalLeads, totalLeadsNew,
      activeInvites,
      openConversations,
      negociosPorStatus,
      faturado30d, faturadoMes,
      contratosPorStatus, assinadosExternamente,
      solicitacoesPorStatus,
      consultasMes, consultasFalhasMes,
    ] = await Promise.all([
      this.privilegiado.tenant.count(),
      this.privilegiado.tenant.count({ where: { isActive: true } }),
      this.privilegiado.tenant.count({ where: { isActive: false } }),
      this.privilegiado.tenantSubscription.count({ where: { plan: 'trial' } }),
      this.privilegiado.tenantSubscription.count({ where: { plan: { not: 'trial' } } }),
      this.privilegiado.tenant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.privilegiado.user.count({ where: { role: { not: 'super_admin' } } }),
      this.privilegiado.vehicle.count(),
      this.privilegiado.lead.count(),
      this.privilegiado.lead.count({ where: { status: 'new' } }),
      this.privilegiado.tenantInvite.count({
        where: { usedAt: null, expiresAt: { gt: agora } },
      }),
      this.privilegiado.conversation.count({ where: { status: 'open' } }),
      this.privilegiado.deal.groupBy({ by: ['status'], _count: { _all: true } }),
      this.privilegiado.deal.aggregate({
        where: { ...faturados, closedAt: { gte: thirtyDaysAgo } },
        _count: { _all: true },
        _sum: { saleValue: true, grossMargin: true },
      }),
      this.privilegiado.deal.aggregate({
        where: { ...faturados, closedAt: { gte: inicioMes } },
        _count: { _all: true },
        _sum: { saleValue: true, grossMargin: true },
      }),
      this.privilegiado.dealContract.groupBy({ by: ['status'], _count: { _all: true } }),
      // Assinado "externamente" = tem solicitação concluída no provedor. O
      // resto dos assinados foi aceite registrado no próprio sistema.
      this.privilegiado.dealContract.count({
        where: { status: 'signed', signatureRequests: { some: { status: 'completed' } } },
      }),
      this.privilegiado.contractSignatureRequest.groupBy({
        by: ['status'], _count: { _all: true },
      }),
      this.privilegiado.vehicleQuery.aggregate({
        where: { queriedAt: { gte: inicioMes } },
        _count: { _all: true },
        _sum: { costCents: true },
      }),
      this.privilegiado.vehicleQuery.count({
        where: { queriedAt: { gte: inicioMes }, status: 'failed' },
      }),
    ]);

    const porStatus = Object.fromEntries(
      negociosPorStatus.map((g) => [g.status, g._count._all]),
    ) as Record<string, number>;
    const soma = (lista: readonly string[]) =>
      lista.reduce((t, st) => t + (porStatus[st] ?? 0), 0);
    const totalNegocios = Object.values(porStatus).reduce((t, n) => t + n, 0);
    const ganhos = soma(DEAL_FATURADO_STATUSES);
    const cancelados = soma(DEAL_TERMINAL_STATUSES);

    const contratos = Object.fromEntries(
      contratosPorStatus.map((g) => [g.status, g._count._all]),
    ) as Record<string, number>;
    const assinados = contratos.signed ?? 0;

    const janela = (a: typeof faturado30d) => ({
      count: a._count._all,
      gmv: (a._sum.saleValue ?? 0).toFixed(2),
      margin: (a._sum.grossMargin ?? 0).toFixed(2),
    });

    return {
      totalTenants, activeTenants, inactiveTenants,
      trialTenants, paidTenants, newTenantsMonth,
      totalUsers, totalVehicles, totalLeads, totalLeadsNew,
      activeInvites,
      openConversations,
      monthStartsAt: inicioMes.toISOString(),
      deals: {
        total: totalNegocios,
        open: totalNegocios - ganhos - cancelados,
        won: ganhos,
        canceled: cancelados,
        byStatus: porStatus,
      },
      revenue: {
        last30d: janela(faturado30d),
        monthToDate: janela(faturadoMes),
      },
      contracts: {
        // Emitido = saiu do rascunho alguma vez; anulado também foi emitido.
        issued: (contratos.issued ?? 0) + assinados + (contratos.voided ?? 0),
        pendingSignature: contratos.issued ?? 0,
        signed: assinados,
        signedExternal: assinadosExternamente,
        signedInternal: assinados - assinadosExternamente,
        voided: contratos.voided ?? 0,
      },
      externalSignatures: Object.fromEntries(
        solicitacoesPorStatus.map((g) => [g.status, g._count._all]),
      ) as Record<string, number>,
      vehicleQueries: {
        provider: this.consulta.nome,
        unitCostCents: this.consulta.custoCentavos,
        month: {
          count: consultasMes._count._all,
          failed: consultasFalhasMes,
          spendCents: consultasMes._sum.costCents ?? 0,
        },
      },
    };
  }

  /* ── Convites ──────────────────────────────────────────────────────── */

  async createInvite(data: { email?: string; note?: string; expiresInDays?: number }) {
    const token     = randomBytes(32).toString('hex');
    const days      = data.expiresInDays ?? 7;
    const expiresAt = new Date(Date.now() + days * 86_400_000);

    const invite = await this.privilegiado.tenantInvite.create({
      data: { token, email: data.email ?? null, note: data.note ?? null, expiresAt },
    });

    await this.writeAudit({
      action: 'invite_created',
      entityType: 'tenant_invite',
      entityId: invite.id,
      diff: { email: data.email, note: data.note, expiresAt },
    });

    return invite;
  }

  listInvites() {
    return this.privilegiado.tenantInvite.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async revokeInvite(id: string) {
    const invite = await this.privilegiado.tenantInvite.findUnique({ where: { id } });
    if (!invite) throw new NotFoundException('Convite não encontrado');
    return this.privilegiado.tenantInvite.update({ where: { id }, data: { usedAt: new Date() } });
  }

  async deleteInvite(id: string) {
    const invite = await this.privilegiado.tenantInvite.findUnique({ where: { id } });
    if (!invite) throw new NotFoundException('Convite não encontrado');
    await this.privilegiado.tenantInvite.delete({ where: { id } });
    return { deleted: true };
  }

  /** Validação de convite usada pelo AuthService */
  async validateAndConsumeInvite(token: string, tenantId: string) {
    const invite = await this.privilegiado.tenantInvite.findUnique({ where: { token } });
    if (!invite)                   throw new BadRequestException('Convite inválido');
    if (invite.usedAt)             throw new BadRequestException('Este convite já foi utilizado');
    if (invite.expiresAt < new Date()) throw new BadRequestException('Convite expirado');
    await this.privilegiado.tenantInvite.update({
      where: { id: invite.id },
      data:  { usedAt: new Date(), usedBy: tenantId },
    });
  }

  /* ── Tenants ───────────────────────────────────────────────────────── */

  /**
   * Métricas de uso por loja em seis agregados agrupados por `tenantId` — nunca
   * um por loja (N+1). Com `tenantId`, as mesmas contas restritas a uma loja.
   */
  private async metricasDasLojas(tenantId?: string): Promise<Map<string, MetricasDaLoja>> {
    const agora = new Date();
    const thirtyDaysAgo = new Date(agora.getTime() - 30 * DIA_MS);
    const inicioMes = inicioDoMesEmSaoPaulo(agora);
    const daLoja = tenantId ? { tenantId } : {};

    const [faturados, consultas, logins, negocios, leads, veiculos] = await Promise.all([
      this.privilegiado.deal.groupBy({
        by: ['tenantId'],
        where: { ...daLoja, status: { in: [...DEAL_FATURADO_STATUSES] }, closedAt: { gte: thirtyDaysAgo } },
        _count: { _all: true },
        _sum: { saleValue: true },
      }),
      this.privilegiado.vehicleQuery.groupBy({
        by: ['tenantId'],
        where: { ...daLoja, queriedAt: { gte: inicioMes } },
        _count: { _all: true },
        _sum: { costCents: true },
      }),
      // Atividade é da equipe: cliente entrando no catálogo não diz que a
      // loja está usando o sistema.
      this.privilegiado.user.groupBy({
        by: ['tenantId'],
        where: { ...(tenantId ? { tenantId } : { tenantId: { not: null } }), role: { notIn: ['customer', 'super_admin'] } },
        _max: { lastLoginAt: true },
      }),
      this.privilegiado.deal.groupBy({ by: ['tenantId'], where: daLoja, _max: { updatedAt: true } }),
      this.privilegiado.lead.groupBy({ by: ['tenantId'], where: daLoja, _max: { createdAt: true } }),
      this.privilegiado.vehicle.groupBy({ by: ['tenantId'], where: daLoja, _max: { updatedAt: true } }),
    ]);

    const mapa = new Map<string, MetricasDaLoja>();
    const da = (id: string) => {
      let m = mapa.get(id);
      if (!m) { m = { ...METRICAS_VAZIAS }; mapa.set(id, m); }
      return m;
    };

    for (const g of faturados) {
      const m = da(g.tenantId);
      m.invoicedDeals30d = g._count._all;
      m.gmv30d = (g._sum.saleValue ?? 0).toFixed(2);
    }
    for (const g of consultas) {
      const m = da(g.tenantId);
      m.vehicleQueriesMonth = g._count._all;
      m.vehicleQuerySpendMonthCents = g._sum.costCents ?? 0;
    }
    for (const g of logins) {
      if (g.tenantId) da(g.tenantId).lastActivityAt = maisRecente(da(g.tenantId).lastActivityAt, g._max.lastLoginAt);
    }
    for (const g of negocios) da(g.tenantId).lastActivityAt = maisRecente(da(g.tenantId).lastActivityAt, g._max.updatedAt);
    for (const g of leads) da(g.tenantId).lastActivityAt = maisRecente(da(g.tenantId).lastActivityAt, g._max.createdAt);
    for (const g of veiculos) da(g.tenantId).lastActivityAt = maisRecente(da(g.tenantId).lastActivityAt, g._max.updatedAt);

    return mapa;
  }

  /**
   * O representante legal vira só dois sinais: o nome (sem ele o contrato não
   * é emitido) e o e-mail (sem ele a assinatura externa não é enviada). O CPF
   * não sai daqui — o painel não precisa dele para saber o que falta.
   */
  private representante(t: { legalRepName: string | null; legalRepEmail: string | null }) {
    return { configured: !!t.legalRepName, hasEmail: !!t.legalRepEmail };
  }

  /**
   * O que o painel precisa saber sobre o dinheiro de cada loja, num objeto só.
   *
   * O veredito sai de `avaliarCobranca`, a **mesma** função que o guard usa
   * para bloquear e que a tela da loja usa para desenhar a faixa de aviso. Se
   * o painel tivesse a própria regra, ele acabaria dizendo "em dia" para uma
   * loja que a API está recusando — e é justamente aqui que se olha quando
   * alguém liga reclamando.
   */
  private cobrancaDaLoja(
    assinatura: {
      plan: string; status: string; trialEndsAt: Date | null;
      pendingPlan?: string | null; pendingSince?: Date | null;
      currentPeriodEnd?: Date | null; graceUntil?: Date | null;
      courtesySince?: Date | null; courtesyReason?: string | null;
      externalProvider?: string | null; externalId?: string | null;
    } | null,
    ultimaFatura?: { status: string; amount: Prisma.Decimal; dueDate: Date; paidAt: Date | null } | null,
  ) {
    const veredito = avaliarCobranca(assinatura);
    return {
      plan: assinatura?.plan ?? null,
      status: assinatura?.status ?? null,
      trialEndsAt: assinatura?.trialEndsAt ?? null,
      // Plano contratado e **não pago**: não vale ainda, e é o que o super
      // admin precisa ver para distinguir "escolheu um plano" de "está pagando".
      planoPendente: veredito.planoPendente,
      pendenteDesde: assinatura?.pendingSince ?? null,
      /** A assinatura no gateway, se houver — é o que o cancelamento alcança. */
      gateway: assinatura?.externalId
        ? { provedor: assinatura.externalProvider ?? null, assinaturaExterna: assinatura.externalId }
        : null,
      situacao: veredito.situacao,
      somenteLeitura: veredito.somenteLeitura,
      diasRestantes: veredito.diasRestantes,
      prazoAte: veredito.prazoAte,
      inadimplente: veredito.situacao !== 'cortesia'
        && (assinatura?.status === 'past_due' || veredito.somenteLeitura),
      cortesia: assinatura?.courtesySince
        ? { desde: assinatura.courtesySince, motivo: assinatura.courtesyReason ?? null }
        : null,
      ultimaFatura: ultimaFatura
        ? {
            status: ultimaFatura.status,
            valor: ultimaFatura.amount.toFixed(2),
            vencimento: ultimaFatura.dueDate,
            pagoEm: ultimaFatura.paidAt,
          }
        : null,
    };
  }

  async listTenants(): Promise<unknown[]> {
    const [tenants, metricas] = await Promise.all([
      this.privilegiado.tenant.findMany({
        select: {
          id: true, slug: true, tradeName: true, legalName: true, taxId: true,
          primaryEmail: true, isActive: true, createdAt: true,
          legalRepName: true, legalRepEmail: true,
          subscription: {
            select: {
              plan: true, status: true, trialEndsAt: true,
              pendingPlan: true, pendingSince: true,
              currentPeriodEnd: true, graceUntil: true,
              externalProvider: true, externalId: true,
              courtesySince: true, courtesyReason: true,
              // Só a última: o painel mostra "a fatura mais recente", e trazer
              // o histórico inteiro de cada loja para uma lista seria pagar
              // por um dado que ninguém lê ali.
              invoices: {
                orderBy: { dueDate: 'desc' }, take: 1,
                select: { status: true, amount: true, dueDate: true, paidAt: true },
              },
            },
          },
          branches: { take: 1, select: { city: true, state: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.metricasDasLojas(),
    ]);

    return tenants.map(({ legalRepName, legalRepEmail, ...t }) => ({
      ...t,
      legalRep: this.representante({ legalRepName, legalRepEmail }),
      cobranca: this.cobrancaDaLoja(t.subscription, t.subscription?.invoices[0]),
      metrics: metricas.get(t.id) ?? METRICAS_VAZIAS,
    }));
  }

  async getTenantDetail(tenantId: string): Promise<unknown> {
    const [tenant, vehicleCount, leadCount, leadNewCount, metricas, faturas] = await Promise.all([
      this.privilegiado.tenant.findUnique({
        where: { id: tenantId },
        include: {
          subscription: true,
          branches: true,
          users: {
            select: {
              id: true, fullName: true, email: true,
              role: true, status: true, lastLoginAt: true, createdAt: true,
            },
            where: { role: { not: 'customer' } },
          },
        },
      }),
      this.privilegiado.vehicle.count({ where: { tenantId } }),
      this.privilegiado.lead.count({ where: { tenantId } }),
      this.privilegiado.lead.count({ where: { tenantId, status: 'new' } }),
      this.metricasDasLojas(tenantId),
      // O link de pagamento e o id no gateway entram aqui porque é por esta
      // tela que se conserta uma fatura gerada por engano: sem o link não há
      // como conferir o que o cliente está vendo, e sem o id no gateway não há
      // como casar a linha com a cobrança de lá.
      this.privilegiado.tenantInvoice.findMany({
        where: { tenantId }, orderBy: { dueDate: 'desc' }, take: 12,
        select: {
          id: true, status: true, amount: true, dueDate: true,
          paidAt: true, paymentMethod: true, paymentUrl: true,
          description: true, provider: true, externalId: true, createdAt: true,
        },
      }),
    ]);
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');

    const { legalRepCpf: _cpf, settings: _settings, ...dados } = tenant;
    void _cpf; void _settings;

    return {
      ...dados,
      legalRep: {
        ...this.representante(tenant),
        name: tenant.legalRepName,
        role: tenant.legalRepRole,
      },
      vehicleCount, leadCount, leadNewCount,
      cobranca: this.cobrancaDaLoja(tenant.subscription, faturas[0]),
      faturas: faturas.map((f) => ({
        id: f.id, status: f.status, valor: f.amount.toFixed(2),
        vencimento: f.dueDate, pagoEm: f.paidAt, meio: f.paymentMethod,
        urlPagamento: f.paymentUrl, descricao: f.description,
        provedor: f.provider, externalId: f.externalId, criadaEm: f.createdAt,
        /** Só fatura em aberto se cancela; paga e estornada são história. */
        cancelavel: (FATURAS_EM_ABERTO as readonly string[]).includes(f.status),
      })),
      /** Qual gateway está montado agora — sem ele, o cancelamento não sai do banco. */
      gatewayDeCobranca: { provedor: this.cobranca.nome, disponivel: this.cobranca.disponivel },
      metrics: metricas.get(tenantId) ?? METRICAS_VAZIAS,
    };
  }

  async changePlan(tenantId: string, plan: SubscriptionPlanValue): Promise<unknown> {
    const tenant = await this.privilegiado.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');

    const sub = await this.privilegiado.tenantSubscription.upsert({
      where:  { tenantId },
      update: { plan, status: 'active' },
      create: { tenantId, plan, status: 'active' },
    });

    await this.writeAudit({
      action: 'plan_changed',
      entityType: 'tenant',
      entityId: tenantId,
      diff: { plan },
    });

    // O veredito de cobrança está em cache por 30 s no guard. Sem isto, a loja
    // que o super admin acabou de desbloquear continuaria recebendo 402 por
    // meio minuto — e quem está do outro lado da linha ligou justamente por
    // causa do bloqueio.
    this.estadoDaLoja.invalidar(tenantId);

    return sub;
  }

  /**
   * Cortesia: a loja deixa de pagar (fundadora ou loja interna da AutoConnect).
   *
   * Vai para o plano da cortesia (Crescimento, o do programa de fundadores),
   * ativa e sem carência pendente. `avaliarCobranca` passa a decidir por
   * `courtesySince` antes de todo o resto, então nenhum prazo antigo — trial,
   * fatura — volta a valer enquanto a marca existir. Quem concedeu fica na
   * assinatura e na auditoria.
   */
  async concederCortesia(tenantId: string, motivo: MotivoDeCortesia, atorId: string): Promise<unknown> {
    const tenant = await this.privilegiado.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');

    const dados = {
      plan: PLANO_DA_CORTESIA,
      status: 'active' as const,
      graceUntil: null,
      courtesySince: new Date(),
      courtesyReason: motivo,
      courtesyGrantedBy: atorId,
    };
    const sub = await this.privilegiado.tenantSubscription.upsert({
      where: { tenantId },
      update: dados,
      create: { tenantId, ...dados },
    });

    await this.writeAudit({
      action: 'courtesy_granted',
      entityType: 'tenant',
      entityId: tenantId,
      actorUserId: atorId,
      diff: { motivo, plan: PLANO_DA_CORTESIA },
    });
    this.estadoDaLoja.invalidar(tenantId);

    // Sem `await`: a cortesia já vale; o e-mail é aviso, e falhar não a desfaz.
    if (tenant.primaryEmail) {
      this.email.sendCortesiaConcedida({
        to: tenant.primaryEmail,
        dealerName: tenant.tradeName,
        motivo: ROTULO_MOTIVO_DE_CORTESIA[motivo],
        plano: CATALOGO_DE_PLANOS[PLANO_DA_CORTESIA].nome,
      }).catch((err) => this.logger.warn(`E-mail de cortesia não saiu para ${tenantId}: ${err}`));
    }
    return sub;
  }

  /**
   * Fim da cortesia. A loja volta ao trial com `DIAS_PARA_ESCOLHER_PLANO_APOS_CORTESIA`
   * para contratar: revogar não pode ser bloqueio instantâneo de quem usava o
   * sistema de graça até ontem. Plano pago sem assinatura no gateway não serve
   * de destino — `avaliarCobranca` trataria como "em dia" para sempre.
   */
  async revogarCortesia(tenantId: string, atorId: string): Promise<unknown> {
    const sub = await this.privilegiado.tenantSubscription.findUnique({ where: { tenantId } });
    if (!sub?.courtesySince) throw new NotFoundException('Esta loja não está em cortesia');

    const prazo = new Date(Date.now() + DIAS_PARA_ESCOLHER_PLANO_APOS_CORTESIA * 86_400_000);
    const atualizada = await this.privilegiado.tenantSubscription.update({
      where: { tenantId },
      data: {
        plan: 'trial', status: 'active', trialEndsAt: prazo, graceUntil: null, lastNoticeAt: null,
        courtesySince: null, courtesyReason: null, courtesyGrantedBy: null,
      },
    });

    await this.writeAudit({
      action: 'courtesy_revoked',
      entityType: 'tenant',
      entityId: tenantId,
      actorUserId: atorId,
      diff: { motivoAnterior: sub.courtesyReason, desde: sub.courtesySince, trialEndsAt: prazo },
    });
    this.estadoDaLoja.invalidar(tenantId);

    const loja = await this.privilegiado.tenant.findUnique({
      where: { id: tenantId }, select: { primaryEmail: true, tradeName: true },
    });
    if (loja?.primaryEmail) {
      this.email.sendCortesiaRevogada({ to: loja.primaryEmail, dealerName: loja.tradeName, prazo })
        .catch((err) => this.logger.warn(`E-mail de fim de cortesia não saiu para ${tenantId}: ${err}`));
    }
    return atualizada;
  }

  async extendTrial(tenantId: string, days: number): Promise<unknown> {
    const sub = await this.privilegiado.tenantSubscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundException('Assinatura não encontrada');

    const current = sub.trialEndsAt ?? new Date();
    const newEnd  = new Date(Math.max(current.getTime(), Date.now()) + days * 86_400_000);

    await this.writeAudit({
      action: 'trial_extended',
      entityType: 'tenant',
      entityId: tenantId,
      diff: { days, newTrialEndsAt: newEnd },
    });

    const atualizada = await this.privilegiado.tenantSubscription.update({
      where: { tenantId },
      // `graceUntil` zerado junto: estender o trial de uma loja que já venceu
      // sem limpar a carência deixaria o veredito preso em somente leitura,
      // e o super admin veria a data nova sem nada destravar.
      data:  { trialEndsAt: newEnd, graceUntil: null, lastNoticeAt: null },
    });
    this.estadoDaLoja.invalidar(tenantId);
    return atualizada;
  }

  /* ── Faturas e assinatura, pela mão do super admin ─────────────────── */

  /**
   * Faz no gateway o que só ele pode fazer, quando ele é alcançável.
   *
   * Duas razões para não ser alcançável, e as duas são normais: **nenhum**
   * gateway configurado (instalação sem conta) e fatura de **outro** provedor
   * (a loja foi cobrada pela Asaas e hoje o montado é o simulado, ou
   * vice-versa). Nos dois casos a linha local ainda precisa ser corrigida —
   * ela é o que a loja vê —, então o cancelamento segue e a resposta diz que o
   * gateway não foi tocado.
   *
   * O que **não** é normal é o gateway recusar: aí o erro sobe e nada muda
   * aqui. Dizer "cancelada" com a cobrança viva lá seria a pior das duas
   * mentiras possíveis — a loja pagaria uma fatura que o painel diz que não
   * existe.
   */
  private async noGateway(
    provedorDaLinha: string | null,
    acao: (p: ProvedorDeCobranca) => Promise<void>,
  ): Promise<'cancelada' | 'nao_tentado'> {
    if (!this.cobranca.disponivel || this.cobranca.nome !== provedorDaLinha) {
      this.logger.warn(
        `Cancelamento sem passar pelo gateway: a linha é de "${provedorDaLinha ?? 'nenhum'}" ` +
          `e o provedor montado é "${this.cobranca.nome}" (disponível: ${this.cobranca.disponivel}).`,
      );
      return 'nao_tentado';
    }
    await acao(this.cobranca);
    return 'cancelada';
  }

  /**
   * Cancela **uma fatura em aberto** de uma loja.
   *
   * O caso que a criou: uma cobrança gerada por engano num teste em produção. A
   * loja fica com um boleto que ninguém devia pagar, e até aqui não havia como
   * desfazer isso sem SQL na mão.
   *
   * **A fatura é marcada `cancelada`, nunca apagada.** Três razões:
   *
   * 1. Histórico de dinheiro não se apaga. A linha é a única prova local de que
   *    o gateway chegou a emitir a cobrança — é o que explica, meses depois,
   *    um estorno ou uma reclamação.
   * 2. `(provider, external_id)` é único, e o webhook reencontra a fatura por
   *    ele. Apagada, uma entrega atrasada de `PAYMENT_OVERDUE` a **recriaria**
   *    como vencida e reabriria a carência; existindo e cancelada, o webhook a
   *    reconhece e ignora o evento.
   * 3. A loja continua vendo o que aconteceu com ela, o que é o contrário de
   *    "sumiu uma cobrança da minha tela".
   *
   * Fatura **paga** não passa por aqui: o caminho dela é o estorno, no painel
   * do gateway, porque quem devolve dinheiro é quem o recebeu.
   */
  async cancelarFaturaDaLoja(
    tenantId: string,
    faturaId: string,
    motivo: string,
    atorId: string,
  ): Promise<unknown> {
    const fatura = await this.privilegiado.tenantInvoice.findFirst({
      where: { id: faturaId, tenantId },
    });
    if (!fatura) throw new NotFoundException('Fatura não encontrada nesta concessionária');

    if (!(FATURAS_EM_ABERTO as readonly string[]).includes(fatura.status)) {
      if (fatura.status === 'cancelada') {
        // Idempotente: dois cliques no mesmo botão não viram erro.
        return { cancelada: true, jaEstava: true, gateway: 'nao_tentado' as const };
      }
      throw new BadRequestException(
        `Esta fatura está "${fatura.status}" e não se cancela: histórico de dinheiro não é reescrito. ` +
          'Para devolver um valor já pago, o caminho é o estorno no painel do gateway.',
      );
    }

    const gateway = await this.noGateway(fatura.provider, (p) => p.cancelarFatura(fatura.externalId));

    await this.privilegiado.tenantInvoice.update({
      where: { id: fatura.id },
      data: { status: 'cancelada' },
    });

    await this.writeAudit({
      action: 'invoice_canceled',
      entityType: 'tenant_invoice',
      entityId: fatura.id,
      actorUserId: atorId,
      diff: {
        tenantId, motivo, gateway,
        statusAnterior: fatura.status,
        valor: fatura.amount.toFixed(2),
        vencimento: fatura.dueDate,
        provedor: fatura.provider,
        externalId: fatura.externalId,
      },
    });

    return { cancelada: true, gateway };
  }

  /**
   * Cancela a **assinatura** de uma loja no gateway e limpa o que ela deixou.
   *
   * É a saída para a loja que contratou por engano — o caso real: um teste em
   * produção que criou assinatura e fatura pendente numa loja que não ia pagar.
   *
   * A ordem é gateway primeiro, banco depois, como em todo o módulo: se o
   * gateway recusar, nada muda aqui e o pedido pode ser repetido (cancelar duas
   * vezes na Asaas é no-op). Só depois de o gateway estar limpo o banco é
   * atualizado, de uma vez.
   *
   * `voltarParaTrial` existe porque a loja pode estar com um **plano pago que
   * nunca foi pago** — exatamente o que o defeito de 27/09/2026 gravava. Nesse
   * estado, cancelar a assinatura sem mexer no plano deixaria a loja "em dia"
   * para sempre, que é o defeito de novo. Voltar ao trial com prazo é o único
   * destino honesto: a loja escolhe um plano e paga, ou vira somente leitura no
   * fim do prazo. É explícito e auditado, nunca automático — só o super admin
   * sabe se aquela loja pagou por fora.
   */
  async cancelarAssinaturaDaLoja(
    tenantId: string,
    opcoes: { motivo: string; cancelarFaturas: boolean; voltarParaTrial: boolean; diasDeTrial: number },
    atorId: string,
  ): Promise<unknown> {
    const sub = await this.privilegiado.tenantSubscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundException('Assinatura não encontrada');

    // ── 1. Gateway: a assinatura ──────────────────────────────────────
    let gateway: 'cancelada' | 'nao_tentado' | 'sem_assinatura' = 'sem_assinatura';
    if (sub.externalId) {
      const id = sub.externalId;
      gateway = await this.noGateway(sub.externalProvider, (p) => p.cancelarAssinatura(id));
    }

    // ── 2. Gateway: as faturas em aberto ──────────────────────────────
    const abertas = opcoes.cancelarFaturas
      ? await this.privilegiado.tenantInvoice.findMany({
          where: { tenantId, status: { in: [...FATURAS_EM_ABERTO] } },
          select: { id: true, provider: true, externalId: true, amount: true, status: true },
        })
      : [];

    for (const f of abertas) {
      await this.noGateway(f.provider, (p) => p.cancelarFatura(f.externalId));
    }

    // ── 3. Banco, de uma vez ──────────────────────────────────────────
    const trialAte = opcoes.voltarParaTrial
      ? new Date(Date.now() + opcoes.diasDeTrial * DIA_MS)
      : null;

    const atualizada = await this.privilegiado.$transaction(async (tx) => {
      if (abertas.length > 0) {
        await tx.tenantInvoice.updateMany({
          where: { id: { in: abertas.map((f) => f.id) } },
          data: { status: 'cancelada' },
        });
      }
      return tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          // A intenção de contratar morre com a assinatura: sem cobrança no
          // gateway não há fatura para pagar.
          pendingPlan: null,
          pendingSince: null,
          // O id da assinatura sai; o do **cliente** fica, como manda o schema:
          // a loja que voltar não vira um segundo cadastro no gateway.
          externalId: null,
          ...(trialAte
            ? {
                plan: 'trial' as const,
                status: 'active' as const,
                trialEndsAt: trialAte,
                graceUntil: null,
                lastNoticeAt: null,
                canceledAt: null,
              }
            : {}),
        },
      });
    });

    await this.writeAudit({
      action: 'subscription_canceled_by_admin',
      entityType: 'tenant',
      entityId: tenantId,
      actorUserId: atorId,
      diff: {
        motivo: opcoes.motivo,
        gateway,
        assinaturaExterna: sub.externalId,
        planoAnterior: sub.plan,
        planoPendenteAnterior: sub.pendingPlan,
        statusAnterior: sub.status,
        faturasCanceladas: abertas.map((f) => ({ id: f.id, valor: f.amount.toFixed(2), status: f.status })),
        voltouParaTrial: opcoes.voltarParaTrial,
        trialEndsAt: trialAte,
      },
    });

    // O veredito está em cache por 30 s no guard: sem isto a loja continuaria
    // com o estado antigo por meio minuto depois do conserto.
    this.estadoDaLoja.invalidar(tenantId);

    return {
      cancelada: true,
      gateway,
      faturasCanceladas: abertas.length,
      plano: atualizada.plan,
      planoPendente: atualizada.pendingPlan,
      status: atualizada.status,
      trialEndsAt: atualizada.trialEndsAt,
    };
  }

  async toggleTenantActive(tenantId: string): Promise<unknown> {
    const tenant = await this.privilegiado.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');

    const updated = await this.privilegiado.tenant.update({
      where: { id: tenantId },
      data:  { isActive: !tenant.isActive },
    });

    await this.writeAudit({
      action: updated.isActive ? 'tenant_activated' : 'tenant_deactivated',
      entityType: 'tenant',
      entityId: tenantId,
    });

    return updated;
  }

  /** Gera token temporário para impersonar o admin de um tenant */
  async impersonate(tenantId: string): Promise<{ token: string; user: unknown }> {
    const tenant = await this.privilegiado.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');

    const user = await this.privilegiado.user.findFirst({
      where: { tenantId, role: 'tenant_admin', status: 'active' },
    });
    if (!user) throw new BadRequestException('Nenhum admin ativo nesta concessionária');

    // JWT com 2h de validade — para que o admin consiga navegar o dashboard
    const token = this.jwt.sign(
      { sub: user.id, role: user.role, tenantId: user.tenantId },
      { expiresIn: '2h' },
    );

    await this.writeAudit({
      action: 'impersonation',
      entityType: 'tenant',
      entityId: tenantId,
      diff: { targetUserId: user.id, targetEmail: user.email },
    });

    return {
      token,
      user: {
        id: user.id, email: user.email,
        fullName: user.fullName, role: user.role,
        tenantId: user.tenantId,
      },
    };
  }

  /* ── Usuários ──────────────────────────────────────────────────────── */

  async listUsers(opts: { role?: UserRoleFiltro; search?: string; page?: number }): Promise<unknown[]> {
    const page  = opts.page ?? 1;
    const take  = 30;
    const skip  = (page - 1) * take;

    return this.privilegiado.user.findMany({
      where: {
        role: opts.role ? opts.role : { not: 'super_admin' },
        ...(opts.search ? {
          OR: [
            { fullName: { contains: opts.search, mode: 'insensitive' } },
            { email:    { contains: opts.search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: {
        id: true, fullName: true, email: true, phone: true,
        role: true, status: true, jobTitle: true,
        lastLoginAt: true, createdAt: true,
        tenant: { select: { id: true, tradeName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take, skip,
    }) as Promise<unknown[]>;
  }

  async toggleUserSuspend(userId: string): Promise<unknown> {
    const user = await this.privilegiado.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.role === 'super_admin') throw new BadRequestException('Não é possível suspender super_admin');

    const newStatus = user.status === 'suspended' ? 'active' : 'suspended';

    await this.writeAudit({
      action: newStatus === 'suspended' ? 'user_suspended' : 'user_activated',
      entityType: 'user',
      entityId: userId,
    });

    return this.privilegiado.user.update({
      where: { id: userId },
      data:  { status: newStatus },
    });
  }

  async sendPasswordReset(userId: string): Promise<{ message: string }> {
    const user = await this.privilegiado.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const token = this.jwt.sign(
      { sub: user.id, purpose: 'password-reset' },
      { expiresIn: '1h' },
    );

    this.email.sendPasswordReset(user.email, user.fullName, token).catch(() => null);

    await this.writeAudit({
      action: 'admin_password_reset_sent',
      entityType: 'user',
      entityId: userId,
    });

    return { message: `Link de redefinição enviado para ${user.email}` };
  }

  /* ── Avisos globais ────────────────────────────────────────────────── */

  async createAnnouncement(data: {
    message: string;
    type?: string;
    expiresAt?: string | null;
  }): Promise<unknown> {
    // Desativa avisos anteriores do mesmo tipo
    await this.privilegiado.announcement.updateMany({
      where: { isActive: true },
      data:  { isActive: false },
    });

    return this.privilegiado.announcement.create({
      data: {
        message:   data.message,
        type:      data.type ?? 'info',
        isActive:  true,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });
  }

  listAnnouncements(): Promise<unknown[]> {
    return this.privilegiado.announcement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    }) as Promise<unknown[]>;
  }

  /** Endpoint público — chamado pelo dashboard de todos os tenants */
  async getActiveAnnouncement(): Promise<unknown | null> {
    return this.privilegiado.announcement.findFirst({
      where: {
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deactivateAnnouncement(id: string): Promise<unknown> {
    const ann = await this.privilegiado.announcement.findUnique({ where: { id } });
    if (!ann) throw new NotFoundException('Aviso não encontrado');
    return this.privilegiado.announcement.update({ where: { id }, data: { isActive: false } });
  }

  /* ── Auditoria ─────────────────────────────────────────────────────── */

  async getAuditLog(opts: { page?: number; action?: string }): Promise<unknown> {
    const page = opts.page ?? 1;
    const take = 30;
    const skip = (page - 1) * take;

    const where = opts.action ? { action: { contains: opts.action } } : {};

    const [entries, total] = await Promise.all([
      this.privilegiado.auditLog.findMany({
        where,
        include: { actor: { select: { fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take, skip,
      }),
      this.privilegiado.auditLog.count({ where }),
    ]);

    return {
      // `audit_log.id` é BigInt e o JSON.stringify do Nest não sabe serializá-lo:
      // com a tabela vazia a rota passava, e quebrava com 500 assim que existia
      // um registro. Vai como string, que é o que o front usa como chave.
      entries: entries.map((e) => ({ ...e, id: e.id.toString() })),
      total,
      page,
      pages: Math.ceil(total / take),
    };
  }

  async writeAudit(data: {
    action: string;
    entityType: string;
    entityId?: string;
    actorUserId?: string;
    diff?: Record<string, unknown>;
  }): Promise<void> {
    void this.privilegiado.auditLog.create({
      data: {
        action:      data.action,
        entityType:  data.entityType,
        entityId:    data.entityId   ?? null,
        actorUserId: data.actorUserId ?? null,
        diff:        (data.diff ?? {}) as never,
      },
    }).catch(() => undefined); // nunca bloqueia a operação principal
  }

  /* ── Status do sistema ─────────────────────────────────────────────── */

  /**
   * Estado das dependências. Tudo em paralelo e com teto de 3s por serviço —
   * o painel não pode demorar a soma dos tempos.
   *
   * `off` é ausência deliberada (a variável não existe, a função fica
   * desligada e a tela explica); `down` é configurado e falhando. Confundir os
   * dois é o que faz alguém ir atrás de "queda" num serviço que nunca foi ligado.
   */
  async getSystemHealth() {
    const medir = async (
      base: Pick<ServicoVerificado, 'key' | 'label' | 'provider'>,
      teste: () => Promise<boolean>,
    ): Promise<ServicoVerificado> => {
      const t0 = Date.now();
      try {
        const ok = await teste();
        return { ...base, status: ok ? 'up' : 'down', latencyMs: Date.now() - t0 };
      } catch (e) {
        return { ...base, status: 'down', detail: e instanceof Error ? e.message : String(e) };
      }
    };
    const http = (url: string, aceita: (r: Response) => boolean) => async () =>
      aceita(await fetch(url, { signal: AbortSignal.timeout(3000) }));

    const cloudName = this.config.get<string>('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME');

    const services = await Promise.all<ServicoVerificado>([
      medir({ key: 'database', label: 'Banco de dados' }, async () => {
        await this.privilegiado.$queryRaw`SELECT 1`;
        return true;
      }),
      this.verificarDocumentos(),
      this.verificarAssinatura(),
      Promise.resolve(estadoDaCobrancaNoPainel(
        this.cobranca,
        this.config.get<string>('COBRANCA_FORNECEDOR')?.trim(),
      )),
      Promise.resolve(this.verificarConsulta()),
      Promise.resolve(this.verificarEmail()),
      Promise.resolve(this.verificarGoogle()),
      medir({ key: 'brasilapi', label: 'BrasilAPI (CNPJ)' },
        http('https://brasilapi.com.br/api/cnpj/v1/00000000000000', (r) => r.status < 500)),
      medir({ key: 'viacep', label: 'ViaCEP' },
        http('https://viacep.com.br/ws/01310100/json/', (r) => r.ok)),
      cloudName
        ? medir({ key: 'cloudinary', label: 'Cloudinary (fotos)' },
          http(`https://res.cloudinary.com/${cloudName}/image/upload/sample`, (r) => r.status < 500))
        : Promise.resolve<ServicoVerificado>({
          key: 'cloudinary', label: 'Cloudinary (fotos)', status: 'off',
          detail: 'O upload é feito pelo navegador; a API não tem o nome da conta para testar.',
        }),
    ]);

    return { checkedAt: new Date().toISOString(), services, cronJobs: this.crons() };
  }

  private async verificarDocumentos(): Promise<ServicoVerificado> {
    const v = await this.documentos.verificar();
    return {
      key: 'documents',
      label: 'Documentos privados',
      provider: `supabase:${v.bucket}`,
      status: v.status,
      latencyMs: v.latenciaMs,
      detail: v.status === 'off'
        ? 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: contratos são regerados sob demanda, sem arquivo.'
        : v.detalhe,
    };
  }

  private async verificarAssinatura(): Promise<ServicoVerificado> {
    const base = { key: 'signature', label: 'Assinatura eletrônica', provider: this.assinatura.nome };
    const pedido = this.config.get<string>('ASSINATURA_FORNECEDOR')?.trim();

    if (!this.assinatura.disponivel) {
      // Pedido e não montado = configuração incompleta (o motivo está no log
      // da subida). Não pedido = desligado de propósito.
      return pedido
        ? { ...base, provider: pedido, status: 'down', detail: `ASSINATURA_FORNECEDOR=${pedido}, mas o provedor não subiu — veja o log de inicialização.` }
        : { ...base, status: 'off', detail: 'Só a assinatura registrada no sistema está disponível.' };
    }
    if (!this.assinatura.verificar) {
      return { ...base, status: 'up', detail: this.assinatura.nome === 'simulado' ? 'Simulado: nenhum documento sai deste servidor.' : undefined };
    }

    const v = await this.assinatura.verificar();
    const ambiente = this.assinatura.sandbox ? 'Sandbox: assinaturas sem validade jurídica.' : undefined;
    return {
      ...base,
      status: v.ok ? 'up' : 'down',
      latencyMs: v.latenciaMs,
      detail: [ambiente, v.detalhe].filter(Boolean).join(' ') || undefined,
    };
  }

  private verificarConsulta(): ServicoVerificado {
    const base = { key: 'vehicleQuery', label: 'Consulta veicular', provider: this.consulta.nome };
    if (this.consulta.nome === 'nenhum') {
      return { ...base, status: 'off', detail: 'Sem fornecedor contratado: a consulta é recusada com 503.' };
    }
    return {
      ...base,
      status: 'up',
      detail: this.consulta.nome === 'simulado'
        ? 'Simulado: resultado derivado da placa, não é dado real.'
        : `R$ ${(this.consulta.custoCentavos / 100).toFixed(2).replace('.', ',')} por chamada.`,
    };
  }

  /** Só diz qual está montado — testar o envio é da subida (fica no log). */
  private verificarEmail(): ServicoVerificado {
    const provedor = this.email.provedor;
    return provedor
      ? { key: 'email', label: 'E-mail', provider: provedor, status: 'up', detail: 'Configurado. O envio é testado na inicialização (ver log).' }
      : { key: 'email', label: 'E-mail', status: 'off', detail: 'Sem RESEND_API_KEY nem Gmail: os links saem só no log.' };
  }

  private verificarGoogle(): ServicoVerificado {
    const ok = !!this.config.get<string>('GOOGLE_CLIENT_ID') && !!this.config.get<string>('GOOGLE_CLIENT_SECRET');
    return ok
      ? { key: 'google', label: 'Login com Google', provider: 'google', status: 'up' }
      : { key: 'google', label: 'Login com Google', status: 'off', detail: 'GOOGLE_CLIENT_ID/SECRET ausentes: o botão não funciona.' };
  }

  /**
   * Crons desta réplica. `lastRun` é da memória do processo — zera no deploy e,
   * com duas réplicas, só uma delas executa cada disparo (trava no banco).
   */
  private crons() {
    return [...this.agendador.getCronJobs().entries()].map(([name, job]) => {
      let nextRun: string | null = null;
      try { nextRun = job.nextDate().toJSDate().toISOString(); } catch { nextRun = null; }
      return { name, lastRun: job.lastDate()?.toISOString() ?? null, nextRun };
    });
  }
}
