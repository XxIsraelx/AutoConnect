'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CalendarDays, Clock, User, Car, Check, X,
  ChevronLeft, ChevronRight, RefreshCw, Loader2,
  AlertCircle, UserCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';

/* ── Tipos ─────────────────────────────────────────────── */
interface Appointment {
  id: string;
  type: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  notes: string | null;
  customer: { id: string; fullName: string; email: string; phone: string | null };
  salesperson: { id: string; fullName: string; email: string } | null;
  vehicle: { id: string; versionName: string | null; yearModel: number; brand: { name: string }; model: { name: string }; images: { url: string }[] } | null;
  lead: { id: string; status: string } | null;
}

interface AppointmentsResponse {
  items: Appointment[];
  total: number;
  page: number;
  perPage: number;
}

/* ── Helpers ────────────────────────────────────────────── */
const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado', confirmed: 'Confirmado', in_progress: 'Em andamento',
  completed: 'Concluído', canceled: 'Cancelado', no_show: 'Não compareceu',
};
const STATUS_COLORS: Record<string, string> = {
  scheduled:   'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  confirmed:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  completed:   'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  canceled:    'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  no_show:     'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
};
const TYPE_LABELS: Record<string, string> = {
  test_drive: 'Test Drive', visit: 'Visita', video_call: 'Videochamada', other: 'Outro',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/* ── Card de Agendamento ────────────────────────────────── */
function AppointmentCard({ appt, onUpdate }: { appt: Appointment; onUpdate: (updated: Appointment) => void }) {
  const { token } = useAuthStore();
  const [loading, setLoading] = useState(false);

  async function changeStatus(status: string) {
    if (!token || loading) return;
    setLoading(true);
    try {
      const updated = await api<Appointment>(`/appointments/${appt.id}`, {
        token, method: 'PATCH', body: { status },
      });
      onUpdate(updated);
    } catch { /* ignora */ }
    finally { setLoading(false); }
  }

  const v = appt.vehicle;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[appt.status] ?? 'bg-slate-100 text-slate-600')}>
              {STATUS_LABELS[appt.status] ?? appt.status}
            </span>
            <span className="text-xs text-slate-500">{TYPE_LABELS[appt.type] ?? appt.type}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1 font-medium">
              <CalendarDays size={13} className="text-blue-500" />
              {fmtDate(appt.scheduledStart)}
            </span>
            <span className="flex items-center gap-1 text-slate-500">
              <Clock size={13} />
              {fmtTime(appt.scheduledStart)}
            </span>
          </div>
        </div>
        {/* Ações rápidas para agendamentos pendentes */}
        {(appt.status === 'scheduled' || appt.status === 'confirmed') && (
          <div className="flex items-center gap-1">
            {appt.status === 'scheduled' && (
              <button
                onClick={() => changeStatus('confirmed')}
                disabled={loading}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Confirmar
              </button>
            )}
            <button
              onClick={() => changeStatus('canceled')}
              disabled={loading}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/20 transition"
              title="Cancelar"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {appt.status === 'confirmed' && (
          <button
            onClick={() => changeStatus('completed')}
            disabled={loading}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition"
          >
            <UserCheck size={12} />
            Concluir
          </button>
        )}
      </div>

      {/* Veículo */}
      {v && (
        <div className="flex items-center gap-2.5 p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
          {v.images[0] && (
            <img src={v.images[0].url} alt="" className="w-12 h-9 object-cover rounded" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">
              {v.brand.name} {v.model.name} {v.versionName} {v.yearModel}
            </p>
          </div>
        </div>
      )}

      {/* Cliente + Vendedor */}
      <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
        <div className="flex items-center gap-1.5">
          <User size={12} />
          <span>{appt.customer.fullName}</span>
          {appt.customer.phone && (
            <a href={`tel:${appt.customer.phone}`} className="text-blue-500 hover:underline">
              {appt.customer.phone}
            </a>
          )}
        </div>
        {appt.salesperson && (
          <div className="flex items-center gap-1.5 text-slate-500">
            <UserCheck size={12} />
            <span>{appt.salesperson.fullName}</span>
          </div>
        )}
      </div>

      {appt.notes && (
        <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded p-2 leading-relaxed">{appt.notes}</p>
      )}
    </div>
  );
}

/* ── Página principal ───────────────────────────────────── */
export default function AgendamentosPage() {
  const { token } = useAuthStore();
  const [data,      setData]      = useState<AppointmentsResponse | null>(null);
  const [status,    setStatus]    = useState('');
  const [page,      setPage]      = useState(1);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set('status', status);
      const r = await api<AppointmentsResponse>(`/appointments?${params}`, { token });
      setData(r);
    } catch { /* ignora */ }
    finally { setLoading(false); }
  }, [token, page, status]);

  useEffect(() => { load(); }, [load]);

  function handleUpdate(updated: Appointment) {
    setData((prev) => prev ? {
      ...prev,
      items: prev.items.map((a) => a.id === updated.id ? updated : a),
    } : prev);
  }

  const totalPages = data ? Math.ceil(data.total / data.perPage) : 1;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Agendamentos</h1>
          <p className="text-sm text-slate-500 mt-0.5">Test drives e visitas agendadas</p>
        </div>
        <button onClick={load} disabled={loading}
          className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
        </button>
      </div>

      {/* Filtros de status */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { value: '', label: 'Todos' },
          { value: 'scheduled', label: 'Agendado' },
          { value: 'confirmed', label: 'Confirmado' },
          { value: 'completed', label: 'Concluído' },
          { value: 'canceled',  label: 'Cancelado'  },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => { setStatus(opt.value); setPage(1); }}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg transition',
              status === opt.value
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-blue-300',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading && !data ? (
        <div className="flex items-center justify-center h-48 text-slate-500">
          <Loader2 size={20} className="animate-spin mr-2" />
          Carregando…
        </div>
      ) : data && data.items.length > 0 ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.items.map((appt) => (
              <AppointmentCard key={appt.id} appt={appt} onUpdate={handleUpdate} />
            ))}
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-500">
                {data.total} agendamento{data.total !== 1 ? 's' : ''}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-slate-600">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-48 text-slate-500 gap-3">
          <AlertCircle size={32} className="text-slate-300" />
          <p className="text-sm">Nenhum agendamento encontrado</p>
        </div>
      )}
    </div>
  );
}
