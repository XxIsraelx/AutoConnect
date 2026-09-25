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
    situacao: string;
    somenteLeitura: boolean;
    diasRestantes: number | null;
    prazoAte: string | null;
    inadimplente: boolean;
    ultimaFatura: { status: string; valor: string; vencimento: string; pagoEm: string | null } | null;
  };
  branches: { city: string | null; state: string | null }[];
  legalRep: { configured: boolean; hasEmail: boolean };
  metrics: MetricasDaLoja;
}

export interface TenantDetail extends Omit<Tenant, 'legalRep'> {
  stateRegistration: string | null; primaryPhone: string | null;
  users: { id: string; fullName: string; email: string; role: string; status: string; lastLoginAt: string | null; createdAt: string }[];
  vehicleCount: number; leadCount: number; leadNewCount: number;
  legalRep: { configured: boolean; hasEmail: boolean; name: string | null; role: string | null };
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
