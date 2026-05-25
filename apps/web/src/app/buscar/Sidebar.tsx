'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Search, MapPin, Phone, Mail, Car, ChevronRight,
  ArrowLeft, Loader2, Star, Building2, Filter, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { DealershipPin, PublicVehicle } from './types';

/* ── Helpers ─────────────────────────────────────────────── */

function formatPrice(value: string | null | undefined): string {
  if (!value) return '–';
  const num = parseFloat(value);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

function formatKm(km: number): string {
  if (km === 0) return '0 km';
  return new Intl.NumberFormat('pt-BR').format(km) + ' km';
}

const conditionLabel: Record<string, string> = {
  new: '0 km',
  semi_new: 'Seminovo',
  used: 'Usado',
  demo: 'Demonstração',
};

const conditionColor: Record<string, string> = {
  new: 'bg-green-100 text-green-700',
  semi_new: 'bg-blue-100 text-blue-700',
  used: 'bg-slate-100 text-slate-600',
  demo: 'bg-purple-100 text-purple-700',
};

/* ── Sub-components ──────────────────────────────────────── */

function VehicleCardSkeleton() {
  return (
    <div className="flex gap-3 p-3 rounded-xl border border-slate-100 animate-pulse">
      <div className="w-20 h-16 rounded-lg bg-slate-200 shrink-0" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-3.5 bg-slate-200 rounded w-3/4" />
        <div className="h-3 bg-slate-200 rounded w-1/2" />
        <div className="h-4 bg-slate-200 rounded w-1/3" />
      </div>
    </div>
  );
}

function VehicleCard({ vehicle }: { vehicle: PublicVehicle }) {
  const cover = vehicle.images[0]?.url;
  const price = vehicle.promoPrice ?? vehicle.price;
  const hasPromo = !!vehicle.promoPrice;

  return (
    <div className="flex gap-3 p-3 rounded-xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all cursor-pointer group">
      {/* Imagem */}
      <div className="w-20 h-16 rounded-lg bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={vehicle.versionName ?? ''} className="w-full h-full object-cover" />
        ) : (
          <Car size={20} className="text-slate-300" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 font-medium truncate">
          {vehicle.brand.name} {vehicle.model.name}
        </p>
        <p className="text-sm font-semibold text-slate-800 truncate leading-snug">
          {vehicle.versionName ?? `${vehicle.yearModel}`}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${conditionColor[vehicle.condition] ?? conditionColor.used}`}>
            {conditionLabel[vehicle.condition] ?? vehicle.condition}
          </span>
          {vehicle.mileageKm > 0 && (
            <span className="text-[11px] text-slate-400">{formatKm(vehicle.mileageKm)}</span>
          )}
        </div>
        <p className={`text-sm font-bold mt-0.5 ${hasPromo ? 'text-red-600' : 'text-blue-600'}`}>
          {formatPrice(price)}
        </p>
      </div>
    </div>
  );
}

/* ── Dealer card (list view) ─────────────────────────────── */

function DealerCard({
  pin,
  selected,
  onClick,
}: {
  pin: DealershipPin;
  selected: boolean;
  onClick: () => void;
}) {
  const hasCoords = pin.latitude !== null && pin.longitude !== null;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border transition-all group
        ${selected
          ? 'border-blue-400 bg-blue-50 shadow-sm'
          : 'border-slate-100 bg-white hover:border-slate-300 hover:shadow-sm'
        }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
          ${selected ? 'bg-blue-600' : 'bg-slate-100 group-hover:bg-slate-200'} transition-colors`}>
          <Building2 size={18} className={selected ? 'text-white' : 'text-slate-500'} />
        </div>

        {/* Texto */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-sm leading-snug truncate">
            {pin.tenant.tradeName}
          </p>
          <p className="text-xs text-slate-500 truncate">{pin.name}</p>
          {(pin.city || pin.state) && (
            <div className="flex items-center gap-1 mt-1">
              <MapPin size={11} className="text-slate-400 shrink-0" />
              <span className="text-xs text-slate-500">
                {[pin.city, pin.state].filter(Boolean).join(', ')}
              </span>
            </div>
          )}
        </div>

        {/* Badge + arrow */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full
            ${pin.vehiclesCount > 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
            {pin.vehiclesCount} veíc.
          </span>
          {!hasCoords && (
            <span className="text-[10px] text-amber-500">sem mapa</span>
          )}
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
  const [loadingVehicles, setLoadingVehicles] = useState(true);

  useEffect(() => {
    setLoadingVehicles(true);
    api<PublicVehicle[]>(`/catalog/vehicles?tenantId=${pin.tenant.id}&limit=8`)
      .then(setVehicles)
      .catch(() => setVehicles([]))
      .finally(() => setLoadingVehicles(false));
  }, [pin.tenant.id]);

  return (
    <div className="flex flex-col h-full">
      {/* Cabeçalho do detalhe */}
      <div className="p-4 border-b border-slate-100 bg-white sticky top-0 z-10">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium mb-3 transition-colors"
        >
          <ArrowLeft size={15} />
          Todas as concessionárias
        </button>

        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
            <Building2 size={22} className="text-white" />
          </div>
          <div>
            <h2 className="font-bold text-slate-800 text-base leading-tight">
              {pin.tenant.tradeName}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{pin.name}</p>
          </div>
        </div>
      </div>

      {/* Info de contato */}
      <div className="p-4 space-y-2 border-b border-slate-100">
        {(pin.city || pin.state) && (
          <div className="flex items-start gap-2.5 text-sm text-slate-700">
            <MapPin size={15} className="shrink-0 text-slate-400 mt-0.5" />
            <span>
              {[pin.addressLine, [pin.city, pin.state].filter(Boolean).join(', ')]
                .filter(Boolean)
                .join(' — ')}
            </span>
          </div>
        )}
        {pin.phone && (
          <a
            href={`tel:${pin.phone}`}
            className="flex items-center gap-2.5 text-sm text-slate-700 hover:text-blue-600 transition-colors"
          >
            <Phone size={15} className="shrink-0 text-slate-400" />
            {pin.phone}
          </a>
        )}
        {pin.email && (
          <a
            href={`mailto:${pin.email}`}
            className="flex items-center gap-2.5 text-sm text-slate-700 hover:text-blue-600 transition-colors truncate"
          >
            <Mail size={15} className="shrink-0 text-slate-400" />
            {pin.email}
          </a>
        )}
      </div>

      {/* Veículos */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <Car size={14} className="text-blue-500" />
            Veículos disponíveis
            {!loadingVehicles && (
              <span className="ml-1 text-xs font-normal text-slate-400">
                ({pin.vehiclesCount})
              </span>
            )}
          </h3>
          {vehicles.length > 0 && (
            <Link
              href={`/catalogo/${pin.tenant.id}`}
              className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-0.5"
            >
              Ver todos <ChevronRight size={12} />
            </Link>
          )}
        </div>

        {loadingVehicles ? (
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <VehicleCardSkeleton key={i} />
            ))}
          </div>
        ) : vehicles.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
              <Car size={24} className="text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-600 mb-1">
              Sem veículos no momento
            </p>
            <p className="text-xs text-slate-400 leading-relaxed max-w-[220px]">
              Esta concessionária ainda não publicou veículos. Volte em breve!
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {vehicles.map((v) => (
              <VehicleCard key={v.id} vehicle={v} />
            ))}
          </div>
        )}
      </div>

      {/* CTA fixo no rodapé */}
      <div className="p-4 border-t border-slate-100 bg-white">
        <Link
          href={`/catalogo/${pin.tenant.id}`}
          className="flex items-center justify-center gap-2 w-full bg-blue-600 text-white
                     text-sm font-semibold py-3 rounded-xl hover:bg-blue-700 transition-colors"
        >
          Ver catálogo completo
          <ChevronRight size={16} />
        </Link>
      </div>
    </div>
  );
}

/* ── Main Sidebar component ──────────────────────────────── */

const BR_STATES = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA',
  'MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN',
  'RO','RR','RS','SC','SE','SP','TO',
];

