'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Heart, CalendarDays, MessageSquare, User, ArrowLeft,
  Car, Clock, CheckCircle2, XCircle, Loader2, Bell, BellOff,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

/* ── Tipos ─────────────────────────────────────────────── */
interface FavoriteVehicle {
  createdAt: string;
  vehicle: {
    id: string; versionName: string | null; yearModel: number;
    price: string | null; promoPrice: string | null; condition: string; mileageKm: number;
    tenantId: string;
    brand: { name: string }; model: { name: string };
    images: { url: string }[];
  };
}

interface CustomerAppointment {
  id: string; type: string; status: string;
  scheduledStart: string; notes: string | null;
  vehicle: { id: string; versionName: string | null; yearModel: number; brand: { name: string }; model: { name: string }; images: { url: string }[] } | null;
  salesperson: { fullName: string } | null;
  branch: { name: string; city: string; state: string } | null;
}

interface PriceAlert {
  id: string; targetPrice: string; isActive: boolean; triggeredAt: string | null;
  vehicle: { id: string; versionName: string | null; yearModel: number; price: string | null; brand: { name: string }; model: { name: string }; images: { url: string }[] };
}

/* ── Helpers ────────────────────────────────────────────── */
function formatPrice(v: string | number | null | undefined) {
  if (!v) return '–';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(Number(v));
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado', confirmed: 'Confirmado', completed: 'Concluído', canceled: 'Cancelado',
};
const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700', confirmed: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-slate-100 text-slate-600', canceled: 'bg-rose-100 text-rose-700',
};

/* ── Tabs ──────────────────────────────────────────────── */
type Tab = 'favorites' | 'appointments' | 'alerts';

