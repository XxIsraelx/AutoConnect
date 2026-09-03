'use client';

import { useState, useEffect, useCallback} from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, Ticket, Building2, Users, Megaphone,
  ClipboardList, Activity, LogOut, ChevronRight,
  Plus, Copy, Trash2, Ban, CheckCircle2, RefreshCw,
  Check, AlertCircle, Loader2, ExternalLink, Key,
  TrendingUp, Car, UserCheck, ArrowUpRight, X,
  ShieldAlert, Info, AlertTriangle, OctagonAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Stats {
  totalTenants: number; activeTenants: number; inactiveTenants: number;
  trialTenants: number; paidTenants: number; newTenantsMonth: number;
  totalUsers: number; totalVehicles: number; totalLeads: number;
  totalLeadsNew: number; activeInvites: number;
}
interface Invite {
  id: string; token: string; email: string | null; note: string | null;
  usedAt: string | null; expiresAt: string; createdAt: string;
}
interface Tenant {
  id: string; tradeName: string; legalName: string; taxId: string | null;
  primaryEmail: string; isActive: boolean; createdAt: string;
  subscription: { plan: string; status: string } | null;
  branches: { city: string | null; state: string | null }[];
}
interface TenantDetail extends Tenant {
  stateRegistration: string | null; primaryPhone: string | null;
  users: { id: string; fullName: string; email: string; role: string; status: string; lastLoginAt: string | null; createdAt: string }[];
  vehicleCount: number; leadCount: number; leadNewCount: number;
}
interface UserRow {
  id: string; fullName: string; email: string; phone: string | null;
  role: string; status: string; jobTitle: string | null;
  lastLoginAt: string | null; createdAt: string;
  tenant: { id: string; tradeName: string } | null;
}
interface AnnRow { id: string; message: string; type: string; isActive: boolean; expiresAt: string | null; createdAt: string }
interface AuditEntry {
  id: number; action: string; entityType: string; entityId: string | null;
  diff: Record<string, unknown>; createdAt: string;
  actor: { fullName: string; email: string } | null;
}

type Tab = 'overview' | 'invites' | 'tenants' | 'users' | 'announcements' | 'audit' | 'system';

/**
 * A própria origem do navegador — não uma variável de ambiente.
 *
 * Antes era `process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'`, e
 * como `NEXT_PUBLIC_*` é embutida no bundle durante o `next build`, bastava a
 * variável não existir no serviço para produção carregar `localhost:3000`
 * cravado. Era o que acontecia: o botão de impersonar mandava o super admin
 * para a máquina dele, e o navegador respondia "não é possível acessar".
 *
 * Este arquivo é `'use client'`, então `window.location.origin` está sempre
 * disponível na hora do clique e acerta em qualquer ambiente — local, preview
 * ou produção — sem precisar configurar nada.
 */
