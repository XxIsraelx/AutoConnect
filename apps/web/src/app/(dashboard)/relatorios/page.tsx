'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, Users, Car, Target, RefreshCw, Calendar,
  ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import GraficosDeVenda from './GraficosDeVenda';

/* ── Tipos ─────────────────────────────────────────────── */
interface ReportsData {
  period:      { days: number; from: string };
  leadsPerDay: { day: string; count: number }[];
  byStatus:    { status: string; count: number }[];
  bySource:    { source: string; count: number }[];
  topVehicles: { vehicleId: string; views: number; vehicle?: { versionName: string | null; yearModel: number; brand: { name: string }; model: { name: string }; images: { url: string }[] } }[];
  conversion:  { total: number; won: number; lost: number; rate: number };
  appointments?: {
    total: number;
    byStatus: { status: string; count: number }[];
    completed: number;
    noShow: number;
    showRate: number | null;
  };
  funnel?: { stage: string; count: number }[];
}

/* ── Helpers ────────────────────────────────────────────── */
const STATUS_LABELS: Record<string, string> = {
  new: 'Novo', contacted: 'Contactado', qualified: 'Qualificado',
  negotiating: 'Negociando', won: 'Ganho', lost: 'Perdido', archived: 'Arquivado',
};
const STATUS_COLORS: Record<string, string> = {
  new: '#3b82f6', contacted: '#8b5cf6', qualified: '#f59e0b',
  negotiating: '#06b6d4', won: '#22c55e', lost: '#ef4444', archived: '#94a3b8',
};
const SOURCE_LABELS: Record<string, string> = {
  website: 'Site', whatsapp: 'WhatsApp', phone: 'Telefone',
  email: 'E-mail', in_person: 'Presencial', referral: 'Indicação', other: 'Outro',
};
const PIE_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#06b6d4','#22c55e','#ef4444','#f97316'];

function KpiCard({ label, value, sub, trend }: { label: string; value: string | number; sub?: string; trend?: number }) {
  const TrendIcon = trend === undefined ? Minus : trend > 0 ? ArrowUpRight : trend < 0 ? ArrowDownRight : Minus;
  const trendColor = trend === undefined || trend === 0 ? 'text-slate-400' : trend > 0 ? 'text-emerald-500' : 'text-rose-500';
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
      <p className="text-xs text-slate-500 font-medium mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      {trend !== undefined && (
        <div className={cn('flex items-center gap-1 text-xs mt-2', trendColor)}>
          <TrendIcon size={12} />
          {Math.abs(trend)}%
        </div>
      )}
    </div>
  );
}