export default function PerfilPage() {
  const { token, user } = useAuthStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('favorites');

  const [favorites,     setFavorites]     = useState<FavoriteVehicle[]>([]);
  const [appointments,  setAppointments]  = useState<CustomerAppointment[]>([]);
  const [alerts,        setAlerts]        = useState<PriceAlert[]>([]);
  const [loading,       setLoading]       = useState(true);

  useEffect(() => {
    if (!token) { router.replace('/login'); }
  }, [token, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [favs, appts, als] = await Promise.all([
        api<FavoriteVehicle[]>('/catalog/favorites', { token }),
        api<CustomerAppointment[]>('/appointments', { token }),
        api<PriceAlert[]>('/catalog/price-alerts', { token }),
      ]);
      setFavorites(favs);
      setAppointments(appts);
      setAlerts(als);
    } catch { /* ignora */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function removeFavorite(vehicleId: string) {
    if (!token) return;
    await api(`/catalog/favorites/${vehicleId}`, { token, method: 'DELETE' });
    setFavorites((prev) => prev.filter((f) => f.vehicle.id !== vehicleId));
  }

  async function removeAlert(vehicleId: string) {
    if (!token) return;
    await api(`/catalog/price-alerts/${vehicleId}`, { token, method: 'DELETE' });
    setAlerts((prev) => prev.filter((a) => a.vehicle.id !== vehicleId));
  }

  async function cancelAppointment(id: string) {
    if (!token) return;
    await api(`/appointments/${id}/cancel`, { token, method: 'PATCH' });
    setAppointments((prev) => prev.map((a) => a.id === id ? { ...a, status: 'canceled' } : a));
  }

  if (!token) return null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Nav */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1">
            <h1 className="font-semibold text-sm">Meu Perfil</h1>
            <p className="text-xs text-slate-500">{user?.email}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Avatar */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-2xl font-bold text-blue-600 dark:text-blue-400">
            {user?.fullName?.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-bold">{user?.fullName}</p>
            <p className="text-sm text-slate-500">{user?.email}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1 mb-5">
          {([
            { value: 'favorites',    label: 'Favoritos',    Icon: Heart        },
            { value: 'appointments', label: 'Agendamentos', Icon: CalendarDays },
            { value: 'alerts',       label: 'Alertas',      Icon: Bell         },
          ] as { value: Tab; label: string; Icon: React.ElementType }[]).map(({ value, label, Icon }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg transition',
                tab === value
                  ? 'bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-white'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : (
          <>
            {/* FAVORITOS */}
            {tab === 'favorites' && (
              <div className="space-y-3">
                {favorites.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <Heart size={32} className="mx-auto mb-2" />
                    <p className="text-sm">Nenhum favorito ainda</p>
                    <Link href="/buscar" className="text-xs text-blue-500 hover:underline mt-1 block">Explorar veículos →</Link>
                  </div>
                ) : favorites.map((fav) => {
                  const v = fav.vehicle;
                  return (
                    <div key={v.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex items-center gap-3">
                      {v.images[0] && (
                        <img src={v.images[0].url} alt="" className="w-16 h-12 object-cover rounded-lg shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{v.brand.name} {v.model.name} {v.versionName ?? ''} {v.yearModel}</p>
                        <p className="text-xs text-blue-600 font-semibold mt-0.5">{formatPrice(v.promoPrice ?? v.price)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/catalogo/${v.tenantId}`}
                          className="px-2.5 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                        >
                          Ver
                        </Link>
                        <button
                          onClick={() => removeFavorite(v.id)}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 hover:text-rose-500 transition"
                          title="Remover favorito"
                        >
                          <Heart size={14} className="fill-rose-500 text-rose-500" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* AGENDAMENTOS */}
            {tab === 'appointments' && (
              <div className="space-y-3">
                {appointments.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <CalendarDays size={32} className="mx-auto mb-2" />
                    <p className="text-sm">Nenhum agendamento</p>
                  </div>
                ) : appointments.map((a) => {
                  const v = a.vehicle;
                  return (
                    <div key={a.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[a.status] ?? 'bg-slate-100 text-slate-500')}>
                            {STATUS_LABELS[a.status] ?? a.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          {new Date(a.scheduledStart).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                          {' · '}
                          {new Date(a.scheduledStart).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      {v && (
                        <div className="flex items-center gap-2.5 mb-3">
                          {v.images[0] && <img src={v.images[0].url} alt="" className="w-12 h-9 object-cover rounded" />}
                          <p className="text-sm font-medium">{v.brand.name} {v.model.name} {v.versionName ?? ''} {v.yearModel}</p>
                        </div>
                      )}
                      {a.branch && (
                        <p className="text-xs text-slate-500">{a.branch.name} · {a.branch.city}/{a.branch.state}</p>
                      )}
                      {a.salesperson && (
                        <p className="text-xs text-slate-500 mt-1">Vendedor: {a.salesperson.fullName}</p>
                      )}
                      {(a.status === 'scheduled' || a.status === 'confirmed') && (
                        <button
                          onClick={() => cancelAppointment(a.id)}
                          className="mt-3 text-xs text-rose-500 hover:underline"
                        >
                          Cancelar agendamento
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ALERTAS DE PREÇO */}
            {tab === 'alerts' && (
              <div className="space-y-3">
                {alerts.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <Bell size={32} className="mx-auto mb-2" />
                    <p className="text-sm">Nenhum alerta de preço</p>
                    <p className="text-xs mt-1">Ative alertas nos veículos do catálogo</p>
                  </div>
                ) : alerts.map((alert) => {
                  const v = alert.vehicle;
                  return (
                    <div key={v.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex items-center gap-3">
                      {v.images[0] && <img src={v.images[0].url} alt="" className="w-16 h-12 object-cover rounded-lg shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{v.brand.name} {v.model.name} {v.versionName ?? ''} {v.yearModel}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <p className="text-xs text-slate-500">Preço atual: <span className="font-medium text-slate-700 dark:text-slate-300">{formatPrice(v.price)}</span></p>
                          <p className="text-xs text-slate-500">Alerta: <span className="font-medium text-blue-600">{formatPrice(alert.targetPrice)}</span></p>
                        </div>
                        {alert.triggeredAt && (
                          <p className="text-xs text-emerald-600 mt-0.5">✓ Alerta ativado em {new Date(alert.triggeredAt).toLocaleDateString('pt-BR')}</p>
                        )}
                      </div>
                      <button
                        onClick={() => removeAlert(v.id)}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 hover:text-rose-500 transition"
                        title="Remover alerta"
                      >
                        <BellOff size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