function urlDoSite(): string {
  return typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000');
}
const PLANS   = ['trial', 'starter', 'pro', 'enterprise'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function isExpired(iso: string) { return new Date(iso) < new Date(); }

const ROLE_LABEL: Record<string, string> = {
  tenant_admin: 'Admin', manager: 'Gerente', salesperson: 'Vendedor', customer: 'Cliente', super_admin: 'Super Admin',
};
const PLAN_COLOR: Record<string, string> = {
  trial: 'bg-slate-100 dark:bg-slate-800 text-slate-500',
  starter: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600',
  pro: 'bg-purple-50 dark:bg-purple-500/10 text-purple-600',
  enterprise: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600',
};

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, kind }: { msg: string; kind: 'success' | 'error' }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white animate-in slide-in-from-bottom-2 ${kind === 'success' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
      {kind === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
      {msg}
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, accent, sub }: {
  label: string; value: number | string; icon: React.ElementType; accent: string; sub?: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accent}`}>
          <Icon size={17} />
        </div>
        <ArrowUpRight size={13} className="text-slate-300" />
      </div>
      <p className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{value}</p>
      <p className="text-xs font-medium text-slate-500 mt-1">{label}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Drawer de detalhes do tenant ─────────────────────────────────────────────

function TenantDrawer({
  tenant, onClose, onChangePlan, onExtendTrial, onImpersonate,
}: {
  tenant: TenantDetail;
  onClose: () => void;
  onChangePlan: (plan: string) => void;
  onExtendTrial: (days: number) => void;
  onImpersonate: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg">{tenant.tradeName}</h3>
            <p className="text-xs text-slate-500">{tenant.legalName}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Stats rápidos */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Veículos', value: tenant.vehicleCount, color: 'text-blue-600' },
              { label: 'Leads',    value: tenant.leadCount,    color: 'text-emerald-600' },
              { label: 'Novos',    value: tenant.leadNewCount, color: 'text-amber-600' },
            ].map((s) => (
              <div key={s.label} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Dados */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Dados</h4>
            <dl className="space-y-2 text-sm">
              {[
                ['CNPJ', tenant.taxId ?? '—'],
                ['IE', tenant.stateRegistration ?? '—'],
                ['E-mail', tenant.primaryEmail],
                ['Telefone', tenant.primaryPhone ?? '—'],
                ['Cadastro', fmtDate(tenant.createdAt)],
                ['Cidade', tenant.branches[0] ? `${tenant.branches[0].city}/${tenant.branches[0].state}` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-slate-400 shrink-0">{k}</dt>
                  <dd className="font-medium text-right truncate">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Plano */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Plano</h4>
            <div className="flex gap-2 flex-wrap">
              {PLANS.map((p) => (
                <button key={p} onClick={() => onChangePlan(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition capitalize ${
                    tenant.subscription?.plan === p
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}>
                  {p}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <p className="text-xs text-slate-400 mb-2">Estender trial por:</p>
              <div className="flex gap-2">
                {[7, 14, 30].map((d) => (
                  <button key={d} onClick={() => onExtendTrial(d)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                    +{d} dias
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Usuários */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              Usuários ({tenant.users.length})
            </h4>
            <div className="space-y-2">
              {tenant.users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
                    <span className="text-blue-600 text-xs font-bold">{u.fullName.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.fullName}</p>
                    <p className="text-xs text-slate-400 truncate">{u.email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium">{ROLE_LABEL[u.role] ?? u.role}</p>
                    <p className="text-[10px] text-slate-400">
                      {u.status === 'suspended' ? '🔴 Suspenso' : u.lastLoginAt ? `Último: ${fmtDate(u.lastLoginAt)}` : 'Nunca logou'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Ações */}
          <div className="flex gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button onClick={onImpersonate}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
              <ExternalLink size={14} /> Impersonar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ──────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter();
  const { token, user, clear } = useAuthStore();

  const [tab, setTab]     = useState<Tab>('overview');
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);
  const [loading, setLoading] = useState(false);

  // dados por aba
  const [stats,     setStats]     = useState<Stats | null>(null);
  const [invites,   setInvites]   = useState<Invite[]>([]);
  const [tenants,   setTenants]   = useState<Tenant[]>([]);
  const [users,     setUsers]     = useState<UserRow[]>([]);
  const [anns,      setAnns]      = useState<AnnRow[]>([]);
  const [audit,     setAudit]     = useState<{ entries: AuditEntry[]; total: number; pages: number } | null>(null);
  const [sysHealth, setSysHealth] = useState<Record<string, { status: 'up' | 'down'; latencyMs?: number }> | null>(null);

  // estados locais de formulários
  const [newEmail, setNewEmail]   = useState('');
  const [newNote,  setNewNote]    = useState('');
  const [newExpires, setNewExpires] = useState(7);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copiedId,  setCopiedId]  = useState<string | null>(null);

  const [annMsg,    setAnnMsg]    = useState('');
  const [annType,   setAnnType]   = useState('info');
  const [annExp,    setAnnExp]    = useState('');
  const [creatingAnn, setCreatingAnn] = useState(false);

  const [userSearch, setUserSearch] = useState('');
  const [userRole,   setUserRole]   = useState('');
  const [auditFilter, setAuditFilter] = useState('');
  const [auditPage,   setAuditPage]   = useState(1);

  const [selectedTenant, setSelectedTenant] = useState<TenantDetail | null>(null);

  // auth guard
  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    if (user?.role !== 'super_admin') router.replace('/dashboard');
  }, [token, user, router]);

  function showToast(msg: string, kind: 'success' | 'error' = 'success') {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  }

  function call<T>(path: string, opts?: RequestInit): Promise<T> {
    return api<T>(path, { token: token!, ...(opts ?? {}) });
  }

  // ── Fetch por aba ──────────────────────────────────────────────────────────

  const loadTab = useCallback(async (t: Tab) => {
    setLoading(true);
    try {
      switch (t) {
        case 'overview':      setStats(await call('/admin/stats')); break;
        case 'invites':       setInvites(await call('/admin/invites')); break;
        case 'tenants':       setTenants(await call('/admin/tenants')); break;
        case 'users':         setUsers(await call('/admin/users')); break;
        case 'announcements': setAnns(await call('/admin/announcements')); break;
        case 'audit':         setAudit(await call('/admin/audit')); break;
        case 'system':        setSysHealth(await call('/admin/system')); break;
      }
    } catch { showToast('Erro ao carregar dados', 'error'); }
    finally   { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || user?.role !== 'super_admin') return;
    loadTab(tab);
  }, [tab, token, user, loadTab]);

  // ── Convites ───────────────────────────────────────────────────────────────

  async function createInvite() {
    setCreatingInvite(true);
    try {
      const inv = await call<Invite>('/admin/invites', {
        method: 'POST',
        body: JSON.stringify({ email: newEmail || undefined, note: newNote || undefined, expiresInDays: newExpires }),
      });
      setInvites((p) => [inv, ...p]);
      setNewEmail(''); setNewNote(''); setNewExpires(7); setShowInviteForm(false);
      showToast('Convite criado!');
    } catch { showToast('Erro ao criar convite', 'error'); }
    finally   { setCreatingInvite(false); }
  }

  async function revokeInvite(id: string) {
    await call(`/admin/invites/${id}/revoke`, { method: 'PATCH' });
    setInvites((p) => p.map((i) => i.id === id ? { ...i, usedAt: new Date().toISOString() } : i));
    showToast('Convite invalidado');
  }

  async function deleteInvite(id: string) {
    if (!confirm('Remover permanentemente?')) return;
    await call(`/admin/invites/${id}`, { method: 'DELETE' });
    setInvites((p) => p.filter((i) => i.id !== id));
    showToast('Convite removido');
  }

  function copyLink(token: string, id: string) {
    navigator.clipboard.writeText(`${urlDoSite()}/signup?invite=${token}`);
    setCopiedId(id); setTimeout(() => setCopiedId(null), 2000);
  }

  // ── Tenants ────────────────────────────────────────────────────────────────

  async function openTenantDetail(id: string) {
    try {
      const detail = await call<TenantDetail>(`/admin/tenants/${id}`);
      setSelectedTenant(detail);
    } catch { showToast('Erro ao carregar detalhes', 'error'); }
  }

  async function changePlan(tenantId: string, plan: string) {
    await call(`/admin/tenants/${tenantId}/plan`, { method: 'PATCH', body: JSON.stringify({ plan }) });
    if (selectedTenant?.id === tenantId) {
      setSelectedTenant((t) => t ? { ...t, subscription: { ...t.subscription!, plan } } : t);
    }
    setTenants((p) => p.map((t) => t.id === tenantId ? { ...t, subscription: { ...t.subscription!, plan } } : t));
    showToast(`Plano alterado para ${plan}`);
  }

  async function extendTrial(tenantId: string, days: number) {
    await call(`/admin/tenants/${tenantId}/extend-trial`, { method: 'PATCH', body: JSON.stringify({ days }) });
    showToast(`Trial estendido por +${days} dias`);
  }

  async function impersonate(tenantId: string) {
    try {
      const data = await call<{ token: string; user: unknown }>(`/admin/impersonate/${tenantId}`, { method: 'POST' });
      const url  = `${urlDoSite()}/impersonate?token=${data.token}&user=${encodeURIComponent(JSON.stringify(data.user))}`;
      window.open(url, '_blank');
    } catch { showToast('Erro ao impersonar', 'error'); }
  }

  async function toggleTenant(id: string) {
    const updated = await call<Tenant>(`/admin/tenants/${id}/toggle`, { method: 'PATCH' });
    setTenants((p) => p.map((t) => t.id === id ? { ...t, isActive: updated.isActive } : t));
    showToast(updated.isActive ? 'Concessionária ativada' : 'Concessionária desativada');
  }

  // ── Usuários ───────────────────────────────────────────────────────────────

  async function searchUsers() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (userRole)   params.set('role', userRole);
      if (userSearch) params.set('search', userSearch);
      setUsers(await call(`/admin/users?${params}`));
    } catch { showToast('Erro ao buscar usuários', 'error'); }
    finally { setLoading(false); }
  }

  async function toggleSuspend(id: string) {
    const updated = await call<UserRow>(`/admin/users/${id}/suspend`, { method: 'PATCH' });
    setUsers((p) => p.map((u) => u.id === id ? { ...u, status: updated.status } : u));
    showToast(updated.status === 'suspended' ? 'Usuário suspenso' : 'Usuário reativado');
  }

  async function sendReset(id: string) {
    const { message } = await call<{ message: string }>(`/admin/users/${id}/reset-password`, { method: 'POST' });
    showToast(message);
  }

  // ── Avisos ─────────────────────────────────────────────────────────────────

  async function createAnnouncement() {
    if (!annMsg.trim()) return;
    setCreatingAnn(true);
    try {
      const ann = await call<AnnRow>('/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({ message: annMsg, type: annType, expiresAt: annExp || null }),
      });
      setAnns((p) => [ann, ...p]);
      setAnnMsg(''); setAnnType('info'); setAnnExp('');
      showToast('Aviso publicado!');
    } catch { showToast('Erro ao publicar aviso', 'error'); }
    finally   { setCreatingAnn(false); }
  }

  async function deactivateAnn(id: string) {
    await call(`/admin/announcements/${id}/deactivate`, { method: 'PATCH' });
    setAnns((p) => p.map((a) => a.id === id ? { ...a, isActive: false } : a));
    showToast('Aviso desativado');
  }

  // ── Auditoria ──────────────────────────────────────────────────────────────

  async function loadAudit(page: number, action?: string) {
    const params = new URLSearchParams({ page: String(page) });
    if (action) params.set('action', action);
    setAudit(await call(`/admin/audit?${params}`));
    setAuditPage(page);
  }

  if (!token || user?.role !== 'super_admin') return null;

  const inputCls = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition';

  const NAV: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'overview',       label: 'Visão geral',     icon: LayoutDashboard },
    { id: 'invites',        label: 'Convites',         icon: Ticket          },
    { id: 'tenants',        label: 'Concessionárias',  icon: Building2       },
    { id: 'users',          label: 'Usuários',         icon: Users           },
    { id: 'announcements',  label: 'Avisos',           icon: Megaphone       },
    { id: 'audit',          label: 'Auditoria',        icon: ClipboardList   },
    { id: 'system',         label: 'Sistema',          icon: Activity        },
  ];

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      {toast && <Toast msg={toast.msg} kind={toast.kind} />}
      {selectedTenant && (
        <TenantDrawer
          tenant={selectedTenant}
          onClose={() => setSelectedTenant(null)}
          onChangePlan={(plan) => changePlan(selectedTenant.id, plan)}
          onExtendTrial={(days) => extendTrial(selectedTenant.id, days)}
          onImpersonate={() => impersonate(selectedTenant.id)}
        />
      )}

      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
        <div className="px-5 py-5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <ShieldAlert size={13} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-sm leading-tight">AutoConnect</p>
              <p className="text-[10px] text-slate-400">Admin</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}>
              <Icon size={15} />
              {label}
              {tab === id && <ChevronRight size={13} className="ml-auto" />}
            </button>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-slate-200 dark:border-slate-800">
          <div className="px-3 py-2 mb-1">
            <p className="text-sm font-medium truncate">{user?.fullName}</p>
            <p className="text-xs text-slate-400 truncate">{user?.email}</p>
          </div>
          <button onClick={() => { clear(); router.replace('/login'); }}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <LogOut size={14} /> Sair
          </button>
        </div>
      </aside>

      {/* Conteúdo */}
      <main className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {NAV.find((n) => n.id === tab)?.label}
          </h1>
          <button onClick={() => loadTab(tab)}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition">
            <RefreshCw size={14} className={loading ? 'animate-spin text-slate-400' : 'text-slate-500'} />
          </button>
        </div>

        {/* ── Visão Geral ─────────────────────────────────────── */}
        {tab === 'overview' && stats && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Concessionárias" value={stats.totalTenants} icon={Building2}
                accent="bg-blue-50 dark:bg-blue-500/10 text-blue-600"
                sub={`${stats.activeTenants} ativas · ${stats.newTenantsMonth} novas este mês`} />
              <StatCard label="Trial / Pagas" value={`${stats.trialTenants} / ${stats.paidTenants}`}
                icon={TrendingUp} accent="bg-purple-50 dark:bg-purple-500/10 text-purple-600" />
              <StatCard label="Usuários" value={stats.totalUsers} icon={Users}
                accent="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600" />
              <StatCard label="Veículos" value={stats.totalVehicles} icon={Car}
                accent="bg-amber-50 dark:bg-amber-500/10 text-amber-600" />
              <StatCard label="Leads totais" value={stats.totalLeads} icon={UserCheck}
                accent="bg-rose-50 dark:bg-rose-500/10 text-rose-600"
                sub={`${stats.totalLeadsNew} aguardando resposta`} />
              <StatCard label="Convites ativos" value={stats.activeInvites} icon={Ticket}
                accent="bg-slate-100 dark:bg-slate-800 text-slate-500" />
              <StatCard label="Inativas" value={stats.inactiveTenants} icon={Ban}
                accent="bg-slate-100 dark:bg-slate-800 text-slate-500" />
            </div>
          </div>
        )}

        {/* ── Convites ────────────────────────────────────────── */}
        {tab === 'invites' && (
          <div className="space-y-4 max-w-3xl">
            <div className="flex justify-end">
              <button onClick={() => setShowInviteForm((v) => !v)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
                <Plus size={14} /> Novo convite
              </button>
            </div>

            {showInviteForm && (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">E-mail restrito (opcional)</label>
                    <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="empresa@ex.com" type="email" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Validade</label>
                    <select value={newExpires} onChange={(e) => setNewExpires(+e.target.value)} className={inputCls}>
                      {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} dia{d > 1 ? 's' : ''}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Nota interna</label>
                  <input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Para quem é este convite?" className={inputCls} />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowInviteForm(false)} className="px-4 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition">Cancelar</button>
                  <button onClick={createInvite} disabled={creatingInvite}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition disabled:opacity-50">
                    {creatingInvite ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Criar
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              {invites.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-sm">Nenhum convite criado</div>
              ) : invites.map((inv, i) => {
                const used = !!inv.usedAt, expired = isExpired(inv.expiresAt), active = !used && !expired;
                return (
                  <div key={inv.id} className={`flex items-start gap-3 p-4 ${i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : ''}`}>
                    <span className={`shrink-0 mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${used ? 'bg-slate-100 dark:bg-slate-800 text-slate-400' : expired ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${used ? 'bg-slate-400' : expired ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                      {used ? 'Usado' : expired ? 'Expirado' : 'Ativo'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-slate-500 truncate">{inv.token.slice(0, 32)}…</p>
                      <div className="flex flex-wrap gap-x-3 mt-0.5 text-xs text-slate-400">
                        {inv.email && <span>📧 {inv.email}</span>}
                        {inv.note  && <span>📝 {inv.note}</span>}
                        <span>Expira {fmtDate(inv.expiresAt)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {active && <button onClick={() => copyLink(inv.token, inv.id)} title="Copiar link" className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-400 hover:text-blue-600">{copiedId === inv.id ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}</button>}
                      {active && <button onClick={() => revokeInvite(inv.id)} title="Invalidar" className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-400 hover:text-amber-600"><Ban size={13} /></button>}
                      <button onClick={() => deleteInvite(inv.id)} title="Remover" className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Concessionárias ─────────────────────────────────── */}
        {tab === 'tenants' && (
          <div className="space-y-4 max-w-4xl">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              {tenants.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-sm">Nenhuma concessionária</div>
              ) : tenants.map((t, i) => (
                <div key={t.id} className={`flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition ${i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : ''}`}>
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                    <span className="text-blue-600 font-bold text-sm">{t.tradeName.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{t.tradeName}</p>
                      {!t.isActive && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">Inativa</span>}
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize ${PLAN_COLOR[t.subscription?.plan ?? 'trial']}`}>{t.subscription?.plan ?? 'trial'}</span>
                    </div>
                    <div className="flex gap-3 mt-0.5 text-xs text-slate-400">
                      {t.taxId && <span>{t.taxId}</span>}
                      {t.branches[0]?.city && <span>{t.branches[0].city}/{t.branches[0].state}</span>}
                      <span>Desde {fmtDate(t.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openTenantDetail(t.id)} title="Ver detalhes"
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-400 hover:text-blue-600">
                      <ChevronRight size={15} />
                    </button>
                    <button onClick={() => toggleTenant(t.id)} title={t.isActive ? 'Desativar' : 'Ativar'}
                      className={`p-2 rounded-lg transition ${t.isActive ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-500' : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-500'}`}>
                      {t.isActive ? <Ban size={15} /> : <CheckCircle2 size={15} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Usuários ────────────────────────────────────────── */}
        {tab === 'users' && (
          <div className="space-y-4 max-w-4xl">
            <div className="flex gap-3">
              <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
                placeholder="Buscar por nome ou e-mail…" className={`${inputCls} flex-1`} />
              <select value={userRole} onChange={(e) => setUserRole(e.target.value)} className={`${inputCls} w-40`}>
                <option value="">Todos os roles</option>
                <option value="tenant_admin">Admin</option>
                <option value="manager">Gerente</option>
                <option value="salesperson">Vendedor</option>
                <option value="customer">Cliente</option>
              </select>
              <button onClick={searchUsers} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">Filtrar</button>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              {users.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-sm">Nenhum usuário</div>
              ) : users.map((u, i) => (
                <div key={u.id} className={`flex items-center gap-4 p-4 ${i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : ''}`}>
                  <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-slate-500">{u.fullName.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{u.fullName}</p>
                      {u.status === 'suspended' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-500">Suspenso</span>}
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">{ROLE_LABEL[u.role] ?? u.role}</span>
                    </div>
                    <div className="flex gap-3 mt-0.5 text-xs text-slate-400">
                      <span>{u.email}</span>
                      {u.tenant && <span>🏢 {u.tenant.tradeName}</span>}
                      {u.jobTitle && <span>💼 {u.jobTitle}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0 mr-2">
                    <p className="text-xs text-slate-400">Último acesso</p>
                    <p className="text-xs font-medium">{fmtDate(u.lastLoginAt)}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => sendReset(u.id)} title="Enviar reset de senha"
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-400 hover:text-blue-600">
                      <Key size={14} />
                    </button>
                    <button onClick={() => toggleSuspend(u.id)} title={u.status === 'suspended' ? 'Reativar' : 'Suspender'}
                      className={`p-2 rounded-lg transition ${u.status === 'suspended' ? 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-500' : 'text-slate-400 hover:bg-rose-50 hover:text-rose-500'}`}>
                      {u.status === 'suspended' ? <CheckCircle2 size={14} /> : <Ban size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Avisos ──────────────────────────────────────────── */}
        {tab === 'announcements' && (
          <div className="space-y-6 max-w-2xl">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
              <h3 className="font-semibold text-sm">Publicar aviso global</h3>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Mensagem</label>
                <textarea value={annMsg} onChange={(e) => setAnnMsg(e.target.value)}
                  placeholder="Manutenção programada para domingo às 22h…"
                  className={`${inputCls} resize-none`} rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Tipo</label>
                  <select value={annType} onChange={(e) => setAnnType(e.target.value)} className={inputCls}>
                    <option value="info">ℹ️ Info</option>
                    <option value="warning">⚠️ Aviso</option>
                    <option value="critical">🚨 Crítico</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Expira em (opcional)</label>
                  <input type="datetime-local" value={annExp} onChange={(e) => setAnnExp(e.target.value)} className={inputCls} />
                </div>
              </div>
              <button onClick={createAnnouncement} disabled={creatingAnn || !annMsg.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition disabled:opacity-50">
                {creatingAnn ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}
                Publicar aviso para todas as concessionárias
              </button>
            </div>

            {/* Avisos existentes */}
            <div className="space-y-2">
              {anns.map((a) => {
                const Icon = a.type === 'critical' ? OctagonAlert : a.type === 'warning' ? AlertTriangle : Info;
                const color = a.type === 'critical' ? 'text-red-600' : a.type === 'warning' ? 'text-amber-600' : 'text-blue-600';
                return (
                  <div key={a.id} className={`flex items-start gap-3 p-4 rounded-2xl border ${a.isActive ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800' : 'bg-slate-50 dark:bg-slate-800/30 border-transparent opacity-60'}`}>
                    <Icon size={16} className={`shrink-0 mt-0.5 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{a.message}</p>
                      <p className="text-xs text-slate-400 mt-1">{fmtDateTime(a.createdAt)}{a.expiresAt ? ` · expira ${fmtDateTime(a.expiresAt)}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.isActive && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">Ativo</span>}
                      {a.isActive && (
                        <button onClick={() => deactivateAnn(a.id)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-400 hover:text-rose-500">
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Auditoria ────────────────────────────────────────── */}
        {tab === 'audit' && (
          <div className="space-y-4 max-w-4xl">
            <div className="flex gap-3">
              <input value={auditFilter} onChange={(e) => setAuditFilter(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadAudit(1, auditFilter)}
                placeholder="Filtrar por ação (ex: cnpj_rejected, plan_changed)…"
                className={`${inputCls} flex-1`} />
              <button onClick={() => loadAudit(1, auditFilter)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
                Filtrar
              </button>
            </div>

            {audit && (
              <>
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  {audit.entries.length === 0 ? (
                    <div className="py-16 text-center text-slate-400 text-sm">Nenhum registro</div>
                  ) : audit.entries.map((e, i) => (
                    <div key={e.id} className={`flex items-start gap-3 p-4 ${i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : ''}`}>
                      <span className={`shrink-0 mt-0.5 text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                        e.action.includes('rejected') ? 'bg-rose-50 text-rose-600' :
                        e.action.includes('deactivated') || e.action.includes('suspended') ? 'bg-amber-50 text-amber-600' :
                        'bg-slate-100 dark:bg-slate-800 text-slate-500'
                      }`}>
                        {e.action}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-slate-500 space-x-2">
                          <span className="font-medium">{e.entityType}</span>
                          {e.entityId && <span className="font-mono opacity-60">{e.entityId.slice(0, 8)}…</span>}
                          {e.actor && <span>por {e.actor.fullName}</span>}
                        </div>
                        {Object.keys(e.diff).length > 0 && (
                          <p className="text-xs text-slate-400 mt-0.5 font-mono truncate">
                            {JSON.stringify(e.diff)}
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 shrink-0 whitespace-nowrap">{fmtDateTime(e.createdAt)}</p>
                    </div>
                  ))}
                </div>
                {audit.pages > 1 && (
                  <div className="flex items-center justify-center gap-2">
                    {Array.from({ length: audit.pages }, (_, i) => i + 1).map((p) => (
                      <button key={p} onClick={() => loadAudit(p, auditFilter)}
                        className={`w-8 h-8 rounded-lg text-sm font-medium transition ${p === auditPage ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Sistema ──────────────────────────────────────────── */}
        {tab === 'system' && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl">
            {sysHealth ? Object.entries(sysHealth).map(([name, info]) => (
              <div key={name} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-semibold text-sm capitalize">{name}</p>
                  <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${info.status === 'up' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-600'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${info.status === 'up' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    {info.status === 'up' ? 'Online' : 'Offline'}
                  </span>
                </div>
                {info.latencyMs !== undefined && (
                  <p className="text-2xl font-extrabold text-slate-900 dark:text-white">{info.latencyMs}<span className="text-sm font-normal text-slate-400 ml-1">ms</span></p>
                )}
              </div>
            )) : (
              <div className="col-span-3 py-16 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