interface SidebarProps {
  pins: DealershipPin[];
  loading: boolean;
  selected: DealershipPin | null;
  onSelect: (pin: DealershipPin | null) => void;
}

export default function Sidebar({ pins, loading, selected, onSelect }: SidebarProps) {
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return pins.filter((p) => {
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.tenant.tradeName.toLowerCase().includes(q) ||
        (p.city ?? '').toLowerCase().includes(q);
      const matchState = !stateFilter || p.state === stateFilter;
      return matchSearch && matchState;
    });
  }, [pins, search, stateFilter]);

  // Modo detalhe
  if (selected) {
    return <DealerDetail pin={selected} onBack={() => onSelect(null)} />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Barra de busca */}
      <div className="p-4 space-y-2.5 border-b border-slate-100 bg-white">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar concessionária, cidade…"
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-slate-50
                       text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       focus:bg-white transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Linha de filtros */}
        <div className="flex items-center gap-2">
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="flex-1 py-2 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm
                       outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       text-slate-700 cursor-pointer"
          >
            <option value="">Todos os estados</option>
            {BR_STATES.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors
              ${showFilters
                ? 'border-blue-400 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
              }`}
          >
            <Filter size={14} />
            Filtros
          </button>
        </div>

        {/* Filtros extras (expansível) */}
        {showFilters && (
          <div className="pt-1 space-y-2 border-t border-slate-100">
            <p className="text-xs text-slate-500 font-medium">Mostrar apenas:</p>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                onChange={(e) => {
                  // futuro: filtrar só com veículos
                  void e;
                }}
              />
              Com veículos disponíveis
            </label>
          </div>
        )}
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          // Skeleton
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border border-slate-100 animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-slate-200 rounded w-2/3" />
                  <div className="h-3 bg-slate-200 rounded w-1/2" />
                  <div className="h-3 bg-slate-200 rounded w-1/3" />
                </div>
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center px-4">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
              <Search size={22} className="text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-600 mb-1">
              {pins.length === 0 ? 'Nenhuma concessionária ainda' : 'Nenhum resultado'}
            </p>
            <p className="text-xs text-slate-400 leading-relaxed">
              {pins.length === 0
                ? 'Seja o primeiro a cadastrar!'
                : 'Tente outro nome ou estado.'}
            </p>
            {pins.length === 0 && (
              <Link
                href="/signup"
                className="mt-4 text-sm bg-blue-600 text-white px-5 py-2 rounded-xl hover:bg-blue-700 transition font-medium"
              >
                Cadastrar concessionária
              </Link>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-400 font-medium px-1 pb-1">
              {filtered.length} concessionária{filtered.length !== 1 ? 's' : ''}
              {stateFilter && ` em ${stateFilter}`}
              {search && ` para "${search}"`}
            </p>
            {filtered.map((pin) => (
              <DealerCard
                key={pin.id}
                pin={pin}
                selected={false}
                onClick={() => onSelect(pin)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
