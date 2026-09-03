'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CalendarDays, Clock, Car, Check, X, Loader2, RefreshCw,
  ChevronLeft, ChevronRight, List, CalendarRange, Search, Phone, Mail,
  CalendarClock, UserCheck, CheckCircle2, XCircle, AlertCircle, CalendarPlus,
} from 'lucide-react';
import { api} from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';

/* ── Tipos ─────────────────────────────────────────────── */
interface Appointment {
  id: string; type: string; status: string;
  scheduledStart: string; scheduledEnd: string; notes: string | null;
  customer: { id: string; fullName: string; email: string; phone: string | null };
  salesperson: { id: string; fullName: string; email: string } | null;
  vehicle: { id: string; versionName: string | null; yearModel: number; brand: { name: string }; model: { name: string }; images: { url: string }[] } | null;
}
interface Member { id: string; fullName: string; role: string }

/* ── Constantes ────────────────────────────────────────── */
const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado', confirmed: 'Confirmado', in_progress: 'Em andamento',
  completed: 'Concluído', canceled: 'Cancelado', no_show: 'Não compareceu',
};
const STATUS_DOT: Record<string, string> = {
  scheduled: 'bg-blue-500', confirmed: 'bg-emerald-500', in_progress: 'bg-amber-500',
  completed: 'bg-slate-400', canceled: 'bg-rose-500', no_show: 'bg-orange-500',
};
const STATUS_BADGE: Record<string, string> = {
  scheduled:   'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  confirmed:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  completed:   'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  canceled:    'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  no_show:     'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
};
const TYPE_LABELS: Record<string, string> = {
  test_drive: 'Test Drive', evaluation: 'Avaliação', in_person: 'Visita',
  online: 'Online', delivery: 'Entrega', service: 'Serviço',
};
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/* ── Helpers de data ───────────────────────────────────── */
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
function startOfWeek(d: Date) { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; }
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function dayLabel(d: Date) {
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' });
}

