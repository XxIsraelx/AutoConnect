'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  UserPlus, Mail, Clock, Trash2, Copy, CheckCheck, X, Loader2,
  Target, TrendingUp, Users, DollarSign, CalendarCheck, Award,
  ChevronRight, Send, UserX, UserCheck, RefreshCw, Trophy,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';

/* ── Tipos ──────────────────────────────────────────────── */
interface MemberStat {
  id: string; fullName: string; email: string; role: string;
  status: string; lastLoginAt: string | null; avatarUrl: string | null;
  goal: number | null; assigned: number; won: number; conversion: number;
  valueSold: number; appointments: number;
}
interface TeamStat {
  goal: number | null; won: number; assigned: number; conversion: number;
  valueSold: number; vehiclesSold: number; vehiclesSoldValue: number; memberCount: number;
}
interface Overview { period: string; team: TeamStat; members: MemberStat[] }
interface Invitation { id: string; email: string; role: string; expiresAt: string; createdAt: string; acceptUrl?: string }

const ROLE_LABELS: Record<string, string> = {
  tenant_admin: 'Administrador', manager: 'Gerente', salesperson: 'Vendedor',
};
const ROLE_COLORS: Record<string, string> = {
  tenant_admin: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
  manager: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  salesperson: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
};

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}
function fmtPeriod(p: string) {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
function lastNPeriods(n: number) {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/* ── Barra de progresso ─────────────────────────────────── */
function Progress({ value, goal, color = 'blue' }: { value: number; goal: number | null; color?: string }) {
  const pct = goal && goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  const done = goal != null && value >= goal;
  const colors: Record<string, string> = {
    blue: 'bg-blue-600', emerald: 'bg-emerald-500', amber: 'bg-amber-500',
  };
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-semibold text-slate-700 dark:text-slate-300">
          {value}{goal != null && <span className="text-slate-400"> / {goal}</span>}
        </span>
        {goal != null && (
          <span className={cn('font-bold', done ? 'text-emerald-600' : 'text-slate-400')}>
            {done ? '✓ Meta batida' : `${pct}%`}
          </span>
        )}
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', done ? 'bg-emerald-500' : colors[color])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ── KPI card ───────────────────────────────────────────── */
function Kpi({ Icon, label, value, sub, accent }: { Icon: React.ElementType; label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center', accent)}><Icon size={15} /></span>
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <p className="text-2xl font-extrabold leading-none">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
export default function EquipePage() {
  const { token, user } = useAuthStore();
  const isAdmin = user?.role === 'tenant_admin';

  const [period, setPeriod]   = useState(lastNPeriods(1)[0]);
  const [data, setData]       = useState<Overview | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [showInvite, setShowInvite] = useState(false);
  const [showGoals, setShowGoals]   = useState(false);
  const [selected, setSelected]     = useState<MemberStat | null>(null);
  const [busyId, setBusyId]         = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [ov, inv] = await Promise.all([
        api<Overview>(`/team/overview?period=${period}`, { token }),
        api<Invitation[]>('/invitations', { token }),
      ]);
      setData(ov); setInvitations(inv);
    } catch { /* ignora */ }
    finally { setLoading(false); }
  }, [token, period]);

  useEffect(() => { load(); }, [load]);

  async function changeRole(id: string, role: string) {
    if (!token) return;
    setBusyId(id);
    try { await api(`/users/${id}/role`, { token, method: 'PATCH', body: { role } }); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Erro'); }
    finally { setBusyId(null); }
  }
  async function setStatus(id: string, status: 'active' | 'suspended') {
    if (!token) return;
    setBusyId(id);
    try { await api(`/users/${id}/status`, { token, method: 'PATCH', body: { status } }); await load(); setSelected(null); }
    catch (e) { alert(e instanceof Error ? e.message : 'Erro'); }
    finally { setBusyId(null); }
  }
  async function revokeInvite(id: string) {
    if (!token) return;
    await api(`/invitations/${id}`, { token, method: 'DELETE' });
    setInvitations((p) => p.filter((i) => i.id !== id));
  }
  async function resendInvite(id: string) {
    if (!token) return;
    setBusyId(id);
    try {
      const inv = await api<Invitation>(`/invitations/${id}/resend`, { token, method: 'POST' });
      setInvitations((p) => p.map((i) => i.id === id ? { ...i, ...inv } : i));
    } finally { setBusyId(null); }
  }
  function copyLink(inv: Invitation) {
    if (!inv.acceptUrl) return;
    navigator.clipboard.writeText(inv.acceptUrl);
    setCopiedId(inv.id); setTimeout(() => setCopiedId(null), 2000);
  }

  if (loading && !data) {
    return <div className="flex items-center justify-center h-64 text-slate-500"><Loader2 size={20} className="animate-spin mr-2" /> Carregando equipe…</div>;
  }

  const team = data?.team;
  const members = data?.members ?? [];
  const ranking = [...members].sort((a, b) => b.won - a.won);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Equipe & Metas</h1>
          <p className="text-sm text-slate-500 mt-0.5">Desempenho de {fmtPeriod(period)}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500 capitalize">
            {lastNPeriods(6).map((p) => <option key={p} value={p}>{fmtPeriod(p)}</option>)}
          </select>
          <button onClick={load} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </button>
          {isAdmin && (
            <button onClick={() => setShowGoals(true)} className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
              <Target size={14} /> Metas
            </button>
          )}
          <button onClick={() => setShowInvite(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
            <UserPlus size={14} /> Convidar
          </button>
        </div>
      </div>

      {/* Meta da equipe — destaque */}
      {team && (
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-5 text-white relative overflow-hidden">
          <div className="absolute -top-10 -right-6 w-44 h-44 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-blue-100 text-xs font-semibold mb-1">
                <Trophy size={13} /> META DA EQUIPE · {fmtPeriod(period)}
              </div>
              <p className="text-4xl font-extrabold leading-none">
                {team.won}<span className="text-blue-200 text-2xl"> / {team.goal ?? '—'}</span>
                <span className="text-base font-semibold text-blue-100 ml-2">vendas</span>
              </p>
            </div>
            <div className="text-right">
              {team.goal != null
                ? <p className="text-3xl font-extrabold">{Math.min(100, Math.round((team.won / team.goal) * 100))}%</p>
                : <p className="text-sm text-blue-100">Defina uma meta</p>}
              <p className="text-xs text-blue-200">{team.won >= (team.goal ?? Infinity) ? '🎉 Meta atingida!' : 'do objetivo'}</p>
            </div>
          </div>
          {team.goal != null && (
            <div className="relative mt-4 h-2.5 rounded-full bg-white/20 overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all" style={{ width: `${Math.min(100, (team.won / team.goal) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* KPIs da equipe */}
      {team && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi Icon={Award} label="Vendas (leads ganhos)" value={String(team.won)} sub={`${team.assigned} leads atendidos`} accent="bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" />
          <Kpi Icon={TrendingUp} label="Conversão" value={`${team.conversion}%`} sub="ganhos ÷ atendidos" accent="bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400" />
          <Kpi Icon={DollarSign} label="Valor vendido" value={brl(team.valueSold)} sub="em leads ganhos" accent="bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" />
          <Kpi Icon={Users} label="Membros" value={String(team.memberCount)} sub="na equipe" accent="bg-purple-100 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400" />
        </div>
      )}

      {/* Lista de membros com desempenho */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Desempenho por membro</h2>
          <span className="text-xs text-slate-400">Clique para ver detalhes</span>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {ranking.map((m, i) => (
            <button key={m.id} onClick={() => setSelected(m)}
              className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition text-left">
              <div className="w-6 text-center shrink-0">
                {i < 3 && m.won > 0
                  ? <span className={cn('text-sm font-extrabold', i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : 'text-amber-700')}>{i + 1}º</span>
                  : <span className="text-xs text-slate-300">{i + 1}</span>}
              </div>
              <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0 overflow-hidden">
                {m.avatarUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={m.avatarUrl} alt="" className="w-full h-full object-cover" />
                  : <span className="text-blue-600 dark:text-blue-400 text-sm font-bold">{m.fullName?.charAt(0).toUpperCase()}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{m.fullName}</p>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', ROLE_COLORS[m.role] ?? 'bg-slate-100 text-slate-600')}>{ROLE_LABELS[m.role] ?? m.role}</span>
                  {m.status === 'suspended' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300 font-medium">Suspenso</span>}
                </div>
                <div className="hidden sm:block mt-1.5 max-w-xs"><Progress value={m.won} goal={m.goal} color="emerald" /></div>
              </div>
              <div className="hidden md:flex items-center gap-5 text-center shrink-0">
                <div><p className="text-sm font-bold">{m.assigned}</p><p className="text-[10px] text-slate-400">leads</p></div>
                <div><p className="text-sm font-bold">{m.conversion}%</p><p className="text-[10px] text-slate-400">conv.</p></div>
                <div><p className="text-sm font-bold">{brl(m.valueSold)}</p><p className="text-[10px] text-slate-400">vendido</p></div>
              </div>
              <ChevronRight size={16} className="text-slate-300 shrink-0" />
            </button>
          ))}
          {members.length === 0 && <div className="py-10 text-center text-slate-500 text-sm">Nenhum membro ainda</div>}
        </div>
      </div>

      {/* Convites pendentes */}
      {invitations.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-sm font-semibold">Convites pendentes ({invitations.length})</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {invitations.map((inv) => {
              const expired = new Date(inv.expiresAt) < new Date();
              return (
                <div key={inv.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0"><Mail size={14} className="text-slate-400" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{inv.email}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Clock size={10} />{expired ? 'Expirado' : `Expira ${new Date(inv.expiresAt).toLocaleDateString('pt-BR')}`}
                    </p>
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', ROLE_COLORS[inv.role] ?? 'bg-slate-100 text-slate-600')}>{ROLE_LABELS[inv.role] ?? inv.role}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => resendInvite(inv.id)} disabled={busyId === inv.id} title="Reenviar e-mail"
                      className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-500">
                      {busyId === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </button>
                    {inv.acceptUrl && (
                      <button onClick={() => copyLink(inv)} title="Copiar link" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-500">
                        {copiedId === inv.id ? <CheckCheck size={14} className="text-emerald-500" /> : <Copy size={14} />}
                      </button>
                    )}
                    <button onClick={() => revokeInvite(inv.id)} title="Revogar" className="p-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/20 hover:text-rose-500 transition text-slate-500">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modais / Drawer */}
      {showInvite && token && <InviteModal token={token} onClose={() => setShowInvite(false)} onSuccess={(inv) => { setInvitations((p) => [inv, ...p]); setShowInvite(false); }} />}
      {showGoals && token && data && <GoalsModal token={token} period={period} members={members} teamGoal={team?.goal ?? null} onClose={() => setShowGoals(false)} onSaved={() => { setShowGoals(false); load(); }} />}
      {selected && (
        <MemberDrawer member={selected} period={period} isAdmin={isAdmin} busy={busyId === selected.id}
          onClose={() => setSelected(null)}
          onChangeRole={(r) => changeRole(selected.id, r)}
          onSetStatus={(s) => setStatus(selected.id, s)} />
      )}
    </div>
  );
}

/* ── Drawer do membro ───────────────────────────────────── */
function MemberDrawer({ member, period, isAdmin, busy, onClose, onChangeRole, onSetStatus }: {
  member: MemberStat; period: string; isAdmin: boolean; busy: boolean;
  onClose: () => void; onChangeRole: (r: string) => void; onSetStatus: (s: 'active' | 'suspended') => void;
}) {
  const stats = [
    { Icon: Award, label: 'Vendas (ganhos)', value: String(member.won), accent: 'text-emerald-600' },
    { Icon: Users, label: 'Leads atendidos', value: String(member.assigned), accent: 'text-blue-600' },
    { Icon: TrendingUp, label: 'Conversão', value: `${member.conversion}%`, accent: 'text-purple-600' },
    { Icon: CalendarCheck, label: 'Agendamentos', value: String(member.appointments), accent: 'text-amber-600' },
  ];
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[2000] bg-black/40 backdrop-blur-sm" />
      <aside className="fixed top-0 right-0 z-[2001] h-full w-full max-w-md bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 h-14 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <h2 className="text-sm font-bold">Detalhes do membro</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Cabeçalho */}
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center overflow-hidden">
              {member.avatarUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={member.avatarUrl} alt="" className="w-full h-full object-cover" />
                : <span className="text-blue-600 dark:text-blue-400 text-xl font-extrabold">{member.fullName?.charAt(0).toUpperCase()}</span>}
            </div>
            <div className="min-w-0">
              <p className="font-bold truncate">{member.fullName}</p>
              <p className="text-xs text-slate-500 truncate">{member.email}</p>
              <span className={cn('inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium', ROLE_COLORS[member.role] ?? 'bg-slate-100 text-slate-600')}>{ROLE_LABELS[member.role] ?? member.role}</span>
            </div>
          </div>

          {/* Meta do membro */}
          <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-2"><Target size={13} /> Meta de {fmtPeriod(period)}</div>
            <Progress value={member.won} goal={member.goal} color="emerald" />
          </div>

          {/* Indicadores */}
          <div className="grid grid-cols-2 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800">
                <s.Icon size={16} className={cn(s.accent, 'mb-2')} />
                <p className="text-xl font-extrabold leading-none">{s.value}</p>
                <p className="text-[11px] text-slate-400 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800">
            <p className="text-xs text-slate-400">Valor vendido no período</p>
            <p className="text-2xl font-extrabold text-amber-600 mt-1">{brl(member.valueSold)}</p>
          </div>

          {/* Gestão (admin) */}
          {isAdmin && (
            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Gestão</p>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Função</label>
                <select value={member.role} disabled={busy} onChange={(e) => onChangeRole(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="salesperson">Vendedor</option>
                  <option value="manager">Gerente</option>
                  <option value="tenant_admin">Administrador</option>
                </select>
              </div>
              {member.status === 'suspended' ? (
                <button onClick={() => onSetStatus('active')} disabled={busy}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />} Reativar membro
                </button>
              ) : (
                <button onClick={() => onSetStatus('suspended')} disabled={busy}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg border border-rose-200 dark:border-rose-900/40 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition disabled:opacity-50">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <UserX size={15} />} Remover da equipe
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/* ── Modal de convite ───────────────────────────────────── */
function InviteModal({ onClose, onSuccess, token }: { onClose: () => void; onSuccess: (inv: Invitation) => void; token: string }) {
  const [email, setEmail] = useState(''); const [role, setRole] = useState('salesperson');
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const input = 'w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500';

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('');
    try { const inv = await api<Invitation>('/invitations', { token, method: 'POST', body: { email, role } }); onSuccess(inv); }
    catch (err) { setError((err as { message?: string }).message ?? 'Erro ao criar convite'); }
    finally { setLoading(false); }
  }
  return (
    <Modal title="Convidar membro" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block mb-1">E-mail</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vendedor@empresa.com" className={input} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block mb-1">Função</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={input}>
            <option value="salesperson">Vendedor</option>
            <option value="manager">Gerente</option>
            <option value="tenant_admin">Administrador</option>
          </select>
        </div>
        <p className="text-xs text-slate-400 flex items-center gap-1.5"><Mail size={12} /> Um e-mail de convite será enviado automaticamente.</p>
        {error && <p className="text-xs text-rose-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition">Cancelar</button>
          <button type="submit" disabled={loading} className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
            {loading && <Loader2 size={14} className="animate-spin" />} Convidar
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Modal de metas ─────────────────────────────────────── */
function GoalsModal({ token, period, members, teamGoal, onClose, onSaved }: {
  token: string; period: string; members: MemberStat[]; teamGoal: number | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [team, setTeam] = useState(teamGoal != null ? String(teamGoal) : '');
  const [goals, setGoals] = useState<Record<string, string>>(
    Object.fromEntries(members.map((m) => [m.id, m.goal != null ? String(m.goal) : ''])),
  );
  const [saving, setSaving] = useState(false);
  const input = 'w-20 px-2 py-1.5 text-sm text-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500';

  async function save() {
    setSaving(true);
    try {
      const reqs: Promise<unknown>[] = [];
      if (team !== '') reqs.push(api('/team/goals', { token, method: 'POST', body: { userId: null, period, target: Number(team) } }));
      for (const m of members) {
        const v = goals[m.id];
        if (v !== '' && v != null) reqs.push(api('/team/goals', { token, method: 'POST', body: { userId: m.id, period, target: Number(v) } }));
      }
      await Promise.all(reqs);
      onSaved();
    } catch { setSaving(false); }
  }

  return (
    <Modal title={`Metas de ${fmtPeriod(period)}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2"><Trophy size={16} className="text-blue-600" /><span className="text-sm font-semibold">Meta da equipe</span></div>
          <input type="number" min={0} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="0" className={input} />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Meta por vendedor</p>
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0 text-xs font-bold text-blue-600 dark:text-blue-400">{m.fullName?.charAt(0).toUpperCase()}</div>
                <span className="text-sm truncate">{m.fullName}</span>
              </div>
              <input type="number" min={0} value={goals[m.id] ?? ''} onChange={(e) => setGoals((g) => ({ ...g, [m.id]: e.target.value }))} placeholder="0" className={input} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2 mt-5">
        <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition">Cancelar</button>
        <button onClick={save} disabled={saving} className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
          {saving && <Loader2 size={14} className="animate-spin" />} Salvar metas
        </button>
      </div>
    </Modal>
  );
}

/* ── Modal base ─────────────────────────────────────────── */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition"><X size={16} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
