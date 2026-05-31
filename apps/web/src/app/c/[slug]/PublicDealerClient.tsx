'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  MapPin, Phone, Globe, Search, X, Heart,
  Car, Fuel, Gauge, SlidersHorizontal, ChevronLeft, ChevronRight,
  MessageCircle, ArrowLeft, Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';

/* ── Tipos ─────────────────────────────────────────────── */
interface Dealer {
  id: string; slug: string; tradeName: string;
  logoUrl: string | null; brandColor: string | null;
  websiteUrl: string | null; primaryPhone: string | null;
  branches: {
    id: string; name: string; city: string; state: string;
    addressLine: string | null; addressNumber: string | null;
    neighborhood: string | null; postalCode: string | null;
    phone: string | null; email: string | null;
  }[];
}

interface PublicVehicle {
  id: string; versionName: string | null; yearModel: number;
  price: string | null; promoPrice: string | null;
  mileageKm: number; condition: string; color: string | null;
  fuel: string | null; brand: { name: string }; model: { name: string };
  images: { url: string }[];
}

/* ── Helpers ────────────────────────────────────────────── */
function fmtPrice(v: string | null | undefined) {
  if (!v) return '–';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(Number(v));
}

const CONDITION_LABELS: Record<string, string> = {
  new: 'Novo', used: 'Usado', semi_new: 'Seminovo', demo: 'Demo',
};