/* ── Componente principal ───────────────────────────────── */
export default function RelatoriosPage() {
  const { token } = useAuthStore();
  const [data,    setData]    = useState<ReportsData | null>(null);
  const [days,    setDays]    = useState(30);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErro(null);
    try {
      const r = await api<ReportsData>(`/tenant/reports?days=${days}`, { token });
      setData(r);
    } catch (err) {
      // Guarda o erro cru: quem decide a ação (tentar de novo, entrar
      // novamente ou falar com o administrador) é o ErroAoCarregar.
      setErro(err);
    }
    finally { setLoading(false); }
  }, [token, days]);

  useEffect(() => { load(); }, [load]);

  const totalLeads = data?.conversion.total ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Relatórios</h1>
          <p className="text-sm text-slate-500 mt-0.5">Análise de desempenho da sua concessionária</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                  days === d
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                {d === 7 ? '7 dias' : d === 30 ? '30 dias' : '90 dias'}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center h-64 text-slate-500">
          <RefreshCw size={20} className="animate-spin mr-2" />
          Carregando relatórios…
        </div>
      ) : erro ? (
        <ErroAoCarregar erro={erro} onTentarNovamente={load} carregando={loading} contexto="os relatórios" />
      ) : data ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Total de Leads" value={totalLeads} sub={`Últimos ${days} dias`} />
            <KpiCard label="Taxa de Conversão" value={`${data.conversion.rate}%`} sub={`${data.conversion.won} ganhos`} />
            <KpiCard label="Agendamentos" value={data.appointments?.total ?? 0} sub={`${data.appointments?.completed ?? 0} concluídos`} />
            <KpiCard
              label="Comparecimento"
              value={data.appointments?.showRate !== null && data.appointments?.showRate !== undefined ? `${data.appointments.showRate}%` : '—'}
              sub={data.appointments?.noShow ? `${data.appointments.noShow} faltas` : 'Sem dados ainda'}
            />
          </div>

          {/* Funil de conversão */}
          {data.funnel && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
              <div className="flex items-center gap-2 mb-5">
                <Target size={15} className="text-blue-500" />
                <h2 className="text-sm font-semibold">Funil de Conversão</h2>
              </div>
              <div className="space-y-2.5">
                {data.funnel.map((f, i) => {
                  const max = data.funnel![0]?.count || 1;
                  const pct = Math.round((f.count / max) * 100);
                  const colors = ['bg-blue-500', 'bg-violet-500', 'bg-amber-500', 'bg-emerald-500'];
                  const prev = i > 0 ? data.funnel![i - 1].count : null;
                  const stepRate = prev && prev > 0 ? Math.round((f.count / prev) * 100) : null;
                  return (
                    <div key={f.stage} className="flex items-center gap-3">
                      <span className="w-28 text-xs text-slate-500 text-right shrink-0">{f.stage}</span>
                      <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-lg h-7 overflow-hidden">
                        <div
                          className={cn('h-full rounded-lg flex items-center px-2.5 transition-all duration-700 min-w-[2rem]', colors[i % colors.length])}
                          style={{ width: `${Math.max(pct, 4)}%` }}
                        >
                          <span className="text-[11px] font-bold text-white">{f.count}</span>
                        </div>
                      </div>
                      <span className="w-12 text-[11px] text-slate-400 shrink-0">
                        {stepRate !== null ? `${stepRate}%` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <GraficosDeVenda />

          {/* Leads por dia */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Calendar size={15} className="text-blue-500" />
              <h2 className="text-sm font-semibold">Leads por Dia</h2>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data.leadsPerDay} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-100 dark:text-slate-800" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(v) => `Dia ${v}`} />
                <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2}
                  fill="url(#leadsGrad)" name="Leads" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Status + Fonte */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Por Status */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Target size={15} className="text-purple-500" />
                <h2 className="text-sm font-semibold">Leads por Status</h2>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.byStatus.map((s) => ({ ...s, label: STATUS_LABELS[s.status] ?? s.status }))}
                  margin={{ top: 0, right: 5, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-100 dark:text-slate-800" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="count" name="Leads" radius={[4, 4, 0, 0]}>
                    {data.byStatus.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#3b82f6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Por Fonte */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={15} className="text-amber-500" />
                <h2 className="text-sm font-semibold">Origem dos Leads</h2>
              </div>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={180}>
                  <PieChart>
                    <Pie data={data.bySource.map((s) => ({ ...s, name: SOURCE_LABELS[s.source] ?? s.source }))}
                      dataKey="count" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3}>
                      {data.bySource.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {data.bySource.map((s, i) => (
                    <div key={s.source} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-slate-600 dark:text-slate-400">{SOURCE_LABELS[s.source] ?? s.source}</span>
                      </div>
                      <span className="font-medium">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Top Veículos */}
          {data.topVehicles.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Car size={15} className="text-emerald-500" />
                <h2 className="text-sm font-semibold">Veículos Mais Vistos</h2>
              </div>
              <div className="space-y-3">
                {data.topVehicles.map((item, idx) => {
                  const v = item.vehicle;
                  const label = v ? `${v.brand.name} ${v.model.name} ${v.versionName ?? ''} ${v.yearModel}` : item.vehicleId.slice(0, 8);
                  const maxViews = data.topVehicles[0]?.views ?? 1;
                  return (
                    <div key={item.vehicleId} className="flex items-center gap-3">
                      <span className="w-5 text-xs text-slate-400 text-right">{idx + 1}</span>
                      {v?.images[0] && (
                        <img src={v.images[0].url} alt={label} className="w-10 h-8 object-cover rounded" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{label}</p>
                        <div className="mt-1 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${(item.views / maxViews) * 100}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-xs font-medium text-slate-500 shrink-0">{item.views} vis.</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