/* ═══════════════════════════════════════════════════════════ */
export default function AgendamentosPage() {
  const { token } = useAuthStore();
  const [appts, setAppts]   = useState<Appointment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<unknown>(null);

  const [view, setView]       = useState<'list' | 'calendar'>('list');
  const [status, setStatus]   = useState('');
  const [period, setPeriod]   = useState<'today' | 'week' | 'month' | 'all'>('week');
  const [sellerId, setSellerId] = useState('');
  const [type, setType]       = useState('');
  const [q, setQ]             = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<Appointment | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErro(null);
    try {
      const [r, m] = await Promise.all([
        api<{ items: Appointment[] }>('/appointments?limit=500', { token }),
        api<Member[]>('/users', { token }).catch(() => []),
      ]);
      setAppts(r.items ?? []);
      setMembers((m ?? []).filter((x) => x.role !== 'customer'));
    } catch (err) {
      // Guarda o erro cru: quem decide a ação (tentar de novo, entrar
      // novamente ou falar com o administrador) é o ErroAoCarregar.
      setErro(err);
    }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function patchLocal(updated: Appointment) {
    setAppts((prev) => prev.map((a) => a.id === updated.id ? { ...a, ...updated } : a));
    setSelected((s) => s && s.id === updated.id ? { ...s, ...updated } : s);
  }

  /* filtros client-side (status/vendedor/tipo/busca) */
  const filtered = useMemo(() => appts.filter((a) =>
    (!status || a.status === status) &&
    (!sellerId || a.salesperson?.id === sellerId) &&
    (!type || a.type === type) &&
    (!q || a.customer?.fullName?.toLowerCase().includes(q.toLowerCase())),
  ), [appts, status, sellerId, type, q]);

  /* KPIs */
  const kpis = useMemo(() => {
    const today = startOfDay(new Date());
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
    const todayCount = filtered.filter((a) => sameDay(new Date(a.scheduledStart), today)).length;
    const weekCount = filtered.filter((a) => { const d = new Date(a.scheduledStart); return d >= today && d < weekEnd; }).length;
    const pending = filtered.filter((a) => a.status === 'scheduled').length;
    const done = filtered.filter((a) => a.status === 'completed').length;
    const missed = filtered.filter((a) => a.status === 'no_show').length;
    const attendance = done + missed > 0 ? Math.round((done / (done + missed)) * 100) : null;
    return { todayCount, weekCount, pending, attendance };
  }, [filtered]);

  /* lista agrupada por dia (com período) */
  const grouped = useMemo(() => {
    const today = startOfDay(new Date());
    const inPeriod = (d: Date) => {
      if (period === 'all') return true;
      if (period === 'today') return sameDay(d, today);
      const end = new Date(today);
      end.setDate(end.getDate() + (period === 'week' ? 7 : 31));
      return d >= today && d < end;
    };
    const items = filtered
      .filter((a) => inPeriod(new Date(a.scheduledStart)))
      .sort((a, b) => +new Date(a.scheduledStart) - +new Date(b.scheduledStart));
    const map = new Map<string, Appointment[]>();
    for (const a of items) {
      const key = startOfDay(new Date(a.scheduledStart)).toISOString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return [...map.entries()].map(([k, v]) => ({ date: new Date(k), items: v }));
  }, [filtered, period]);

  /* calendário semanal */
  const week = useMemo(() => {
    const base = startOfWeek(new Date());
    base.setDate(base.getDate() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base); d.setDate(d.getDate() + i);
      const items = filtered
        .filter((a) => sameDay(new Date(a.scheduledStart), d))
        .sort((a, b) => +new Date(a.scheduledStart) - +new Date(b.scheduledStart));
      return { date: d, items };
    });
  }, [filtered, weekOffset]);

  const weekRangeLabel = useMemo(() => {
    const f = week[0]?.date, l = week[6]?.date;
    if (!f || !l) return '';
    return `${f.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${l.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`;
  }, [week]);

  const hasFilters = status || sellerId || type || q;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Agendamentos</h1>
          <p className="text-sm text-slate-500 mt-0.5">Test drives, visitas e entregas</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            {([['list', List, 'Lista'], ['calendar', CalendarRange, 'Calendário']] as const).map(([v, Icon, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition',
                  view === v ? 'bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700')}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          <button onClick={load} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi Icon={CalendarClock} label="Hoje" value={String(kpis.todayCount)} accent="bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400" />
        <Kpi Icon={CalendarDays} label="Próximos 7 dias" value={String(kpis.weekCount)} accent="bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400" />
        <Kpi Icon={AlertCircle} label="A confirmar" value={String(kpis.pending)} accent="bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" />
        <Kpi Icon={UserCheck} label="Comparecimento" value={kpis.attendance != null ? `${kpis.attendance}%` : '—'} accent="bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente…"
            className="pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500 w-44" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos status</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={sellerId} onChange={(e) => setSellerId(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos vendedores</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos tipos</option>
          {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {view === 'list' && (
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 ml-auto">
            {([['today', 'Hoje'], ['week', 'Semana'], ['month', 'Mês'], ['all', 'Tudo']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setPeriod(v)}
                className={cn('px-2.5 py-1.5 rounded-md text-xs font-semibold transition', period === v ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-500')}>{l}</button>
            ))}
          </div>
        )}
        {hasFilters && (
          <button onClick={() => { setStatus(''); setSellerId(''); setType(''); setQ(''); }} className="text-xs text-slate-500 hover:text-rose-500 flex items-center gap-1">
            <X size={12} /> Limpar
          </button>
        )}
      </div>

      {loading && appts.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-500"><Loader2 size={20} className="animate-spin mr-2" /> Carregando…</div>
      ) : erro ? (
        <ErroAoCarregar erro={erro} onTentarNovamente={load} carregando={loading} contexto="os agendamentos" />
      ) : view === 'list' ? (
        /* ── LISTA AGRUPADA ── */
        grouped.length === 0 ? <Empty /> : (
          <div className="space-y-6">
            {grouped.map(({ date, items }) => (
              <div key={date.toISOString()}>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-sm font-bold capitalize">{dayLabel(date)}</h3>
                  <span className="text-xs text-slate-400">{items.length} agendamento{items.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="space-y-2">
                  {items.map((a) => <Row key={a.id} appt={a} onClick={() => setSelected(a)} />)}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* ── CALENDÁRIO SEMANAL ── */
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1">
              <button onClick={() => setWeekOffset((w) => w - 1)} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronLeft size={15} /></button>
              <button onClick={() => setWeekOffset(0)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800">Hoje</button>
              <button onClick={() => setWeekOffset((w) => w + 1)} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronRight size={15} /></button>
            </div>
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">{weekRangeLabel}</span>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {week.map(({ date, items }) => {
              const isToday = sameDay(date, new Date());
              return (
                <div key={date.toISOString()} className={cn('rounded-xl border min-h-[140px] p-2', isToday ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-950/20' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900')}>
                  <div className="text-center mb-2">
                    <p className="text-[10px] text-slate-400 uppercase">{WEEKDAYS[date.getDay()]}</p>
                    <p className={cn('text-sm font-bold', isToday && 'text-blue-600')}>{date.getDate()}</p>
                  </div>
                  <div className="space-y-1">
                    {items.map((a) => (
                      <button key={a.id} onClick={() => setSelected(a)}
                        className="w-full text-left rounded-lg px-1.5 py-1 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                        <div className="flex items-center gap-1">
                          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[a.status])} />
                          <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200">{fmtTime(a.scheduledStart)}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 truncate">{a.customer?.fullName?.split(' ')[0]} · {a.vehicle?.model.name ?? TYPE_LABELS[a.type]}</p>
                      </button>
                    ))}
                    {items.length === 0 && <p className="text-[10px] text-slate-300 dark:text-slate-700 text-center pt-3">—</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <DetailDrawer appt={selected} members={members} token={token!}
          onClose={() => setSelected(null)} onUpdate={patchLocal} />
      )}
    </div>
  );
}

/* ── KPI ────────────────────────────────────────────────── */
function Kpi({ Icon, label, value, accent }: { Icon: React.ElementType; label: string; value: string; accent: string }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center', accent)}><Icon size={15} /></span>
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <p className="text-2xl font-extrabold leading-none">{value}</p>
    </div>
  );
}

/* ── Linha (lista) ──────────────────────────────────────── */
function Row({ appt, onClick }: { appt: Appointment; onClick: () => void }) {
  const v = appt.vehicle;
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 hover:border-blue-300 dark:hover:border-blue-700 transition text-left">
      <div className="flex flex-col items-center justify-center w-14 shrink-0">
        <span className="text-sm font-extrabold">{fmtTime(appt.scheduledStart)}</span>
        <span className={cn('mt-1 w-2 h-2 rounded-full', STATUS_DOT[appt.status])} />
      </div>
      <div className="w-12 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
        {v?.images?.[0]
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={v.images[0].url} alt="" className="w-full h-full object-cover" />
          : <Car size={15} className="text-slate-300" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{appt.customer?.fullName}</p>
        <p className="text-xs text-slate-500 truncate">{v ? `${v.brand.name} ${v.model.name}` : TYPE_LABELS[appt.type]}{appt.salesperson && ` · ${appt.salesperson.fullName.split(' ')[0]}`}</p>
      </div>
      <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0', STATUS_BADGE[appt.status])}>{STATUS_LABELS[appt.status]}</span>
      <span className="text-[10px] text-slate-400 shrink-0 hidden sm:block">{TYPE_LABELS[appt.type]}</span>
    </button>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center py-16 text-center text-slate-400">
      <CalendarDays size={36} className="mb-3 opacity-40" />
      <p className="text-sm font-semibold">Nenhum agendamento no período</p>
      <p className="text-xs mt-1">Ajuste os filtros ou aguarde novos pedidos dos clientes.</p>
    </div>
  );
}

/* ── Drawer de detalhes ─────────────────────────────────── */
function DetailDrawer({ appt, members, token, onClose, onUpdate }: {
  appt: Appointment; members: Member[]; token: string;
  onClose: () => void; onUpdate: (a: Appointment) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reschedule, setReschedule] = useState(false);
  const [newDt, setNewDt] = useState('');
  const v = appt.vehicle;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try { const u = await api<Appointment>(`/appointments/${appt.id}`, { token, method: 'PATCH', body }); onUpdate(u); }
    catch (e) { alert(e instanceof Error ? e.message : 'Erro'); }
    finally { setBusy(false); }
  }
  async function doReschedule() {
    if (!newDt) return;
    await patch({ scheduledStart: new Date(newDt).toISOString() });
    setReschedule(false);
  }

  const actions: { label: string; status: string; Icon: React.ElementType; cls: string }[] = [
    { label: 'Confirmar', status: 'confirmed', Icon: CheckCircle2, cls: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
    { label: 'Concluir', status: 'completed', Icon: Check, cls: 'bg-blue-600 hover:bg-blue-700 text-white' },
    { label: 'Não compareceu', status: 'no_show', Icon: AlertCircle, cls: 'border border-orange-300 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/20' },
    { label: 'Cancelar', status: 'canceled', Icon: XCircle, cls: 'border border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20' },
  ];

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[2000] bg-black/40 backdrop-blur-sm" />
      <aside className="fixed top-0 right-0 z-[2001] h-full w-full max-w-md bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 h-14 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <span className={cn('w-2.5 h-2.5 rounded-full', STATUS_DOT[appt.status])} />
            <h2 className="text-sm font-bold">{STATUS_LABELS[appt.status]}</h2>
            <span className="text-xs text-slate-400">· {TYPE_LABELS[appt.type]}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Data/hora */}
          <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl p-4">
            <CalendarDays size={22} className="text-blue-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold capitalize">{new Date(appt.scheduledStart).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
              <p className="text-xs text-slate-500 flex items-center gap-1"><Clock size={11} /> {fmtTime(appt.scheduledStart)} – {fmtTime(appt.scheduledEnd)}</p>
            </div>
            <button onClick={() => setReschedule((r) => !r)} className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
              <CalendarPlus size={13} /> Reagendar
            </button>
          </div>
          {reschedule && (
            <div className="flex items-center gap-2 -mt-2">
              <input type="datetime-local" value={newDt} onChange={(e) => setNewDt(e.target.value)} style={{ colorScheme: 'light' }}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={doReschedule} disabled={busy || !newDt} className="px-3 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : 'Salvar'}
              </button>
            </div>
          )}

          {/* Veículo */}
          {v && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
              <div className="w-16 h-12 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                {v.images?.[0]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={v.images[0].url} alt="" className="w-full h-full object-cover" />
                  : <Car size={18} className="text-slate-300" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{v.brand.name} {v.model.name}</p>
                <p className="text-xs text-slate-500">{v.versionName ?? ''} {v.yearModel}</p>
              </div>
            </div>
          )}

          {/* Cliente */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Cliente</p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold">{appt.customer?.fullName?.charAt(0).toUpperCase()}</div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{appt.customer?.fullName}</p>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {appt.customer?.email && <a href={`mailto:${appt.customer.email}`} className="flex items-center gap-1 hover:text-blue-500 truncate"><Mail size={11} /> {appt.customer.email}</a>}
                  {appt.customer?.phone && <a href={`tel:${appt.customer.phone}`} className="flex items-center gap-1 hover:text-blue-500"><Phone size={11} /> {appt.customer.phone}</a>}
                </div>
              </div>
            </div>
          </div>

          {/* Vendedor */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Vendedor responsável</p>
            <select value={appt.salesperson?.id ?? ''} disabled={busy} onChange={(e) => patch({ salespersonId: e.target.value || null })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Não atribuído</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
            </select>
          </div>

          {/* Notas */}
          {appt.notes && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Observações</p>
              <p className="text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 rounded-lg p-3 italic">&ldquo;{appt.notes}&rdquo;</p>
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="border-t border-slate-200 dark:border-slate-800 p-4 grid grid-cols-2 gap-2 shrink-0">
          {actions.map((a) => (
            <button key={a.status} onClick={() => patch({ status: a.status })} disabled={busy || appt.status === a.status}
              className={cn('flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold rounded-lg transition disabled:opacity-40', a.cls)}>
              <a.Icon size={15} /> {a.label}
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}
