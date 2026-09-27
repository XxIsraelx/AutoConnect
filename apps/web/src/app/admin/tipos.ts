/**
 * Formato das respostas de `/admin/*`. Dinheiro chega como string decimal
 * (nunca `number`) e custo de consulta em centavos inteiros.
 */

export interface JanelaDeFaturamento { count: number; gmv: string; margin: string }

export interface Stats {
  totalTenants: number; activeTenants: number; inactiveTenants: number;
  trialTenants: number; paidTenants: number; newTenantsMonth: number;
  totalUsers: number; totalVehicles: number; totalLeads: number;
  totalLeadsNew: number; activeInvites: number;
  openConversations: number;
  monthStartsAt: string;
  deals: { total: number; open: number; won: number; canceled: number; byStatus: Record<string, number> };
  revenue: { last30d: JanelaDeFaturamento; monthToDate: JanelaDeFaturamento };
  contracts: {
    issued: number; pendingSignature: number; signed: number;
    signedExternal: number; signedInternal: number; voided: number;
  };
  externalSignatures: Record<string, number>;
  vehicleQueries: {
    provider: string;
    unitCostCents: number;
    month: { count: number; failed: number; spendCents: number };
  };
}

export interface Invite {
  id: string; token: string; email: string | null; note: string | null;
  usedAt: string | null; expiresAt: string; createdAt: string;
}

export interface MetricasDaLoja {
  invoicedDeals30d: number;
  gmv30d: string;
  vehicleQueriesMonth: number;
  vehicleQuerySpendMonthCents: number;
  lastActivityAt: string | null;
}

export interface Tenant {
  id: string; slug: string; tradeName: string; legalName: string; taxId: string | null;
  primaryEmail: string; isActive: boolean; createdAt: string;
  subscription: { plan: string; status: string; trialEndsAt?: string | null } | null;
  /**
   * O veredito de cobrança, calculado na API pela **mesma** `avaliarCobranca`
   * que bloqueia a loja. O painel não recalcula nada: se ele tivesse a própria
   * regra, diria "em dia" para quem a API está recusando — e é aqui que se
   * olha quando alguém liga reclamando.
   */
  cobranca: {
    plan: string | null;
    status: string | null;
    trialEndsAt: string | null;
    /**
     * Plano contratado e **não pago**. Enquanto está aqui, a loja segue no
     * `plan` — é o que distingue "escolheu um plano" de "está pagando".
     */
    planoPendente: string | null;
    pendenteDesde: string | null;
    /** A assinatura no gateway, quando há. É o que o cancelamento alcança. */
    gateway: { provedor: string | null; assinaturaExterna: string } | null;
    situacao: string;
    somenteLeitura: boolean;
    diasRestantes: number | null;
    prazoAte: string | null;
    inadimplente: boolean;
    /** Loja isenta (fundadora ou interna). */
    cortesia: { desde: string; motivo: string | null } | null;
    ultimaFatura: { status: string; valor: string; vencimento: string; pagoEm: string | null } | null;
  };
  branches: { city: string | null; state: string | null }[];
  legalRep: { configured: boolean; hasEmail: boolean };
  metrics: MetricasDaLoja;
}

/**
 * Uma fatura da loja, como o painel do super admin a vê.
 *
 * Traz o link de pagamento e o id no gateway de propósito: é por esta tela que
 * se conserta uma cobrança gerada por engano, e sem os dois não há como
 * conferir o que o cliente vê nem casar a linha com a cobrança de lá.
 */
export interface FaturaDaLoja {
  id: string; status: string; valor: string;
  vencimento: string; pagoEm: string | null; meio: string | null;
  urlPagamento: string | null; descricao: string | null;
  provedor: string; externalId: string; criadaEm: string;
  /** Só fatura em aberto se cancela; paga e estornada são história. */
  cancelavel: boolean;
}

export interface TenantDetail extends Omit<Tenant, 'legalRep'> {
  stateRegistration: string | null; primaryPhone: string | null;
  users: { id: string; fullName: string; email: string; role: string; status: string; lastLoginAt: string | null; createdAt: string }[];
  vehicleCount: number; leadCount: number; leadNewCount: number;
  legalRep: { configured: boolean; hasEmail: boolean; name: string | null; role: string | null };
  faturas: FaturaDaLoja[];
  /** Qual gateway está montado agora — sem ele o cancelamento não sai do banco. */
  gatewayDeCobranca: { provedor: string; disponivel: boolean };
}

export interface UserRow {
  id: string; fullName: string; email: string; phone: string | null;
  role: string; status: string; jobTitle: string | null;
  lastLoginAt: string | null; createdAt: string;
  tenant: { id: string; tradeName: string } | null;
}

export interface AnnRow { id: string; message: string; type: string; isActive: boolean; expiresAt: string | null; createdAt: string }

export interface AuditEntry {
  id: number; action: string; entityType: string; entityId: string | null;
  diff: Record<string, unknown>; createdAt: string;
  actor: { fullName: string; email: string } | null;
}

export interface AuditPage { entries: AuditEntry[]; total: number; page: number; pages: number }

export type StatusDoServico = 'up' | 'down' | 'off';

export interface ServicoVerificado {
  key: string; label: string; status: StatusDoServico;
  latencyMs?: number; provider?: string; detail?: string;
}

export interface SystemHealth {
  checkedAt: string;
  services: ServicoVerificado[];
  cronJobs: { name: string; lastRun: string | null; nextRun: string | null }[];
}

/* ── Validação de saque (Asaas) ────────────────────────────── */

export interface AutorizacaoDeSaqueRow {
  id: string; tipo: string; modo: string; valor: string; observacao: string | null;
  expiraEm: string; usadaEm: string | null; revogadaEm: string | null;
  criadaPor: string | null; criadaEm: string;
  /** `valida | usada | revogada | expirada`, derivado na API. */
  situacao: string;
}

export interface DecisaoDeSaqueRow {
  id: string; tipo: string; operacao: string; valor: string | null;
  /** `APPROVED` ou `REFUSED` — o que foi respondido à Asaas, literalmente. */
  decisao: string;
  motivo: string | null; autorizacaoId: string | null; tokenOk: boolean; quando: string;
}

export interface PainelDeSaques {
  /** Falso quando `ASAAS_SAQUE_TOKEN` não está configurado: recusa tudo. */
  configurado: boolean;
  provedor: string;
  validadePadraoMinutos: number;
  autorizacoes: AutorizacaoDeSaqueRow[];
  decisoes: DecisaoDeSaqueRow[];
}
