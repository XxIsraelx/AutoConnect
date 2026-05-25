'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Search, MapPin, Phone, Mail, Car, ChevronRight,
  ArrowLeft, Building2, SlidersHorizontal, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { DealershipPin, PublicVehicle } from './types';

/* ── Helpers ─────────────────────────────────────────────── */

function formatPrice(v: string | null | undefined) {
  if (!v) return '–';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(parseFloat(v));
}

function formatKm(km: number) {
  return km === 0 ? '0 km' : `${new Intl.NumberFormat('pt-BR').format(km)} km`;
}

const condMap: Record<string, { label: string; cls: string }> = {
  new:      { label: '0 km',     cls: 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30' },
  semi_new: { label: 'Seminovo', cls: 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30' },
  used:     { label: 'Usado',    cls: 'bg-white/10 text-slate-400 ring-1 ring-white/10' },
  demo:     { label: 'Demo',     cls: 'bg-violet-500/20 text-violet-400 ring-1 ring-violet-500/30' },
};

/* ── Skeletons ───────────────────────────────────────────── */

function CardSkeleton() {
  return (
    <div className="p-4 rounded-2xl bg-[#1e293b] border border-white/[.06] animate-pulse flex gap-3">
      <div className="w-11 h-11 rounded-xl bg-white/10 shrink-0" />
      <div className="flex-1 space-y-2.5 pt-0.5">
        <div className="h-3.5 bg-white/10 rounded-lg w-2/3" />
        <div className="h-3   bg-white/10 rounded-lg w-1/2" />
        <div className="h-3   bg-white/10 rounded-lg w-1/3" />
      </div>
    </div>
  );
}

function VehicleSkeleton() {
  return (
    <div className="flex gap-3 p-3 rounded-xl bg-white/[.04] animate-pulse">
      <div className="w-20 h-16 rounded-lg bg-white/10 shrink-0" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-3   bg-white/10 rounded w-3/4" />
        <div className="h-3.5 bg-white/10 rounded w-1/2" />
        <div className="h-4   bg-white/10 rounded w-2/5" />
      </div>
    </div>
  );
}

/* ── Vehicle card ────────────────────────────────────────── */

function VehicleCard({ v }: { v: PublicVehicle }) {
  const cond  = condMap[v.condition] ?? condMap.used;
  const cover = v.images[0]?.url;
  const price = v.promoPrice ?? v.price;
  const promo = !!v.promoPrice;

  return (
    <div className="group flex gap-3 p-3 rounded-xl border border-white/[.06] bg-white/[.03]
                    hover:border-blue-500/40 hover:bg-blue-500/[.06] transition-all cursor-pointer">
      <div className="w-20 h-16 rounded-lg bg-white/10 shrink-0 overflow-hidden flex items-center justify-center">
        {cover
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={cover} alt="" className="w-full h-full object-cover" />
          : <Car size={18} className="text-white/20" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide truncate">
          {v.brand.name} · {v.model.name}
        </p>
        <p className="text-sm font-bold text-white truncate leading-snug mt-0.5">
          {v.versionName ?? String(v.yearModel)}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`text-[10px] font-bold px-1.5 py-px rounded-full ${cond.cls}`}>
            {cond.label}
          </span>
          {v.mileageKm > 0 && (
            <span className="text-[11px] text-slate-500">{formatKm(v.mileageKm)}</span>
          )}
        </div>
        <p className={`text-sm font-extrabold mt-0.5 ${promo ? 'text-rose-400' : 'text-blue-400'}`}>
          {formatPrice(price)}
          {promo && (
            <span className="ml-1.5 text-[11px] font-normal text-slate-600 line-through">
              {formatPrice(v.price)}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

/* ── Dealer card (lista) ─────────────────────────────────── */

function DealerCard({ pin, onClick }: { pin: DealershipPin; onClick: () => void }) {
  const initials = pin.tenant.tradeName.slice(0, 2).toUpperCase();
  const hasCoords = pin.latitude !== null;

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-2xl border border-white/[.07] bg-[#1e293b]
                 hover:border-blue-500/50 hover:shadow-[0_0_0_1px_rgba(59,130,246,0.2),0_4px_20px_rgba(59,130,246,0.08)]
                 transition-all duration-200 group"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700
                        flex items-center justify-center shrink-0
                        group-hover:shadow-[0_0_0_3px_rgba(59,130,246,.2)] transition-shadow">
          <span className="text-white text-sm font-extrabold tracking-tight">{initials}</span>
        </div>

        {/* Texto */}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-sm leading-snug truncate
                        group-hover:text-blue-400 transition-colors">
            {pin.tenant.tradeName}
          </p>
          <p className="text-xs text-slate-500 truncate mt-0.5">{pin.name}</p>
          {(pin.city || pin.state) && (
            <div className="flex items-center gap-1 mt-1.5">
              <MapPin size={11} className="text-slate-600 shrink-0" />
              <span className="text-xs text-slate-500">
                {[pin.city, pin.state].filter(Boolean).join(', ')}
              </span>
            </div>
          )}
        </div>

        {/* Badge + seta */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full
            ${pin.vehiclesCount > 0
              ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30'
              : 'bg-white/[.06] text-slate-500 ring-1 ring-white/10'}`}>
            {pin.vehiclesCount} veíc.
          </span>
          {!hasCoords && (
            <span className="text-[10px] text-amber-500/70 font-medium">sem mapa</span>
          )}
          <ChevronRight size={14}
            className="text-slate-700 group-hover:text-blue-400 transition-colors mt-0.5" />
        </div>
      </div>
    </button>
  );
}

/* ── Detail view ─────────────────────────────────────────── */

function DealerDetail({ pin, onBack }: { pin: DealershipPin; onBack: () => void }) {
  const [vehicles, setVehicles] = useState<PublicVehicle[]>([]);
  const [loadingV, setLoadingV] = useState(true);

  useEffect(() => {
    setLoadingV(true);
    api<PublicVehicle[]>(`/catalog/vehicles?tenantId=${pin.tenant.id}&limit=8`)
      .then(setVehicles)
      .catch(() => setVehicles([]))
      .finally(() => setLoadingV(false));
  }, [pin.tenant.id]);

  const initials = pin.tenant.tradeName.slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col h-full bg-[#0f172a]">

      {/* Header do detalhe */}
      <div className="px-4 pt-4 pb-4 border-b border-white/[.06] sticky top-0 z-10 bg-[#0f172a]">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-500
                     hover:text-blue-400 transition-colors mb-4 group"
        >
          <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
          Todas as concessionárias
        </button>

        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700
                          flex items-center justify-center shrink-0
                          shadow-lg shadow-blue-900/50">
            <span className="text-white text-lg font-extrabold tracking-tight">{initials}</span>
          </div>
          <div>
            <h2 className="font-extrabold text-white text-[15px] leading-tight">
              {pin.tenant.tradeName}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-snug">{pin.name}</p>
          </div>
        </div>
      </div>

      {/* Contato */}
      <div className="px-4 py-3 space-y-2 border-b border-white/[.06] bg-white/[.02]">
        {(pin.city || pin.state || pin.addressLine) && (
          <div className="flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
              <MapPin size={12} className="text-blue-400" />
            </div>
            <span className="text-sm text-slate-400 leading-snug">
              {[pin.addressLine, [pin.city, pin.state].filter(Boolean).join(', ')]
                .filter(Boolean).join(' — ')}
            </span>
          </div>
        )}
        {pin.phone && (
          <a href={`tel:${pin.phone}`} className="flex items-center gap-2.5 group">
            <div className="w-6 h-6 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
              <Phone size={12} className="text-blue-400" />
            </div>
            <span className="text-sm text-slate-400 group-hover:text-blue-400 transition-colors">
              {pin.phone}
            </span>
          </a>
        )}
        {pin.email && (
          <a href={`mailto:${pin.email}`} className="flex items-center gap-2.5 group min-w-0">
            <div className="w-6 h-6 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
              <Mail size={12} className="text-blue-400" />
            </div>
            <span className="text-sm text-slate-400 group-hover:text-blue-400 transition-colors truncate">
              {pin.email}
            </span>
          </a>
        )}
      </div>

      {/* Veículos */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <Car size={11} className="text-blue-500" />
            Estoque disponível
          </h3>
          {!loadingV && vehicles.length > 0 && (
            <Link href={`/catalogo/${pin.tenant.id}`}
                  className="text-xs text-blue-400 hover:text-blue-300 font-semibold
                             flex items-center gap-0.5 transition-colors">
              Ver todos <ChevronRight size={12} />
            </Link>
          )}
        </div>

        {loadingV ? (
          <div className="space-y-2.5">{[1,2,3].map(i => <VehicleSkeleton key={i} />)}</div>
        ) : vehicles.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/[.05] flex items-center justify-center mb-3">
              <Car size={28} className="text-white/20" />
            </div>
            <p className="text-sm font-bold text-slate-500 mb-1">Sem veículos publicados</p>
            <p className="text-xs text-slate-600 leading-relaxed max-w-[200px]">
              Esta concessionária ainda não tem veículos no estoque.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {vehicles.map(v => <VehicleCard key={v.id} v={v} />)}
          </div>
        )}
      </div>

      {/* CTA rodapé */}
      <div className="p-4 border-t border-white/[.06] bg-[#0f172a]">
        <Link
          href={`/catalogo/${pin.tenant.id}`}
          className="flex items-center justify-center gap-2 w-full
                     bg-gradient-to-r from-blue-600 to-blue-500
                     text-white text-sm font-bold py-3 rounded-2xl
                     hover:from-blue-500 hover:to-blue-400
                     shadow-lg shadow-blue-900/50
                     transition-all duration-200"
        >
          Ver catálogo completo <ChevronRight size={16} />
        </Link>
      </div>
    </div>
  );
}

/* ── Sidebar principal ───────────────────────────────────── */

const BR_STATES = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA',
  'MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN',
  'RO','RR','RS','SC','SE','SP','TO',
];

interface Props {
  pins: DealershipPin[];
  loading: boolean;
  selected: DealershipPin | null;
  onSelect: (pin: DealershipPin | null) => void;
}

export default function Sidebar({ pins, loading, selected, onSelect }: Props) {
  const [search, setSearch]             = useState('');
  const [stateFilter, setStateFilter]   = useState('');
  const [filtersOpen, setFiltersOpen]   = useState(false);
  const [onlyVehicles, setOnlyVehicles] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return pins.filter(p => {
      const matchQ  = !q
        || p.name.toLowerCase().includes(q)
        || p.tenant.tradeName.toLowerCase().includes(q)
        || (p.city ?? '').toLowerCase().includes(q);
      const matchSt = !stateFilter || p.state === stateFilter;
      const matchV  = !onlyVehicles || p.vehiclesCount > 0;
      return matchQ && matchSt && matchV;
    });
  }, [pins, search, stateFilter, onlyVehicles]);

  const activeFilters = (stateFilter ? 1 : 0) + (onlyVehicles ? 1 : 0);

  if (selected) return <DealerDetail pin={selected} onBack={() => onSelect(null)} />;

  return (
    <div className="flex flex-col h-full bg-[#0f172a]">

      {/* ── Cabeçalho fixo ─────────────────────────── */}
      <div className="px-4 pt-4 pb-3 space-y-3 border-b border-white/[.06]">

        <div>
          <h1 className="text-base font-extrabold text-white">
            Encontre uma concessionária
          </h1>
          {!loading && (
            <p className="text-xs text-slate-500 mt-0.5">
              {pins.length} cadastrada{pins.length !== 1 ? 's' : ''} no AutoConnect
            </p>
          )}
        </div>

        {/* Input de busca */}
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, cidade…"
            className="w-full pl-9 pr-9 py-2.5 rounded-xl
                       bg-[#1e293b] border border-transparent
                       text-sm text-white placeholder-slate-600
                       outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20
                       transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filtros */}
        <div className="flex gap-2">
          <select
            value={stateFilter}
            onChange={e => setStateFilter(e.target.value)}
            style={{ colorScheme: 'dark' }}
            className="flex-1 py-2 px-3 rounded-xl
                       bg-[#1e293b] border border-transparent
                       text-sm text-slate-300 cursor-pointer
                       outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20
                       transition-all"
          >
            <option value="">Todos os estados</option>
            {BR_STATES.map(uf => <option key={uf} value={uf}>{uf}</option>)}
          </select>

          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl
                        text-sm font-semibold transition-all border
              ${filtersOpen || activeFilters > 0
                ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                : 'border-white/[.07] bg-[#1e293b] text-slate-400 hover:border-white/20 hover:text-slate-300'}`}
          >
            <SlidersHorizontal size={14} />
            Filtros
            {activeFilters > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-blue-600
                               text-white text-[10px] font-bold rounded-full
                               flex items-center justify-center">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {/* Painel de filtros extras */}
        {filtersOpen && (
          <div className="pt-1 pb-0.5 px-1 space-y-2 border-t border-white/[.06]">
            <label className="flex items-center gap-2.5 text-sm text-slate-400 cursor-pointer group">
              <div
                className={`w-4 h-4 rounded flex items-center justify-center border-2 transition-all
                  ${onlyVehicles ? 'border-blue-500 bg-blue-600' : 'border-white/20 bg-transparent group-hover:border-blue-500/50'}`}
                onClick={() => setOnlyVehicles(!onlyVehicles)}
              >
                {onlyVehicles && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
              <span className={onlyVehicles ? 'text-blue-400 font-semibold' : ''}>
                Apenas com veículos disponíveis
              </span>
            </label>
          </div>
        )}
      </div>

      {/* ── Lista ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)

        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-white/[.04] flex items-center justify-center mb-4">
              {pins.length === 0
                ? <Building2 size={28} className="text-white/15" />
                : <Search size={28}   className="text-white/15" />}
            </div>
            <p className="text-sm font-bold text-slate-400 mb-1">
              {pins.length === 0 ? 'Nenhuma concessionária ainda' : 'Sem resultados'}
            </p>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              {pins.length === 0
                ? 'Seja o primeiro a aparecer no mapa!'
                : 'Tente outros termos ou remova os filtros.'}
            </p>
            {(stateFilter || onlyVehicles) && (
              <button
                onClick={() => { setStateFilter(''); setOnlyVehicles(false); }}
                className="text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors"
              >
                Limpar filtros
              </button>
            )}
            {pins.length === 0 && (
              <Link href="/signup"
                    className="mt-1 text-sm bg-blue-600 text-white font-bold px-5 py-2.5 rounded-xl hover:bg-blue-500 transition">
                Cadastrar concessionária
              </Link>
            )}
          </div>

        ) : (
          <>
            <div className="px-1 pb-1 flex items-center justify-between">
              <p className="text-xs text-slate-600 font-medium">
                {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
                {stateFilter && <span className="text-blue-500"> · {stateFilter}</span>}
              </p>
              {(search || stateFilter || onlyVehicles) && (
                <button
                  onClick={() => { setSearch(''); setStateFilter(''); setOnlyVehicles(false); }}
                  className="text-[11px] text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors"
                >
                  <X size={11} /> Limpar
                </button>
              )}
            </div>
            {filtered.map(pin => (
              <DealerCard key={pin.id} pin={pin} onClick={() => onSelect(pin)} />
            ))}
          </>
        )}
      </div>

      {/* ── Rodapé ─────────────────────────────────── */}
      <div className="p-4 border-t border-white/[.06]">
        <Link
          href="/signup"
          className="flex items-center justify-center gap-2 w-full
                     bg-gradient-to-r from-blue-600 to-blue-500
                     text-white text-sm font-bold py-2.5 rounded-xl
                     hover:from-blue-500 hover:to-blue-400
                     shadow-lg shadow-blue-900/40
                     transition-all duration-200"
        >
          <Building2 size={14} />
          Cadastrar minha concessionária
        </Link>
      </div>
    </div>
  );
}
