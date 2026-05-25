'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Search, MapPin, Phone, Mail, Car, ChevronRight,
  ArrowLeft, Loader2, Building2, SlidersHorizontal, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { DealershipPin, PublicVehicle } from './types';

/* ── Helpers ─────────────────────────────────────────────── */

function formatPrice(value: string | null | undefined): string {
  if (!value) return '–';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(parseFloat(value));
}

function formatKm(km: number): string {
  return km === 0 ? '0 km' : new Intl.NumberFormat('pt-BR').format(km) + ' km';
}

const conditionMap: Record<string, { label: string; cls: string }> = {
  new:      { label: '0 km',        cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  semi_new: { label: 'Seminovo',    cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  used:     { label: 'Usado',       cls: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' },
  demo:     { label: 'Demo',        cls: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
};

/* ── Skeleton ────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div className="p-4 rounded-2xl border border-slate-100 animate-pulse flex gap-3">
      <div className="w-11 h-11 rounded-xl bg-slate-100 shrink-0" />
      <div className="flex-1 space-y-2.5 pt-0.5">
        <div className="h-3.5 bg-slate-100 rounded-lg w-2/3" />
        <div className="h-3 bg-slate-100 rounded-lg w-1/2" />
        <div className="h-3 bg-slate-100 rounded-lg w-1/3" />
      </div>
    </div>
  );
}

function VehicleSkeleton() {
  return (
    <div className="flex gap-3 p-3 rounded-xl border border-slate-100 animate-pulse">
      <div className="w-20 h-16 rounded-lg bg-slate-100 shrink-0" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-3 bg-slate-100 rounded w-3/4" />
        <div className="h-3.5 bg-slate-100 rounded w-1/2" />
        <div className="h-4 bg-slate-100 rounded w-2/5" />
      </div>
    </div>
  );
}

/* ── Vehicle card ────────────────────────────────────────── */

function VehicleCard({ v }: { v: PublicVehicle }) {
  const cond = conditionMap[v.condition] ?? conditionMap.used;
  const cover = v.images[0]?.url;
  const price = v.promoPrice ?? v.price;
  const isPromo = !!v.promoPrice;

  return (
    <div className="group flex gap-3 p-3 rounded-xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/40 transition-all cursor-pointer">
      {/* Thumbnail */}
      <div className="w-20 h-16 rounded-lg bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="w-full h-full object-cover" />
        ) : (
          <Car size={18} className="text-slate-300" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide truncate">
          {v.brand.name} · {v.model.name}
        </p>
        <p className="text-sm font-bold text-slate-800 truncate leading-snug mt-0.5">
          {v.versionName ?? String(v.yearModel)}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`text-[10px] font-bold px-1.5 py-px rounded-full ${cond.cls}`}>
            {cond.label}
          </span>
          {v.mileageKm > 0 && (
            <span className="text-[11px] text-slate-400">{formatKm(v.mileageKm)}</span>
          )}
        </div>
        <p className={`text-sm font-extrabold mt-0.5 ${isPromo ? 'text-rose-600' : 'text-blue-600'}`}>
          {formatPrice(price)}
          {isPromo && (
            <span className="ml-1.5 text-[11px] font-medium text-slate-400 line-through">
              {formatPrice(v.price)}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

/* ── Dealer card (list) ──────────────────────────────────── */

function DealerCard({
  pin,
  onClick,
}: {
  pin: DealershipPin;
  onClick: () => void;
}) {
  const hasCoords = pin.latitude !== null;
  const initials = pin.tenant.tradeName.slice(0, 2).toUpperCase();

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-2xl border border-slate-100 bg-white
                 hover:border-blue-200 hover:shadow-[0_2px_16px_rgba(59,130,246,.1)]
                 transition-all duration-200 group"
    >
      <div className="flex items-start gap-3">
        {/* Avatar com iniciais */}
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700
                        flex items-center justify-center shrink-0 shadow-sm
                        group-hover:shadow-[0_0_0_3px_rgba(59,130,246,.15)] transition-shadow">
          <span className="text-white text-sm font-extrabold tracking-tight">{initials}</span>
        </div>

        {/* Texto */}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-800 text-sm leading-snug truncate group-hover:text-blue-700 transition-colors">
            {pin.tenant.tradeName}
          </p>
          <p className="text-xs text-slate-500 truncate mt-0.5">{pin.name}</p>
          {(pin.city || pin.state) && (
            <div className="flex items-center gap-1 mt-1.5">
              <MapPin size={11} className="text-slate-400 shrink-0" />
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
              ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
              : 'bg-slate-50 text-slate-400 ring-1 ring-slate-200'}`}>
            {pin.vehiclesCount} veíc.
          </span>
          {!hasCoords && (
            <span className="text-[10px] text-amber-500 font-medium">• sem mapa</span>
          )}
          <ChevronRight size={14} className="text-slate-300 group-hover:text-blue-500 transition-colors mt-0.5" />
        </div>
      </div>
    </button>
  );
}

/* ── Detail view ─────────────────────────────────────────── */

function DealerDetail({
  pin,
  onBack,
}: {
  pin: DealershipPin;
  onBack: () => void;
}) {
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
    <div className="flex flex-col h-full">

      {/* Header do detalhe */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-100 bg-white sticky top-0 z-10">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-semibold text-blue-600
                     hover:text-blue-800 transition-colors mb-4 group"
        >
          <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
          Todas as concessionárias
        </button>

        {/* Identidade */}
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700
                          flex items-center justify-center shrink-0 shadow-lg shadow-blue-200">
            <span className="text-white text-lg font-extrabold tracking-tight">{initials}</span>
          </div>
          <div>
            <h2 className="font-extrabold text-slate-800 text-[15px] leading-tight">
              {pin.tenant.tradeName}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-snug">{pin.name}</p>
          </div>
        </div>
      </div>

      {/* Contato */}
      <div className="px-4 py-3 space-y-2 border-b border-slate-100 bg-slate-50/60">
        {(pin.city || pin.state || pin.addressLine) && (
          <div className="flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 mt-0.5">
              <MapPin size={12} className="text-blue-500" />
            </div>
            <span className="text-sm text-slate-700 leading-snug">
              {[pin.addressLine, [pin.city, pin.state].filter(Boolean).join(', ')]
                .filter(Boolean).join(' — ')}
            </span>
          </div>
        )}
        {pin.phone && (
          <a href={`tel:${pin.phone}`}
             className="flex items-center gap-2.5 group">
            <div className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
              <Phone size={12} className="text-blue-500" />
            </div>
            <span className="text-sm text-slate-700 group-hover:text-blue-600 transition-colors">
              {pin.phone}
            </span>
          </a>
        )}
        {pin.email && (
          <a href={`mailto:${pin.email}`}
             className="flex items-center gap-2.5 group min-w-0">
            <div className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
              <Mail size={12} className="text-blue-500" />
            </div>
            <span className="text-sm text-slate-700 group-hover:text-blue-600 transition-colors truncate">
              {pin.email}
            </span>
          </a>
        )}
      </div>

      {/* Veículos */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Car size={12} className="text-blue-500" />
            Estoque disponível
          </h3>
          {!loadingV && vehicles.length > 0 && (
            <Link href={`/catalogo/${pin.tenant.id}`}
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-0.5 transition-colors">
              Ver todos <ChevronRight size={12} />
            </Link>
          )}
        </div>

        {loadingV ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map((i) => <VehicleSkeleton key={i} />)}
          </div>
        ) : vehicles.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
              <Car size={28} className="text-slate-300" />
            </div>
            <p className="text-sm font-bold text-slate-500 mb-1">Sem veículos publicados</p>
            <p className="text-xs text-slate-400 leading-relaxed max-w-[200px]">
              Esta concessionária ainda não tem veículos no estoque. Volte em breve!
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {vehicles.map((v) => <VehicleCard key={v.id} v={v} />)}
          </div>
        )}
      </div>

      {/* CTA rodapé */}
      <div className="p-4 border-t border-slate-100 bg-white">
        <Link
          href={`/catalogo/${pin.tenant.id}`}
          className="flex items-center justify-center gap-2 w-full
                     bg-gradient-to-r from-blue-600 to-blue-500
                     text-white text-sm font-bold py-3 rounded-2xl
                     hover:from-blue-700 hover:to-blue-600
                     shadow-lg shadow-blue-200
                     transition-all duration-200 hover:shadow-xl hover:shadow-blue-300"
        >
          Ver catálogo completo
          <ChevronRight size={16} />
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
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [onlyWithVehicles, setOnlyWithVehicles] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return pins.filter((p) => {
      const matchSearch = !q
        || p.name.toLowerCase().includes(q)
        || p.tenant.tradeName.toLowerCase().includes(q)
        || (p.city ?? '').toLowerCase().includes(q);
      const matchState = !stateFilter || p.state === stateFilter;
      const matchVehicles = !onlyWithVehicles || p.vehiclesCount > 0;
      return matchSearch && matchState && matchVehicles;
    });
  }, [pins, search, stateFilter, onlyWithVehicles]);

  const activeFilters = (stateFilter ? 1 : 0) + (onlyWithVehicles ? 1 : 0);

  /* Vista de detalhe */
  if (selected) {
    return <DealerDetail pin={selected} onBack={() => onSelect(null)} />;
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Cabeçalho fixo ─────────────────────────── */}
      <div className="px-4 pt-4 pb-3 space-y-3 border-b border-slate-100 bg-white">

        {/* Título */}
        <div>
          <h1 className="text-base font-extrabold text-slate-800">Encontre uma concessionária</h1>
          {!loading && (
            <p className="text-xs text-slate-400 mt-0.5">
              {pins.length} cadastrada{pins.length !== 1 ? 's' : ''} no AutoConnect
            </p>
          )}
        </div>

        {/* Campo de busca */}
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, cidade…"
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200
                       bg-slate-50 text-sm text-slate-800 placeholder-slate-400
                       outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400
                       focus:bg-white transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Linha filtros */}
        <div className="flex gap-2">
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="flex-1 py-2 px-3 rounded-xl border border-slate-200 bg-slate-50
                       text-sm text-slate-700 cursor-pointer
                       outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          >
            <option value="">Todos os estados</option>
            {BR_STATES.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>

          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold transition-all
              ${filtersOpen || activeFilters > 0
                ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm shadow-blue-100'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white'}`}
          >
            <SlidersHorizontal size={14} />
            Filtros
            {activeFilters > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {/* Painel de filtros extras */}
        {filtersOpen && (
          <div className="pt-1 pb-0.5 px-1 space-y-2 border-t border-slate-100">
            <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer group">
              <div className={`w-4 h-4 rounded flex items-center justify-center border-2 transition-all
                ${onlyWithVehicles ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white group-hover:border-blue-400'}`}
                onClick={() => setOnlyWithVehicles(!onlyWithVehicles)}
              >
                {onlyWithVehicles && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
              <span className={onlyWithVehicles ? 'font-semibold text-blue-700' : ''}>
                Apenas com veículos disponíveis
              </span>
            </label>
          </div>
        )}
      </div>

      {/* ── Lista de resultados ─────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              {pins.length === 0
                ? <Building2 size={28} className="text-slate-300" />
                : <Search size={28} className="text-slate-300" />}
            </div>
            <p className="text-sm font-bold text-slate-600 mb-1">
              {pins.length === 0 ? 'Nenhuma concessionária ainda' : 'Sem resultados'}
            </p>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              {pins.length === 0
                ? 'Seja o primeiro a aparecer no mapa!'
                : 'Tente outros termos ou remova os filtros.'}
            </p>
            {(stateFilter || onlyWithVehicles) && (
              <button
                onClick={() => { setStateFilter(''); setOnlyWithVehicles(false); }}
                className="text-xs text-blue-600 font-semibold hover:underline"
              >
                Limpar filtros
              </button>
            )}
            {pins.length === 0 && (
              <Link href="/signup"
                    className="mt-1 text-sm bg-blue-600 text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-blue-700 transition">
                Cadastrar concessionária
              </Link>
            )}
          </div>
        ) : (
          <>
            {/* Resumo de filtros */}
            <div className="px-1 pb-1 flex items-center justify-between">
              <p className="text-xs text-slate-400 font-medium">
                {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
                {stateFilter && <span className="text-blue-600"> · {stateFilter}</span>}
              </p>
              {(search || stateFilter || onlyWithVehicles) && (
                <button
                  onClick={() => { setSearch(''); setStateFilter(''); setOnlyWithVehicles(false); }}
                  className="text-[11px] text-slate-400 hover:text-slate-600 flex items-center gap-1"
                >
                  <X size={11} /> Limpar
                </button>
              )}
            </div>

            {filtered.map((pin) => (
              <DealerCard key={pin.id} pin={pin} onClick={() => onSelect(pin)} />
            ))}
          </>
        )}
      </div>

      {/* ── Rodapé fixo ────────────────────────────── */}
      <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/80">
        <Link
          href="/signup"
          className="flex items-center justify-center gap-1.5 w-full
                     text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors py-1"
        >
          <Building2 size={13} />
          Cadastrar minha concessionária
        </Link>
      </div>
    </div>
  );
}
