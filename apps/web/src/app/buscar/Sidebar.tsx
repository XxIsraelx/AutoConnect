'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search, MapPin, Phone, Mail, Car, ChevronRight,
  ArrowLeft, Building2, SlidersHorizontal, X,
  LocateFixed, Loader2, Navigation, ExternalLink,
  Share2, Check, Map as MapIcon,
  Heart, Bell, GitCompare, ArrowUpDown, Bookmark,
  BookmarkPlus, Trash2, Clock, ChevronDown,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import CompareDrawer from './CompareDrawer';
import { getOpenStatus, getOpenHoursList } from '@/lib/businessHours';
import { getVisited, markVisited } from './visited';
import type { DealershipPin, PublicVehicle, VehiclesPage, PublicBrand, SavedSearch } from './types';

/* ── Helpers ─────────────────────────────────────────────── */

function formatPrice(v: string | null | undefined) {
  if (!v) return '–';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(parseFloat(v));
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km: number) {
  if (km < 1)  return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** Abre Google Maps com rota ou busca de endereço.
 *  Se `origin` for fornecido, a rota já parte da localização do usuário. */
export function directionsUrl(
  pin: DealershipPin,
  origin?: { lat: number; lng: number } | null,
) {
  if (pin.latitude && pin.longitude) {
    const base = `https://www.google.com/maps/dir/?api=1&destination=${pin.latitude},${pin.longitude}`;
    return origin ? `${base}&origin=${origin.lat},${origin.lng}` : base;
  }
  const addr = [pin.addressLine, pin.city, pin.state].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr || pin.name)}`;
}

const condMap: Record<string, { label: string; cls: string }> = {
  new:      { label: '0 km',     cls: 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30' },
  semi_new: { label: 'Seminovo', cls: 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30' },
  used:     { label: 'Usado',    cls: 'bg-white/10 text-slate-400 ring-1 ring-white/10' },
  demo:     { label: 'Demo',     cls: 'bg-violet-500/20 text-violet-400 ring-1 ring-violet-500/30' },
};

const RADIUS_OPTIONS = [
  { label: '10 km',  km: 10 },
  { label: '25 km',  km: 25 },
  { label: '50 km',  km: 50 },
  { label: '100 km', km: 100 },
  { label: 'Todos',  km: null },
] as const;

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

/* ── Vehicle search result ───────────────────────────────── */

function VehicleSearchResult({
  v, dealerName, onClick,
  isFav, onToggleFav, inCompare, onToggleCompare, compareDisabled, onAlert,
}: {
  v: PublicVehicle;
  dealerName: string | undefined;
  onClick: () => void;
  isFav: boolean;
  onToggleFav: () => void;
  inCompare: boolean;
  onToggleCompare: () => void;
  compareDisabled: boolean;
  onAlert: () => void;
}) {
  const cond  = condMap[v.condition] ?? condMap.used;
  const cover = v.images[0]?.url;
  const price = v.promoPrice ?? v.price;
  const promo = !!v.promoPrice;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      onClick={onClick}
      className={`w-full text-left group flex gap-3 p-3 rounded-xl border bg-white/[.03] cursor-pointer transition-all
        ${inCompare ? 'border-blue-500/60 bg-blue-500/[.08]' : 'border-white/[.06] hover:border-blue-500/40 hover:bg-blue-500/[.06]'}`}
    >
      <div className="w-20 h-16 rounded-lg bg-white/10 shrink-0 overflow-hidden flex items-center justify-center relative">
        {cover
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={cover} alt="" className="w-full h-full object-cover" />
          : <Car size={18} className="text-white/20" />}
        {/* Favoritar */}
        <button
          onClick={(e) => { stop(e); onToggleFav(); }}
          title={isFav ? 'Remover favorito' : 'Favoritar'}
          className={`absolute top-1 left-1 w-6 h-6 rounded-full flex items-center justify-center backdrop-blur
            ${isFav ? 'bg-rose-500 text-white' : 'bg-black/50 text-white/80 hover:bg-black/70'}`}
        >
          <Heart size={12} className={isFav ? 'fill-white' : ''} />
        </button>
      </div>

      <div className="flex-1 min-w-0">
        {dealerName && (
          <p className="text-[11px] text-slate-500 truncate flex items-center gap-1">
            <Building2 size={9} className="shrink-0" />
            {dealerName}
          </p>
        )}
        <p className="text-[11px] text-slate-500 uppercase tracking-wide truncate mt-px">
          {v.brand.name} · {v.model.name}
        </p>
        <p className="text-sm font-bold text-white truncate leading-snug mt-0.5">
          {v.versionName ?? String(v.yearModel)}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`text-[10px] font-bold px-1.5 py-px rounded-full ${cond.cls}`}>
            {cond.label}
          </span>
          <span className="text-[10px] text-slate-500">{v.mileageKm.toLocaleString('pt-BR')} km</span>
          <p className={`text-xs font-extrabold ${promo ? 'text-rose-400' : 'text-blue-400'}`}>
            {formatPrice(price)}
          </p>
        </div>

        {/* Ações */}
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={(e) => { stop(e); onToggleCompare(); }}
            disabled={compareDisabled}
            className={`flex items-center gap-1 text-[10px] font-semibold transition-colors disabled:opacity-30
              ${inCompare ? 'text-blue-400' : 'text-slate-500 hover:text-blue-400'}`}
          >
            {inCompare ? <Check size={11} /> : <GitCompare size={11} />}
            {inCompare ? 'Comparando' : 'Comparar'}
          </button>
          <button
            onClick={(e) => { stop(e); onAlert(); }}
            className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-amber-400 transition-colors"
          >
            <Bell size={11} /> Alerta
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Modal de alerta de preço ────────────────────────────── */

function AlertModal({
  vehicle, token, onClose,
}: { vehicle: PublicVehicle; token: string | null; onClose: () => void }) {
  const current = Number(vehicle.promoPrice ?? vehicle.price);
  const [target, setTarget] = useState(String(Math.round(current * 0.9)));
  const [saving, setSaving] = useState(false);
  const [done, setDone]     = useState(false);

  async function submit() {
    if (!token) { window.location.href = '/entrar'; return; }
    setSaving(true);
    try {
      await api('/catalog/price-alerts', {
        method: 'POST', token,
        body: { vehicleId: vehicle.id, targetPrice: Number(target) },
      });
      setDone(true);
      setTimeout(onClose, 1400);
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
         onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="w-full max-w-sm bg-[#1e293b] border border-white/[.08] rounded-2xl p-5 shadow-2xl">
        {done ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
              <Check size={22} className="text-emerald-400" />
            </div>
            <p className="text-sm font-bold text-white">Alerta criado!</p>
            <p className="text-xs text-slate-500 mt-1">Avisaremos quando o preço baixar.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <Bell size={16} className="text-amber-400" />
              <h3 className="text-sm font-bold text-white">Alerta de preço</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {vehicle.brand.name} {vehicle.model.name} · hoje a{' '}
              <span className="text-blue-400 font-bold">{formatPrice(vehicle.promoPrice ?? vehicle.price)}</span>
            </p>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1.5">
              Avise-me quando baixar para
            </label>
            <div className="relative mb-4">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">R$</span>
              <input
                type="number" inputMode="numeric" value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[#0f172a] border border-white/[.08]
                           text-sm text-white outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={onClose}
                className="flex-1 py-2.5 text-sm font-medium text-slate-400 border border-white/[.08] rounded-xl hover:bg-white/[.04]">
                Cancelar
              </button>
              <button onClick={submit} disabled={saving || !target}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold text-white
                           bg-amber-600 rounded-xl hover:bg-amber-500 transition disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Bell size={14} />}
                Criar alerta
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Status de funcionamento (badge) ─────────────────────── */

function OpenBadge({ businessHours, className = '' }: { businessHours: unknown; className?: string }) {
  const status = getOpenStatus(businessHours);
  if (status.state === 'unknown') return null;
  const open = status.state === 'open';
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${open ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      <span className={open ? 'text-emerald-400' : 'text-amber-400/90'}>
        {open ? 'Aberto' : 'Fechado'}
      </span>
      <span className="text-slate-500 font-medium">· {status.label}</span>
    </span>
  );
}

/* ── Horário de funcionamento (acordeão) ─────────────────── */

function HoursAccordion({ hoursList }: {
  hoursList: { label: string; hours: string; closed: boolean; today: boolean }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const today = hoursList.find((d) => d.today);

  return (
    <div className="pt-0.5">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2.5 w-full group"
      >
        <div className="w-6 h-6 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
          <Clock size={12} className="text-blue-400" />
        </div>
        <span className="flex-1 min-w-0 flex items-center justify-between text-xs text-slate-400
                         group-hover:text-blue-400 transition-colors">
          <span>
            Hoje · <span className={today?.closed ? 'text-slate-600' : 'text-white font-semibold'}>
              {today?.hours ?? '—'}
            </span>
          </span>
          <ChevronDown size={13} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {expanded && (
        <div className="mt-1.5 ml-[34px]">
          {hoursList.map((d) => (
            <div key={d.label}
                 className={`flex items-center justify-between text-xs py-0.5
                   ${d.today ? 'text-white font-semibold' : 'text-slate-400'}`}>
              <span className="flex items-center gap-1.5">
                {d.label}
                {d.today && <span className="text-[9px] text-blue-400 font-bold uppercase">hoje</span>}
              </span>
              <span className={d.closed ? 'text-slate-600' : ''}>{d.hours}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Avatar da concessionária (logo ou iniciais) ─────────── */

function DealerAvatar({ pin, size = 44 }: { pin: DealershipPin; size?: number }) {
  const initials = pin.tenant.tradeName.slice(0, 2).toUpperCase();
  const logo = pin.tenant.logoUrl;
  const radius = size >= 56 ? 'rounded-2xl' : 'rounded-xl';
  return (
    <div
      className={`${radius} bg-gradient-to-br from-blue-500 to-blue-700 ring-1 ring-white/15
                  flex items-center justify-center shrink-0 overflow-hidden`}
      style={{ width: size, height: size }}
    >
      {logo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={logo} alt="" className="w-full h-full object-cover" />
        : <span className="text-white font-extrabold tracking-tight"
                style={{ fontSize: size >= 56 ? 18 : 14 }}>{initials}</span>}
    </div>
  );
}

/* ── Dealer card ─────────────────────────────────────────── */

function DealerCard({
  pin, dist, onClick, onRoute, visited,
}: {
  pin: DealershipPin; dist: number | null; onClick: () => void;
  onRoute?: (pin: DealershipPin) => void; visited?: boolean;
}) {
  const hasCoords = pin.latitude !== null;

  return (
    <div className="relative group dealer-card-in">
      <button
        onClick={onClick}
        className="w-full text-left p-4 rounded-2xl border border-white/[.07]
                   bg-gradient-to-b from-[#1e293b] to-[#1a2438]
                   hover:border-blue-500/50 hover:-translate-y-0.5
                   hover:shadow-[0_0_0_1px_rgba(59,130,246,0.25),0_8px_28px_rgba(59,130,246,0.12)]
                   transition-all duration-200"
      >
        <div className="flex items-start gap-3">
          <div className="group-hover:shadow-[0_0_0_3px_rgba(59,130,246,.25)] group-hover:scale-105
                          transition-all rounded-xl shrink-0">
            <DealerAvatar pin={pin} size={44} />
          </div>
          <div className="flex-1 min-w-0 pr-8">
            <div className="flex items-center gap-1.5">
              <p className="font-bold text-white text-sm leading-snug truncate
                            group-hover:text-blue-400 transition-colors">
                {pin.tenant.tradeName}
              </p>
              {visited && (
                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide
                                 text-slate-400 bg-white/[.07] border border-white/[.08]
                                 px-1.5 py-px rounded-full">
                  Visitado
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 truncate mt-0.5">{pin.name}</p>
            {(pin.city || pin.state) && (
              <div className="flex items-center gap-1 mt-1.5">
                <MapPin size={11} className="text-slate-600 shrink-0" />
                <span className="text-xs text-slate-500">
                  {[pin.city, pin.state].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
            <OpenBadge businessHours={pin.businessHours} className="mt-1.5" />
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0 absolute right-4 top-4">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full
              ${pin.vehiclesCount > 0
                ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30'
                : 'bg-white/[.06] text-slate-500 ring-1 ring-white/10'}`}>
              {pin.vehiclesCount} veíc.
            </span>
            {dist !== null && (
              <span className="flex items-center gap-0.5 text-[11px] font-semibold text-emerald-400">
                <Navigation size={9} />
                {formatDistance(dist)}
              </span>
            )}
            {!hasCoords && (
              <span className="text-[10px] text-amber-500/70 font-medium">sem mapa</span>
            )}
          </div>
        </div>
      </button>

      {/* Botão "Como chegar" — aparece no hover */}
      {hasCoords && (
        <a
          href={directionsUrl(pin)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => {
            e.stopPropagation();
            if (onRoute) { e.preventDefault(); onRoute(pin); }
          }}
          className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100
                     flex items-center gap-1 text-[11px] font-semibold text-slate-500
                     hover:text-blue-400 transition-all"
        >
          <MapIcon size={11} /> Rota
        </a>
      )}
    </div>
  );
}