export default function PublicDealerClient({ dealer }: { dealer: Dealer }) {
  const { token } = useAuthStore();
  const [vehicles, setVehicles]   = useState<PublicVehicle[]>([]);
  const [total,    setTotal]      = useState(0);
  const [page,     setPage]       = useState(0); // skip-based
  const [q,        setQ]          = useState('');
  const [condition, setCondition] = useState('');
  const [loading,  setLoading]    = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const limit = 12;

  const loadVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tenantId: dealer.id,
        limit: String(limit),
        skip: String(page * limit),
      });
      if (q)         params.set('q', q);
      if (condition) params.set('condition', condition);
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'}/catalog/vehicles?${params}`,
      ).then((res) => res.json()) as { items: PublicVehicle[]; total: number };
      setVehicles(r.items);
      setTotal(r.total);
    } catch { /* ignora */ }
    finally { setLoading(false); }
  }, [dealer.id, page, q, condition]);

  useEffect(() => { loadVehicles(); }, [loadVehicles]);

  // Carrega favoritos se logado
  useEffect(() => {
    if (!token) return;
    api<string[]>('/catalog/favorites/ids', { token })
      .then((ids) => setFavorites(new Set(ids)))
      .catch(() => null);
  }, [token]);

  async function toggleFavorite(vehicleId: string) {
    if (!token) return;
    if (favorites.has(vehicleId)) {
      await api(`/catalog/favorites/${vehicleId}`, { token, method: 'DELETE' });
      setFavorites((prev) => { const next = new Set(prev); next.delete(vehicleId); return next; });
    } else {
      await api(`/catalog/favorites/${vehicleId}`, { token, method: 'POST' });
      setFavorites((prev) => new Set([...prev, vehicleId]));
    }
  }

  const branch = dealer.branches[0];
  const totalPages = Math.ceil(total / limit);
  const brandColor = dealer.brandColor ?? '#2563eb';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Hero header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              {dealer.logoUrl ? (
                <img src={dealer.logoUrl} alt={dealer.tradeName} className="w-12 h-12 object-contain rounded-xl" />
              ) : (
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-bold"
                  style={{ background: brandColor }}
                >
                  {dealer.tradeName.charAt(0)}
                </div>
              )}
              <div>
                <h1 className="text-xl font-bold">{dealer.tradeName}</h1>
                {branch && (
                  <p className="text-sm text-slate-500 flex items-center gap-1 mt-0.5">
                    <MapPin size={12} />
                    {branch.city}/{branch.state}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {(branch?.phone ?? dealer.primaryPhone) && (
                <a
                  href={`tel:${(branch?.phone ?? dealer.primaryPhone)?.replace(/\D/g, '')}`}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium hover:border-blue-400 transition"
                >
                  <Phone size={14} />
                  {branch?.phone ?? dealer.primaryPhone}
                </a>
              )}
              {(branch?.phone ?? dealer.primaryPhone) && (
                <a
                  href={`https://wa.me/55${(branch?.phone ?? dealer.primaryPhone)?.replace(/\D/g, '')}`}
                  target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition"
                >
                  <MessageCircle size={14} />
                  WhatsApp
                </a>
              )}
            </div>
          </div>

          {/* Endereço */}
          {branch && (
            <div className="mt-3 text-xs text-slate-500 flex items-start gap-1.5">
              <MapPin size={11} className="mt-0.5 shrink-0" />
              <span>
                {[branch.addressLine, branch.addressNumber, branch.neighborhood, branch.city, branch.state, branch.postalCode]
                  .filter(Boolean).join(', ')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Filtros + catálogo */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Busca e filtros */}
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }}
              placeholder="Buscar marca, modelo…"
              className="w-full pl-9 pr-8 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500 transition"
            />
            {q && <button onClick={() => { setQ(''); setPage(0); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={13} /></button>}
          </div>

          <div className="flex gap-1.5">
            {[
              { value: '', label: 'Todos' },
              { value: 'new', label: 'Novo' },
              { value: 'used', label: 'Usado' },
              { value: 'semi_new', label: 'Seminovo' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setCondition(opt.value); setPage(0); }}
                className={cn(
                  'px-3 py-2 text-xs font-medium rounded-xl transition border',
                  condition === opt.value
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-blue-400',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contagem */}
        <p className="text-xs text-slate-500 mb-4">{total} veículo{total !== 1 ? 's' : ''} disponível{total !== 1 ? 'is' : ''}</p>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: limit }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 h-64 animate-pulse" />
            ))}
          </div>
        ) : vehicles.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <Car size={40} className="mx-auto mb-3" />
            <p className="text-sm">Nenhum veículo encontrado</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {vehicles.map((v) => {
              const isFav = favorites.has(v.id);
              return (
                <div key={v.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden group hover:shadow-lg hover:-translate-y-0.5 transition-all">
                  <div className="relative aspect-video bg-slate-100 dark:bg-slate-800">
                    {v.images[0] ? (
                      <img src={v.images[0].url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Car size={24} className="text-slate-300" />
                      </div>
                    )}
                    <span className="absolute top-2 left-2 text-[10px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded-full">
                      {CONDITION_LABELS[v.condition] ?? v.condition}
                    </span>
                    {token && (
                      <button
                        onClick={() => toggleFavorite(v.id)}
                        className="absolute top-2 right-2 p-1.5 rounded-full bg-white/90 dark:bg-slate-900/90 hover:scale-110 transition-transform"
                      >
                        <Heart size={13} className={isFav ? 'fill-rose-500 text-rose-500' : 'text-slate-400'} />
                      </button>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-xs font-semibold truncate">{v.brand.name} {v.model.name}</p>
                    <p className="text-xs text-slate-500 truncate">{v.versionName ?? ''} {v.yearModel}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-500">
                      {v.fuel && <span className="flex items-center gap-0.5"><Fuel size={9} /> {v.fuel}</span>}
                      <span className="flex items-center gap-0.5"><Gauge size={9} /> {v.mileageKm === 0 ? '0 km' : `${v.mileageKm.toLocaleString('pt-BR')} km`}</span>
                    </div>
                    <div className="flex items-center justify-between mt-2.5">
                      <p className="text-sm font-bold text-blue-600">
                        {fmtPrice(v.promoPrice ?? v.price)}
                      </p>
                      <Link
                        href={`/catalogo/${dealer.id}?vehicleId=${v.id}`}
                        className="text-[10px] font-medium text-blue-600 hover:underline"
                      >
                        Ver mais →
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-slate-600">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