/* ── Share button ────────────────────────────────────────── */

function ShareButton({ pin }: { pin: DealershipPin }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const url = `${window.location.origin}/buscar?dealer=${pin.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border
                  transition-all
        ${copied
          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
          : 'border-white/[.08] bg-white/[.04] text-slate-400 hover:border-white/20 hover:text-slate-200'}`}
    >
      {copied ? <Check size={12} /> : <Share2 size={12} />}
      {copied ? 'Copiado!' : 'Compartilhar'}
    </button>
  );
}

/* ── Detail view ─────────────────────────────────────────── */

function DealerDetail({
  pin, onBack, onRoute,
  favIds, onToggleFav, compare, onToggleCompare, onAlert, onOpenVehicle,
}: {
  pin: DealershipPin; onBack: () => void;
  onRoute?: (pin: DealershipPin) => void;
  favIds: Set<string>;
  onToggleFav: (v: PublicVehicle) => void;
  compare: PublicVehicle[];
  onToggleCompare: (v: PublicVehicle) => void;
  onAlert: (v: PublicVehicle) => void;
  onOpenVehicle: (v: PublicVehicle) => void;
}) {
  const [vehicles, setVehicles] = useState<PublicVehicle[]>([]);
  const [loadingV, setLoadingV] = useState(true);
  const [total, setTotal]       = useState(0);

  useEffect(() => {
    setLoadingV(true);
    api<VehiclesPage>(`/catalog/vehicles?tenantId=${pin.tenant.id}&limit=8`)
      .then(data => { setVehicles(data.items); setTotal(data.total); })
      .catch(() => setVehicles([]))
      .finally(() => setLoadingV(false));
  }, [pin.tenant.id]);

  const hoursList = getOpenHoursList(pin.businessHours);

  return (
    <div className="flex flex-col h-full bg-[#0f172a]">
      {/* Header */}
      <div className="px-4 pt-4 pb-4 border-b border-white/[.06] sticky top-0 z-10 bg-[#0f172a]">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-500
                     hover:text-blue-400 transition-colors mb-4 group"
        >
          <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
          Todas as concessionárias
        </button>

        <div className="flex items-start gap-3">
          <div className="shadow-lg shadow-blue-900/50 rounded-2xl shrink-0">
            <DealerAvatar pin={pin} size={56} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-extrabold text-white text-[15px] leading-tight">
              {pin.tenant.tradeName}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-snug">{pin.name}</p>
            <OpenBadge businessHours={pin.businessHours} className="mt-1.5" />
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <ShareButton pin={pin} />
              <a
                href={directionsUrl(pin)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => {
                  if (onRoute && pin.latitude !== null) { e.preventDefault(); onRoute(pin); }
                }}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl
                           border border-white/[.08] bg-white/[.04] text-slate-400
                           hover:border-blue-500/50 hover:text-blue-400 transition-all"
              >
                <Navigation size={12} /> Como chegar
              </a>
            </div>
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

        {/* Horário de funcionamento — recolhido por padrão para não roubar
            espaço da lista de veículos (só o estoque tem scroll próprio) */}
        {hoursList && <HoursAccordion hoursList={hoursList} />}
      </div>

      {/* Veículos */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <Car size={11} className="text-blue-500" />
            Estoque disponível
            {!loadingV && total > 0 && (
              <span className="text-blue-500 normal-case font-normal tracking-normal ml-0.5">
                ({total})
              </span>
            )}
          </h3>
          {!loadingV && total > 0 && (
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
            {vehicles.map(v => (
              <VehicleSearchResult
                key={v.id}
                v={v}
                dealerName={undefined}
                onClick={() => onOpenVehicle(v)}
                isFav={favIds.has(v.id)}
                onToggleFav={() => onToggleFav(v)}
                inCompare={compare.some(c => c.id === v.id)}
                onToggleCompare={() => onToggleCompare(v)}
                compareDisabled={compare.length >= 3 && !compare.some(c => c.id === v.id)}
                onAlert={() => onAlert(v)}
              />
            ))}
          </div>
        )}
      </div>

      {/* CTA */}
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
          Ver catálogo completo <ExternalLink size={14} />
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

type SearchMode = 'dealers' | 'vehicles';

interface Props {
  pins:      DealershipPin[];
  loading:   boolean;
  selected:  DealershipPin | null;
  onSelect:  (pin: DealershipPin | null) => void;
  userLocation: { lat: number; lng: number } | null;
  geoLoading:   boolean;
  onLocate:     () => void;
  onMatchingTenantsChange: (ids: Set<string> | null) => void;
  onRadiusChange:          (km: number | null)        => void;
  onRoute?:                (pin: DealershipPin)       => void;
}

export default function Sidebar({
  pins, loading, selected, onSelect,
  userLocation, geoLoading, onLocate,
  onMatchingTenantsChange, onRadiusChange, onRoute,
}: Props) {

  const router = useRouter();

  /* ── Estados ─────────────────────────────────────────────── */
  const [searchMode, setSearchMode]       = useState<SearchMode>('dealers');
  const [search, setSearch]               = useState('');
  const [stateFilter, setStateFilter]     = useState('');
  const [brandFilter, setBrandFilter]     = useState('');
  const [filtersOpen, setFiltersOpen]     = useState(false);
  const [onlyVehicles, setOnlyVehicles]   = useState(false);
  const [radiusKm, setRadiusKm]           = useState<number | null>(null);

  // Busca global de veículos
  const [vehicleQuery, setVehicleQuery]     = useState('');
  const [vehicleResults, setVehicleResults] = useState<PublicVehicle[]>([]);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [vehicleSearched, setVehicleSearched] = useState(false);
  const [vehicleTotal, setVehicleTotal]     = useState(0);
  const [vehicleSkip, setVehicleSkip]       = useState(0);
  const [loadingMore, setLoadingMore]       = useState(false);

  // Filtros de veículo
  const emptyVFilters = {
    minPrice: '', maxPrice: '', minYear: '', maxYear: '', maxKm: '',
    fuel: '', transmission: '', condition: '', category: '', sort: 'recent',
  };
  const [vFilters, setVFilters]   = useState({ ...emptyVFilters });
  const [vFiltersOpen, setVFiltersOpen] = useState(false);

  // Favoritos / comparar / buscas salvas
  const token = useAuthStore((s) => s.token);
  const [favIds, setFavIds]         = useState<Set<string>>(new Set());
  const [compare, setCompare]       = useState<PublicVehicle[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [saved, setSaved]           = useState<SavedSearch[]>([]);
  const [savedOpen, setSavedOpen]   = useState(false);
  const [alertVehicle, setAlertVehicle] = useState<PublicVehicle | null>(null);

  const VEHICLE_PAGE = 12;

  // Marcas disponíveis
  const [brands, setBrands] = useState<PublicBrand[]>([]);

  // Histórico de concessionárias visitadas (localStorage)
  const [visited, setVisited] = useState<Set<string>>(new Set());
  useEffect(() => { setVisited(getVisited()); }, []);

  const handleSelectPin = useCallback((pin: DealershipPin) => {
    markVisited(pin.id);
    setVisited((prev) => new Set(prev).add(pin.id));
    onSelect(pin);
  }, [onSelect]);

  /* ── Carrega marcas ──────────────────────────────────────── */
  useEffect(() => {
    api<PublicBrand[]>('/catalog/brands').then(setBrands).catch(() => {});
  }, []);

  /* ── Carrega favoritos + buscas salvas (se logado) ───────── */
  const loadSaved = useCallback(() => {
    if (!token) return;
    api<SavedSearch[]>('/catalog/saved-searches', { token }).then(setSaved).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) { setFavIds(new Set()); setSaved([]); return; }
    api<string[]>('/catalog/favorites/ids', { token })
      .then((ids) => setFavIds(new Set(ids))).catch(() => {});
    loadSaved();
  }, [token, loadSaved]);

  /* ── Conta filtros de veículo ativos ─────────────────────── */
  const vActiveFilters = useMemo(() =>
    (['minPrice','maxPrice','minYear','maxYear','maxKm','fuel','transmission','condition','category'] as const)
      .filter((k) => vFilters[k] !== '').length,
  [vFilters]);

  /* ── Monta query string da busca de veículos ─────────────── */
  const buildVehicleParams = useCallback((skip: number) => {
    const p = new URLSearchParams({ limit: String(VEHICLE_PAGE), skip: String(skip) });
    if (vehicleQuery.trim().length >= 2) p.set('q', vehicleQuery.trim());
    for (const [k, val] of Object.entries(vFilters)) {
      if (val && !(k === 'sort' && val === 'recent')) p.set(k, val);
    }
    return p.toString();
  }, [vehicleQuery, vFilters]);

  /* ── Favoritar ───────────────────────────────────────────── */
  function toggleFav(v: PublicVehicle) {
    if (!token) { window.location.href = '/entrar'; return; }
    const isFav = favIds.has(v.id);
    setFavIds((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(v.id); else next.add(v.id);
      return next;
    });
    api(`/catalog/favorites/${v.id}`, { method: isFav ? 'DELETE' : 'POST', token }).catch(() => {});
  }

  /* ── Comparar ────────────────────────────────────────────── */
  function toggleCompare(v: PublicVehicle) {
    setCompare((prev) => {
      if (prev.some((x) => x.id === v.id)) return prev.filter((x) => x.id !== v.id);
      if (prev.length >= 3) return prev;
      return [...prev, v];
    });
  }

  /* ── Filtro por marca: busca tenantIds com essa marca ─────── */
  const brandFilterActive = brandFilter !== '';
  useEffect(() => {
    if (searchMode !== 'dealers' || !brandFilter) {
      if (!brandFilter) onMatchingTenantsChange(null);
      return;
    }
    api<VehiclesPage>(`/catalog/vehicles?brandId=${brandFilter}&limit=200`)
      .then(data => {
        const ids = new Set(data.items.map(v => v.tenantId));
        onMatchingTenantsChange(ids);
      })
      .catch(() => onMatchingTenantsChange(null));
  }, [brandFilter, searchMode, onMatchingTenantsChange]);

  /* ── Notifica raio para o MapClient ──────────────────────── */
  useEffect(() => {
    onRadiusChange(userLocation ? radiusKm : null);
  }, [radiusKm, userLocation, onRadiusChange]);

  /* ── Zera raio quando GPS é removido ────────────────────── */
  useEffect(() => {
    if (!userLocation) setRadiusKm(null);
  }, [userLocation]);

  /* ── Busca de veículos: query + filtros, com debounce ────── */
  const hasVehicleCriteria = vehicleQuery.trim().length >= 2 || vActiveFilters > 0;

  useEffect(() => {
    if (searchMode !== 'vehicles') return;
    if (!hasVehicleCriteria) {
      setVehicleResults([]);
      setVehicleSearched(false);
      setVehicleTotal(0);
      setVehicleSkip(0);
      onMatchingTenantsChange(null);
      return;
    }
    const timer = setTimeout(() => {
      setVehicleLoading(true);
      api<VehiclesPage>(`/catalog/vehicles?${buildVehicleParams(0)}`)
        .then(data => {
          setVehicleResults(data.items);
          setVehicleTotal(data.total);
          setVehicleSkip(data.items.length);
          setVehicleSearched(true);
          const ids = new Set(data.items.map(v => v.tenantId));
          onMatchingTenantsChange(ids);
        })
        .catch(() => { setVehicleResults([]); setVehicleTotal(0); onMatchingTenantsChange(null); })
        .finally(() => setVehicleLoading(false));
    }, 350);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleQuery, vFilters, searchMode, hasVehicleCriteria]);

  /* ── Carregar mais (scroll infinito) ─────────────────────── */
  const loadMoreVehicles = useCallback(() => {
    if (loadingMore || vehicleResults.length >= vehicleTotal) return;
    setLoadingMore(true);
    api<VehiclesPage>(`/catalog/vehicles?${buildVehicleParams(vehicleSkip)}`)
      .then(data => {
        const combined = [...vehicleResults, ...data.items];
        setVehicleResults(combined);
        setVehicleSkip(prev => prev + data.items.length);
        onMatchingTenantsChange(new Set(combined.map(v => v.tenantId)));
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [loadingMore, vehicleResults, vehicleTotal, vehicleSkip, buildVehicleParams, onMatchingTenantsChange]);

  /* ── Salvar busca atual ──────────────────────────────────── */
  async function saveCurrentSearch() {
    if (!token) { window.location.href = '/entrar'; return; }
    const filters: Record<string, string> = {};
    if (vehicleQuery.trim().length >= 2) filters.q = vehicleQuery.trim();
    for (const [k, val] of Object.entries(vFilters)) {
      if (val && !(k === 'sort' && val === 'recent')) filters[k] = val;
    }
    const name = vehicleQuery.trim() || [
      vFilters.category, vFilters.fuel,
      vFilters.maxPrice ? `até ${Number(vFilters.maxPrice).toLocaleString('pt-BR')}` : '',
    ].filter(Boolean).join(' ') || 'Minha busca';
    await api('/catalog/saved-searches', { method: 'POST', token, body: { name, filters } }).catch(() => {});
    loadSaved();
  }

  function applySavedSearch(s: SavedSearch) {
    const f = { ...emptyVFilters };
    let q = '';
    for (const [k, val] of Object.entries(s.filters)) {
      if (k === 'q') q = String(val);
      else if (k in f) (f as Record<string, string>)[k] = String(val);
    }
    setVehicleQuery(q);
    setVFilters(f);
    setSavedOpen(false);
    setVFiltersOpen(true);
    if (token) api(`/catalog/saved-searches/${s.id}/viewed`, { method: 'PATCH', token }).then(loadSaved).catch(() => {});
  }

  async function deleteSavedSearch(id: string) {
    if (!token) return;
    setSaved(prev => prev.filter(s => s.id !== id));
    await api(`/catalog/saved-searches/${id}`, { method: 'DELETE', token }).catch(() => {});
  }

  /* ── Resetar ao mudar de modo ────────────────────────────── */
  useEffect(() => {
    if (searchMode === 'dealers') {
      setVehicleResults([]);
      setVehicleQuery('');
      setVehicleSearched(false);
      if (!brandFilterActive) onMatchingTenantsChange(null);
    }
    if (searchMode === 'vehicles') {
      setBrandFilter('');
      onMatchingTenantsChange(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchMode]);

  /* ── Lista filtrada + distâncias ─────────────────────────── */
  const filteredWithDist = useMemo(() => {
    const q = search.toLowerCase();
    const withDist = pins.map(p => {
      const dist =
        userLocation && p.latitude !== null && p.longitude !== null
          ? haversineKm(userLocation.lat, userLocation.lng, p.latitude, p.longitude)
          : null;
      return { ...p, dist };
    });

    const filtered = withDist.filter(p => {
      const matchQ  = !q
        || p.name.toLowerCase().includes(q)
        || p.tenant.tradeName.toLowerCase().includes(q)
        || (p.city ?? '').toLowerCase().includes(q);
      const matchSt = !stateFilter || p.state === stateFilter;
      const matchV  = !onlyVehicles || p.vehiclesCount > 0;
      const matchR  = radiusKm === null || p.dist === null || p.dist <= radiusKm;
      return matchQ && matchSt && matchV && matchR;
    });

    if (userLocation) filtered.sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
    return filtered;
  }, [pins, search, stateFilter, onlyVehicles, radiusKm, userLocation]);

  const tenantNames = useMemo(() => {
    const m = new Map<string, string>();
    pins.forEach(p => m.set(p.tenant.id, p.tenant.tradeName));
    return m;
  }, [pins]);

  const activeFilters = (stateFilter ? 1 : 0) + (onlyVehicles ? 1 : 0) + (brandFilter ? 1 : 0);

  const handleRadiusChange = useCallback((km: number | null) => {
    setRadiusKm(km);
  }, []);

  /* ── Overlays compartilhados (lista + detalhe da loja) ───── */
  const overlays = (
    <>
      {/* Barra de comparação flutuante */}
      {compare.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-30 p-3 border-t border-white/[.08]
                        bg-[#0f172a]/95 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {compare.slice(0, 3).map(v => (
                <div key={v.id} className="w-8 h-8 rounded-lg border-2 border-[#0f172a] overflow-hidden bg-white/10">
                  {v.images[0]?.url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={v.images[0].url} alt="" className="w-full h-full object-cover" />
                    : <Car size={12} className="text-white/30 m-auto mt-2" />}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 flex-1">
              {compare.length}/3 para comparar
            </p>
            <button onClick={() => setCompare([])}
              className="text-[11px] text-slate-500 hover:text-rose-400 transition">Limpar</button>
            <button
              onClick={() => setCompareOpen(true)}
              disabled={compare.length < 2}
              className="flex items-center gap-1.5 bg-blue-600 text-white text-xs font-bold px-3 py-2 rounded-xl
                         hover:bg-blue-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <GitCompare size={13} /> Comparar
            </button>
          </div>
        </div>
      )}

      <CompareDrawer
        vehicles={compare}
        dealerNames={tenantNames}
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        onRemove={(id) => setCompare(prev => prev.filter(v => v.id !== id))}
      />

      {alertVehicle && (
        <AlertModal vehicle={alertVehicle} token={token} onClose={() => setAlertVehicle(null)} />
      )}
    </>
  );

  if (selected) return (
    <div className="relative h-full">
      <DealerDetail
        pin={selected}
        onBack={() => onSelect(null)}
        onRoute={onRoute}
        favIds={favIds}
        onToggleFav={toggleFav}
        compare={compare}
        onToggleCompare={toggleCompare}
        onAlert={setAlertVehicle}
        onOpenVehicle={(v) => router.push(`/catalogo/${selected.tenant.id}?v=${v.id}`)}
      />
      {overlays}
    </div>
  );

  return (
    <div className="relative flex flex-col h-full bg-[#0f172a]">

      {/* ── Cabeçalho fixo ───────────────────────────── */}
      <div className="px-4 pt-4 pb-3 space-y-3 border-b border-white/[.06]">

        {/* Título + botão GPS */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-extrabold text-white">
              Encontre uma concessionária
            </h1>
            {!loading && (
              <p className="text-xs text-slate-500 mt-0.5">
                {pins.length} cadastrada{pins.length !== 1 ? 's' : ''} no AutoConnect
              </p>
            )}
          </div>
          <button
            onClick={onLocate}
            disabled={geoLoading}
            title={userLocation ? 'Desativar localização' : 'Usar minha localização'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold
                        border transition-all shrink-0 disabled:cursor-not-allowed
              ${userLocation
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                : 'border-white/[.08] bg-[#1e293b] text-slate-400 hover:border-blue-500/50 hover:text-blue-400 hover:bg-blue-500/[.06]'}`}
          >
            {geoLoading
              ? <Loader2 size={12} className="animate-spin" />
              : <LocateFixed size={12} />}
            {userLocation ? 'Perto de mim' : 'Localizar'}
          </button>
        </div>

        {/* Filtro por raio — só aparece com GPS ativo */}
        {userLocation && (
          <div className="flex gap-1 flex-wrap">
            {RADIUS_OPTIONS.map(({ label, km }) => (
              <button
                key={label}
                onClick={() => handleRadiusChange(km)}
                className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all
                  ${radiusKm === km
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                    : 'border-white/[.07] bg-[#1e293b] text-slate-500 hover:border-white/20 hover:text-slate-300'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Tabs Lojas / Veículos */}
        <div className="flex gap-1 bg-white/[.04] rounded-xl p-0.5">
          {(['dealers', 'vehicles'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setSearchMode(mode)}
              className={`flex-1 flex items-center justify-center gap-1.5
                          text-xs font-semibold py-2 rounded-[10px] transition-all
                ${searchMode === mode
                  ? 'bg-white/[.08] text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'}`}
            >
              {mode === 'dealers' ? <><Building2 size={11}/> Lojas</> : <><Car size={11}/> Veículos</>}
            </button>
          ))}
        </div>

        {/* ── Modo LOJAS ──────────────────────────────── */}
        {searchMode === 'dealers' && (
          <>
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
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <select
                value={stateFilter}
                onChange={e => setStateFilter(e.target.value)}
                style={{ colorScheme: 'dark' }}
                className="flex-1 py-2 px-3 rounded-xl bg-[#1e293b] border border-transparent
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

            {filtersOpen && (
              <div className="pt-1 pb-0.5 px-1 space-y-3 border-t border-white/[.06]">
                {/* Filtro por marca */}
                {brands.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Marca
                    </p>
                    <select
                      value={brandFilter}
                      onChange={e => setBrandFilter(e.target.value)}
                      style={{ colorScheme: 'dark' }}
                      className="w-full py-2 px-3 rounded-xl bg-[#0f172a] border border-white/[.07]
                                 text-sm text-slate-300 cursor-pointer
                                 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20
                                 transition-all"
                    >
                      <option value="">Todas as marcas</option>
                      {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}

                {/* Só com veículos */}
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
          </>
        )}

        {/* ── Modo VEÍCULOS ────────────────────────────── */}
        {searchMode === 'vehicles' && (
          <div className="space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                type="text"
                value={vehicleQuery}
                onChange={e => setVehicleQuery(e.target.value)}
                placeholder="Ex: Corolla, HB20, Tracker…"
                autoFocus
                className="w-full pl-9 pr-9 py-2.5 rounded-xl
                           bg-[#1e293b] border border-transparent
                           text-sm text-white placeholder-slate-600
                           outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20
                           transition-all"
              />
              {vehicleQuery && (
                <button
                  onClick={() => setVehicleQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Linha: Filtros · Ordenar · Salvas */}
            <div className="flex gap-2">
              <button
                onClick={() => setVFiltersOpen(o => !o)}
                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all border
                  ${vFiltersOpen || vActiveFilters > 0
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                    : 'border-white/[.07] bg-[#1e293b] text-slate-400 hover:border-white/20'}`}
              >
                <SlidersHorizontal size={14} /> Filtros
                {vActiveFilters > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {vActiveFilters}
                  </span>
                )}
              </button>

              <div className="relative flex-1">
                <ArrowUpDown size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                <select
                  value={vFilters.sort}
                  onChange={e => setVFilters(f => ({ ...f, sort: e.target.value }))}
                  style={{ colorScheme: 'dark' }}
                  className="w-full pl-8 pr-2 py-2 rounded-xl bg-[#1e293b] border border-white/[.07]
                             text-xs text-slate-300 cursor-pointer outline-none focus:border-blue-500"
                >
                  <option value="recent">Mais recentes</option>
                  <option value="price_asc">Menor preço</option>
                  <option value="price_desc">Maior preço</option>
                  <option value="year_desc">Mais novos</option>
                  <option value="km_asc">Menor KM</option>
                </select>
              </div>

              <button
                onClick={() => setSavedOpen(o => !o)}
                title="Buscas salvas"
                className={`relative flex items-center px-3 py-2 rounded-xl border transition-all
                  ${savedOpen ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                              : 'border-white/[.07] bg-[#1e293b] text-slate-400 hover:border-white/20'}`}
              >
                <Bookmark size={14} />
                {saved.some(s => s.newCount > 0) && (
                  <span className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 bg-amber-400 rounded-full" />
                )}
              </button>
            </div>

            {/* Painel de buscas salvas */}
            {savedOpen && (
              <div className="rounded-xl border border-white/[.07] bg-[#0f172a] p-2 space-y-1">
                <div className="flex items-center justify-between px-1 pb-1">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Buscas salvas</p>
                  {hasVehicleCriteria && (
                    <button onClick={saveCurrentSearch}
                      className="flex items-center gap-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300">
                      <BookmarkPlus size={12} /> Salvar atual
                    </button>
                  )}
                </div>
                {!token ? (
                  <p className="text-[11px] text-slate-600 px-1 py-2">Entre para salvar buscas.</p>
                ) : saved.length === 0 ? (
                  <p className="text-[11px] text-slate-600 px-1 py-2">Nenhuma busca salva ainda.</p>
                ) : saved.map(s => (
                  <div key={s.id} className="flex items-center gap-2 group rounded-lg hover:bg-white/[.04] px-2 py-1.5">
                    <button onClick={() => applySavedSearch(s)} className="flex-1 min-w-0 text-left">
                      <p className="text-xs font-semibold text-slate-300 truncate">{s.name}</p>
                    </button>
                    {s.newCount > 0 && (
                      <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full shrink-0">
                        {s.newCount} novo{s.newCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    <button onClick={() => deleteSavedSearch(s.id)}
                      className="text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition shrink-0">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Painel de filtros */}
            {vFiltersOpen && (
              <div className="rounded-xl border border-white/[.07] bg-[#0f172a] p-3 space-y-3">
                {/* Preço */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Preço mín.</p>
                    <input type="number" inputMode="numeric" placeholder="R$ 0" value={vFilters.minPrice}
                      onChange={e => setVFilters(f => ({ ...f, minPrice: e.target.value }))}
                      className="w-full py-1.5 px-2 rounded-lg bg-[#1e293b] border border-white/[.07] text-xs text-white outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Preço máx.</p>
                    <input type="number" inputMode="numeric" placeholder="sem limite" value={vFilters.maxPrice}
                      onChange={e => setVFilters(f => ({ ...f, maxPrice: e.target.value }))}
                      className="w-full py-1.5 px-2 rounded-lg bg-[#1e293b] border border-white/[.07] text-xs text-white outline-none focus:border-blue-500" />
                  </div>
                </div>
                {/* Slider de preço máximo */}
                <div>
                  <input type="range" min={0} max={400000} step={5000}
                    value={vFilters.maxPrice || 400000}
                    onChange={e => setVFilters(f => ({ ...f, maxPrice: e.target.value === '400000' ? '' : e.target.value }))}
                    className="w-full accent-blue-500" />
                  <p className="text-[10px] text-slate-500 text-right">
                    {vFilters.maxPrice ? `até R$ ${Number(vFilters.maxPrice).toLocaleString('pt-BR')}` : 'qualquer valor'}
                  </p>
                </div>
                {/* Ano + KM */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Ano mín.</p>
                    <input type="number" inputMode="numeric" placeholder="2010" value={vFilters.minYear}
                      onChange={e => setVFilters(f => ({ ...f, minYear: e.target.value }))}
                      className="w-full py-1.5 px-2 rounded-lg bg-[#1e293b] border border-white/[.07] text-xs text-white outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Ano máx.</p>
                    <input type="number" inputMode="numeric" placeholder="2025" value={vFilters.maxYear}
                      onChange={e => setVFilters(f => ({ ...f, maxYear: e.target.value }))}
                      className="w-full py-1.5 px-2 rounded-lg bg-[#1e293b] border border-white/[.07] text-xs text-white outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">KM máx.</p>
                    <input type="number" inputMode="numeric" placeholder="80000" value={vFilters.maxKm}
                      onChange={e => setVFilters(f => ({ ...f, maxKm: e.target.value }))}
                      className="w-full py-1.5 px-2 rounded-lg bg-[#1e293b] border border-white/[.07] text-xs text-white outline-none focus:border-blue-500" />
                  </div>
                </div>
                {/* Selects */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'category', label: 'Carroceria', opts: [['','Todas'],['SUV','SUV'],['Sedã','Sedã'],['Hatch','Hatch'],['Picape','Picape'],['Minivan','Minivan'],['Furgão','Furgão']] },
                    { key: 'condition', label: 'Condição', opts: [['','Todas'],['new','Novo'],['used','Usado'],['semi_new','Semi-novo']] },
                    { key: 'fuel', label: 'Combustível', opts: [['','Todos'],['flex','Flex'],['gasoline','Gasolina'],['diesel','Diesel'],['hybrid','Híbrido'],['electric','Elétrico'],['ethanol','Etanol'],['gnv','GNV']] },
                    { key: 'transmission', label: 'Câmbio', opts: [['','Todos'],['manual','Manual'],['automatic','Automático'],['cvt','CVT'],['automated_manual','Automatizado']] },
                  ].map(({ key, label, opts }) => (
                    <div key={key}>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">{label}</p>
                      <select value={vFilters[key as keyof typeof vFilters]}
                        onChange={e => setVFilters(f => ({ ...f, [key]: e.target.value }))}
                        style={{ colorScheme: 'dark' }}
                        className="w-full py-1.5 px-2 rounded-lg bg-[#1e293b] border border-white/[.07] text-xs text-slate-300 cursor-pointer outline-none focus:border-blue-500">
                        {opts.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {vActiveFilters > 0 && (
                  <button onClick={() => setVFilters({ ...emptyVFilters, sort: vFilters.sort })}
                    className="w-full text-xs font-semibold text-slate-400 hover:text-white py-1.5 rounded-lg border border-white/[.07] hover:bg-white/[.04] transition">
                    Limpar filtros
                  </button>
                )}
              </div>
            )}

            {/* Chips de filtros ativos */}
            {vActiveFilters > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['category','Carroceria'],['condition','Condição'],['fuel','Combustível'],['transmission','Câmbio'],
                  ['minPrice','≥ R$'],['maxPrice','≤ R$'],['minYear','≥'],['maxYear','≤'],['maxKm','≤ km'],
                ] as const).filter(([k]) => vFilters[k]).map(([k, lbl]) => {
                  const condLabels: Record<string,string> = { new:'Novo', used:'Usado', semi_new:'Semi-novo' };
                  const fuelLabels: Record<string,string> = { flex:'Flex', gasoline:'Gasolina', diesel:'Diesel', hybrid:'Híbrido', electric:'Elétrico', ethanol:'Etanol', gnv:'GNV' };
                  const transLabels: Record<string,string> = { manual:'Manual', automatic:'Automático', cvt:'CVT', automated_manual:'Automatizado' };
                  let val = vFilters[k];
                  if (k === 'condition') val = condLabels[val] ?? val;
                  if (k === 'fuel') val = fuelLabels[val] ?? val;
                  if (k === 'transmission') val = transLabels[val] ?? val;
                  if (k === 'minPrice' || k === 'maxPrice' || k === 'maxKm') val = Number(val).toLocaleString('pt-BR');
                  return (
                    <span key={k} className="flex items-center gap-1 text-[10px] font-semibold bg-blue-500/15 text-blue-300 px-2 py-1 rounded-full">
                      {lbl} {val}
                      <button onClick={() => setVFilters(f => ({ ...f, [k]: '' }))} className="hover:text-white">
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Lista ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">

        {/* ── Resultados VEÍCULOS ─── */}
        {searchMode === 'vehicles' && (
          <>
            {vehicleLoading && (
              <div className="space-y-2.5">{[1,2,3,4].map(i => <VehicleSkeleton key={i} />)}</div>
            )}
            {!vehicleLoading && !hasVehicleCriteria && (
              <div className="flex flex-col items-center py-16 text-center px-4">
                <div className="w-16 h-16 rounded-2xl bg-white/[.04] flex items-center justify-center mb-4">
                  <Car size={28} className="text-white/15" />
                </div>
                <p className="text-sm font-bold text-slate-400 mb-1">Busca global de veículos</p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Digite o modelo, marca ou versão — ou use os filtros — para encontrar em todas as concessionárias.
                </p>
              </div>
            )}
            {!vehicleLoading && vehicleSearched && vehicleResults.length === 0 && (
              <div className="flex flex-col items-center py-16 text-center px-4">
                <div className="w-16 h-16 rounded-2xl bg-white/[.04] flex items-center justify-center mb-4">
                  <Search size={28} className="text-white/15" />
                </div>
                <p className="text-sm font-bold text-slate-400 mb-1">Nenhum veículo encontrado</p>
                <p className="text-xs text-slate-600 leading-relaxed">Tente ajustar a busca ou os filtros.</p>
              </div>
            )}
            {!vehicleLoading && vehicleResults.length > 0 && (
              <>
                <div className="px-1 pb-1">
                  <p className="text-xs text-slate-600 font-medium">
                    {vehicleTotal} resultado{vehicleTotal !== 1 ? 's' : ''}
                    <span className="text-blue-500"> · pins destacados no mapa</span>
                  </p>
                </div>
                {vehicleResults.map(v => (
                  <VehicleSearchResult
                    key={v.id}
                    v={v}
                    dealerName={tenantNames.get(v.tenantId)}
                    onClick={() => {
                      const pin = pins.find(p => p.tenant.id === v.tenantId);
                      if (pin) handleSelectPin(pin);
                    }}
                    isFav={favIds.has(v.id)}
                    onToggleFav={() => toggleFav(v)}
                    inCompare={compare.some(c => c.id === v.id)}
                    onToggleCompare={() => toggleCompare(v)}
                    compareDisabled={compare.length >= 3 && !compare.some(c => c.id === v.id)}
                    onAlert={() => setAlertVehicle(v)}
                  />
                ))}
                {vehicleResults.length < vehicleTotal && (
                  <button
                    onClick={loadMoreVehicles}
                    disabled={loadingMore}
                    className="w-full py-2.5 mt-1 rounded-xl border border-white/[.08] text-xs font-semibold
                               text-slate-400 hover:text-white hover:bg-white/[.04] transition disabled:opacity-50
                               flex items-center justify-center gap-2"
                  >
                    {loadingMore ? <><Loader2 size={13} className="animate-spin" /> Carregando…</>
                                 : `Carregar mais (${vehicleTotal - vehicleResults.length})`}
                  </button>
                )}
              </>
            )}
          </>
        )}

        {/* ── Resultados DEALERS ─── */}
        {searchMode === 'dealers' && (
          <>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)
            ) : filteredWithDist.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center px-4">
                <div className="w-16 h-16 rounded-2xl bg-white/[.04] flex items-center justify-center mb-4">
                  {pins.length === 0
                    ? <Building2 size={28} className="text-white/15" />
                    : <Search size={28}   className="text-white/15" />}
                </div>
                <p className="text-sm font-bold text-slate-400 mb-1">
                  {pins.length === 0 ? 'Nenhuma concessionária por aqui' : 'Sem resultados'}
                </p>
                <p className="text-xs text-slate-600 leading-relaxed mb-4">
                  {pins.length === 0
                    ? 'Em breve novas lojas aparecerão na sua região.'
                    : radiusKm
                    ? `Não há concessionárias em ${radiusKm} km.`
                    : 'Tente outros termos ou remova os filtros.'}
                </p>
                {(stateFilter || onlyVehicles || brandFilter || radiusKm) && (
                  <button
                    onClick={() => { setStateFilter(''); setOnlyVehicles(false); setBrandFilter(''); setRadiusKm(null); }}
                    className="text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="px-1 pb-1 flex items-center justify-between">
                  <p className="text-xs text-slate-600 font-medium">
                    {filteredWithDist.length} resultado{filteredWithDist.length !== 1 ? 's' : ''}
                    {stateFilter && <span className="text-blue-500"> · {stateFilter}</span>}
                    {userLocation && <span className="text-emerald-500"> · por distância</span>}
                    {radiusKm && <span className="text-emerald-500"> · ≤ {radiusKm} km</span>}
                  </p>
                  {(search || stateFilter || onlyVehicles || brandFilter) && (
                    <button
                      onClick={() => { setSearch(''); setStateFilter(''); setOnlyVehicles(false); setBrandFilter(''); }}
                      className="text-[11px] text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors"
                    >
                      <X size={11} /> Limpar
                    </button>
                  )}
                </div>
                {filteredWithDist.map(pin => (
                  <DealerCard
                    key={pin.id}
                    pin={pin}
                    dist={pin.dist}
                    onClick={() => handleSelectPin(pin)}
                    onRoute={onRoute}
                    visited={visited.has(pin.id)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {overlays}

    </div>
  );
}
