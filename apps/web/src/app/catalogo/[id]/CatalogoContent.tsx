'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, MapPin, Phone, Globe, Car, Search, X,
  SlidersHorizontal, ChevronLeft, ChevronRight,
  Navigation, Loader2, ExternalLink,
  Fuel, Gauge, Settings2, DoorOpen,
  Heart, MessageCircle, Calculator, Scale, CalendarPlus,
  CheckSquare, Square, ArrowRight, Check, AlertCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import ChatDrawer from '@/components/ChatDrawer';
import ScheduleModal, { type ScheduleBranch } from '@/components/ScheduleModal';
import type {
  PublicDealer, PublicVehicle, PublicVehicleDetail,
  VehiclesPage, PublicBrand,
} from '../../../app/buscar/types';

/* ── Helpers ─────────────────────────────────────────────── */

function formatPrice(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === '') return '–';
  const num = typeof v === 'string' ? parseFloat(v) : v;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(num);
}

function formatKm(km: number) {
  if (km === 0) return '0 km';
  return `${new Intl.NumberFormat('pt-BR').format(km)} km`;
}

function formatPhone(phone: string) {
  return phone.replace(/\D/g, '');
}

const condMap: Record<string, { label: string; cls: string }> = {
  new:      { label: '0 km',     cls: 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30' },
  semi_new: { label: 'Seminovo', cls: 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30' },
  used:     { label: 'Usado',    cls: 'bg-white/10 text-slate-400 ring-1 ring-white/10' },
  demo:     { label: 'Demo',     cls: 'bg-violet-500/20 text-violet-400 ring-1 ring-violet-500/30' },
};

const fuelLabels: Record<string, string> = {
  gasoline: 'Gasolina', ethanol: 'Etanol', flex: 'Flex',
  diesel: 'Diesel', electric: 'Elétrico', hybrid: 'Híbrido',
};

const transLabels: Record<string, string> = {
  manual: 'Manual', automatic: 'Automático', cvt: 'CVT',
  dct: 'Dupla embreagem', automated: 'Automatizado',
};

const PER_PAGE = 12;

/* ── Financing calc (Tabela PRICE) ────────────────────────
   PMT = PV × [i(1+i)^n] / [(1+i)^n − 1]
──────────────────────────────────────────────────────────── */

function calcPrice(pv: number, ratePerMonth: number, n: number) {
  if (ratePerMonth === 0) return pv / n;
  const x = Math.pow(1 + ratePerMonth, n);
  return (pv * ratePerMonth * x) / (x - 1);
}

/* ── Skeletons ───────────────────────────────────────────── */

function VehicleCardSkeleton() {
  return (
    <div className="rounded-2xl bg-[#1e293b] border border-white/[.06] overflow-hidden animate-pulse">
      <div className="aspect-[4/3] bg-white/10" />
      <div className="p-4 space-y-2.5">
        <div className="h-3 bg-white/10 rounded w-2/3" />
        <div className="h-4 bg-white/10 rounded w-4/5" />
        <div className="h-3 bg-white/10 rounded w-1/2" />
        <div className="h-5 bg-white/10 rounded w-1/3 mt-1" />
      </div>
    </div>
  );
}

/* ── Vehicle card ────────────────────────────────────────── */

interface VehicleCardProps {
  v: PublicVehicle;
  onClick: () => void;
  isFav: boolean;
  onFavToggle: (e: React.MouseEvent) => void;
  isCompared: boolean;
  onCompareToggle: (e: React.MouseEvent) => void;
  compareDisabled: boolean;
}

function VehicleCard({
  v, onClick,
  isFav, onFavToggle,
  isCompared, onCompareToggle, compareDisabled,
}: VehicleCardProps) {
  const cond  = condMap[v.condition] ?? condMap.used;
  const cover = v.images[0]?.url;
  const price = v.promoPrice ?? v.price;
  const promo = !!v.promoPrice;

  return (
    <div className="group relative rounded-2xl bg-[#1e293b] border border-white/[.07]
                    hover:border-blue-500/50 hover:shadow-[0_0_0_1px_rgba(59,130,246,.15),0_8px_32px_rgba(59,130,246,.08)]
                    overflow-hidden transition-all duration-200">

      {/* Foto — clicável */}
      <button onClick={onClick} className="block w-full text-left">
        <div className="aspect-[4/3] bg-[#0f172a] overflow-hidden relative">
          {cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={cover} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
            : (
              <div className="w-full h-full flex items-center justify-center">
                <Car size={40} className="text-white/10" />
              </div>
            )
          }
          <div className="absolute top-2.5 left-2.5">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${cond.cls}`}>
              {cond.label}
            </span>
          </div>
          {promo && (
            <div className="absolute top-2.5 right-2.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/30">
                Oferta
              </span>
            </div>
          )}
        </div>
      </button>

      {/* Ações overlay */}
      <div className="absolute top-2.5 right-2.5 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Favorito */}
        <button
          onClick={onFavToggle}
          title={isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-lg
            ${isFav
              ? 'bg-rose-500 text-white'
              : 'bg-black/60 backdrop-blur-sm text-white/70 hover:bg-rose-500 hover:text-white'}`}
        >
          <Heart size={13} fill={isFav ? 'currentColor' : 'none'} />
        </button>

        {/* Comparar */}
        <button
          onClick={onCompareToggle}
          disabled={compareDisabled && !isCompared}
          title={isCompared ? 'Remover da comparação' : 'Comparar'}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-lg
            ${isCompared
              ? 'bg-amber-500 text-white'
              : compareDisabled
                ? 'bg-black/60 backdrop-blur-sm text-white/20 cursor-not-allowed'
                : 'bg-black/60 backdrop-blur-sm text-white/70 hover:bg-amber-500 hover:text-white'}`}
        >
          <Scale size={13} />
        </button>
      </div>

      {/* Info */}
      <button onClick={onClick} className="block w-full text-left p-4">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide truncate">
          {v.brand.name} · {v.model.name}
        </p>
        <p className="text-sm font-bold text-white truncate leading-snug mt-0.5 group-hover:text-blue-300 transition-colors">
          {v.versionName ?? `${v.yearModel}`}
        </p>
        <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500">
          <span>{v.yearModel}</span>
          {v.mileageKm > 0 && (
            <>
              <span className="text-slate-700">·</span>
              <span>{formatKm(v.mileageKm)}</span>
            </>
          )}
          {v.color && (
            <>
              <span className="text-slate-700">·</span>
              <span className="truncate">{v.color}</span>
            </>
          )}
        </div>
        <p className={`text-base font-extrabold mt-2 ${promo ? 'text-rose-400' : 'text-blue-400'}`}>
          {formatPrice(price)}
          {promo && (
            <span className="ml-1.5 text-xs font-normal text-slate-600 line-through">
              {formatPrice(v.price)}
            </span>
          )}
        </p>
      </button>
    </div>
  );
}

/* ── Financing Calculator ────────────────────────────────── */

function FinancingCalc({ price }: { price: string | null }) {
  const priceNum = price ? parseFloat(price) : 0;
  const [entrada, setEntrada]   = useState(20); // % do valor
  const [parcelas, setParcelas] = useState(48);
  const [taxa, setTaxa]         = useState(1.49); // % ao mês

  const pv  = priceNum * (1 - entrada / 100);
  const pmt = priceNum > 0 ? calcPrice(pv, taxa / 100, parcelas) : 0;
  const total = pmt * parcelas;

  return (
    <div className="rounded-2xl bg-white/[.04] border border-white/[.06] p-4">
      <div className="flex items-center gap-2 mb-4">
        <Calculator size={15} className="text-blue-400" />
        <h4 className="text-sm font-bold text-white">Simulação de financiamento</h4>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        {/* Entrada */}
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Entrada
          </label>
          <div className="flex gap-1 flex-wrap">
            {[0, 10, 20, 30, 40, 50].map(p => (
              <button
                key={p}
                onClick={() => setEntrada(p)}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-all
                  ${entrada === p
                    ? 'border-blue-500/60 bg-blue-500/20 text-blue-300'
                    : 'border-white/[.07] text-slate-500 hover:border-white/20'}`}
              >
                {p}%
              </button>
            ))}
          </div>
        </div>

        {/* Parcelas */}
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Parcelas
          </label>
          <div className="flex gap-1 flex-wrap">
            {[12, 24, 36, 48, 60].map(n => (
              <button
                key={n}
                onClick={() => setParcelas(n)}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-all
                  ${parcelas === n
                    ? 'border-blue-500/60 bg-blue-500/20 text-blue-300'
                    : 'border-white/[.07] text-slate-500 hover:border-white/20'}`}
              >
                {n}x
              </button>
            ))}
          </div>
        </div>

        {/* Taxa */}
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Taxa a.m.
          </label>
          <div className="flex gap-1 flex-wrap">
            {[0.99, 1.49, 1.99, 2.49].map(t => (
              <button
                key={t}
                onClick={() => setTaxa(t)}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-all
                  ${taxa === t
                    ? 'border-blue-500/60 bg-blue-500/20 text-blue-300'
                    : 'border-white/[.07] text-slate-500 hover:border-white/20'}`}
              >
                {t}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {priceNum > 0 && (
        <div className="grid grid-cols-3 gap-3 pt-3 border-t border-white/[.06]">
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wide">Entrada</p>
            <p className="text-sm font-bold text-white">{formatPrice(priceNum * entrada / 100)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wide">Parcela (PRICE)</p>
            <p className="text-lg font-extrabold text-blue-400">{formatPrice(pmt)}</p>
            <p className="text-[10px] text-slate-500">{parcelas}× de {formatPrice(pmt)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wide">Total financiado</p>
            <p className="text-sm font-bold text-white">{formatPrice(total)}</p>
            <p className="text-[10px] text-rose-500/70">
              +{formatPrice(total - priceNum * (1 - entrada / 100))} em juros
            </p>
          </div>
        </div>
      )}
      <p className="text-[10px] text-slate-600 mt-2">
        * Simulação estimada. Sujeita a análise de crédito e condições da financeira.
      </p>
    </div>
  );
}

/* ── Lead Modal ──────────────────────────────────────────── */

function LeadModal({
  vehicle,
  tenantId,
  onClose,
}: {
  vehicle: PublicVehicleDetail;
  tenantId: string;
  onClose: () => void;
}) {
  const user  = useAuthStore(s => s.user);
  const token = useAuthStore(s => s.token);
  const router = useRouter();

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  if (!user || !token) {
    return (
      <>
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="bg-[#1e293b] border border-white/[.1] rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
            <div className="w-14 h-14 rounded-2xl bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
              <MessageCircle size={28} className="text-blue-400" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Faça login para continuar</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-6">
              Você precisa ter uma conta de cliente para demonstrar interesse em veículos.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => router.push('/entrar')}
                className="w-full bg-blue-600 text-white font-bold py-2.5 rounded-xl
                           hover:bg-blue-500 transition-colors text-sm"
              >
                Entrar na conta
              </button>
              <button
                onClick={() => router.push('/cadastrar')}
                className="w-full border border-white/[.1] text-slate-300 font-semibold py-2.5 rounded-xl
                           hover:bg-white/[.05] transition-colors text-sm"
              >
                Criar conta grátis
              </button>
              <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-400 transition-colors mt-1">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (sent) {
    return (
      <>
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="bg-[#1e293b] border border-white/[.1] rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <Check size={28} className="text-emerald-400" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Interesse enviado!</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-6">
              A concessionária vai entrar em contato em breve pelo e-mail ou telefone cadastrado.
            </p>
            <button
              onClick={onClose}
              className="w-full bg-emerald-600 text-white font-bold py-2.5 rounded-xl
                         hover:bg-emerald-500 transition-colors text-sm"
            >
              Fechar
            </button>
          </div>
        </div>
      </>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api('/leads', {
        method: 'POST',
        token: token!,
        body: JSON.stringify({
          tenantId,
          vehicleId: vehicle.id,
          message: message.trim() || undefined,
          source: 'website',
        }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar. Tente novamente.');
    } finally {
      setSending(false);
    }
  }

  const price = vehicle.promoPrice ?? vehicle.price;
  const label = `${vehicle.brand.name} ${vehicle.model.name} ${vehicle.versionName ?? ''} ${vehicle.yearModel}`.trim();

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="bg-[#1e293b] border border-white/[.1] rounded-2xl shadow-2xl max-w-md w-full">
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-white/[.06]">
            <div>
              <h3 className="text-base font-bold text-white">Tenho interesse</h3>
              <p className="text-xs text-slate-500 truncate max-w-[260px]">{label}</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[.06] transition-all">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Veículo selecionado */}
            <div className="flex items-center justify-between rounded-xl bg-white/[.04] border border-white/[.06] p-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-500 truncate">{vehicle.brand.name} · {vehicle.model.name}</p>
                <p className="text-sm font-bold text-white truncate">{label}</p>
              </div>
              <p className="text-base font-extrabold text-blue-400 shrink-0 ml-3">{formatPrice(price)}</p>
            </div>

            {/* Contato pré-preenchido */}
            <div className="rounded-xl bg-white/[.03] border border-white/[.06] p-3">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Seus dados</p>
              <p className="text-sm font-semibold text-white">{user.fullName}</p>
              <p className="text-xs text-slate-400">{user.email}</p>
            </div>

            {/* Mensagem opcional */}
            <div>
              <label className="text-[11px] font-semibold text-slate-400 block mb-1.5">
                Mensagem (opcional)
              </label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Ex: Tenho interesse em fazer um test drive…"
                rows={3}
                className="w-full rounded-xl bg-[#0f172a] border border-white/[.08] text-sm text-white
                           placeholder-slate-600 px-3 py-2.5 resize-none
                           outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-rose-400 text-xs bg-rose-500/10 rounded-xl px-3 py-2">
                <AlertCircle size={13} /> {error}
              </div>
            )}

            <button
              type="submit"
              disabled={sending}
              className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl
                         hover:bg-blue-500 transition-colors text-sm
                         disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              {sending ? <><Loader2 size={15} className="animate-spin" /> Enviando…</> : 'Confirmar interesse'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

/* ── Comparator Modal ────────────────────────────────────── */

function CompareModal({
  vehicles,
  onClose,
}: {
  vehicles: PublicVehicleDetail[];
  onClose: () => void;
}) {
  const specs = [
    { label: 'Preço',        key: (v: PublicVehicleDetail) => formatPrice(v.promoPrice ?? v.price) },
    { label: 'Condição',     key: (v: PublicVehicleDetail) => condMap[v.condition]?.label ?? v.condition },
    { label: 'Ano',          key: (v: PublicVehicleDetail) => `${v.yearModel}/${v.yearMake}` },
    { label: 'Quilometragem',key: (v: PublicVehicleDetail) => formatKm(v.mileageKm) },
    { label: 'Cor',          key: (v: PublicVehicleDetail) => v.color ?? '–' },
    { label: 'Combustível',  key: (v: PublicVehicleDetail) => v.fuel ? (fuelLabels[v.fuel] ?? v.fuel) : '–' },
    { label: 'Câmbio',       key: (v: PublicVehicleDetail) => v.transmission ? (transLabels[v.transmission] ?? v.transmission) : '–' },
    { label: 'Portas',       key: (v: PublicVehicleDetail) => v.doors ? `${v.doors}` : '–' },
    { label: 'Motor',        key: (v: PublicVehicleDetail) => v.engine ?? '–' },
  ];

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="bg-[#0f172a] border border-white/[.1] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[.06] shrink-0">
            <div className="flex items-center gap-2">
              <Scale size={16} className="text-amber-400" />
              <h3 className="text-base font-bold text-white">Comparar veículos</h3>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[.06] transition-all">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            {/* Fotos + nomes */}
            <div className={`grid gap-0 border-b border-white/[.06]`}
                 style={{ gridTemplateColumns: `180px repeat(${vehicles.length}, 1fr)` }}>
              <div className="p-4 bg-[#1e293b]/50" />
              {vehicles.map(v => (
                <div key={v.id} className="p-4 border-l border-white/[.04]">
                  <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[#1e293b] mb-3">
                    {v.images[0]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={v.images[0].url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center"><Car size={32} className="text-white/10" /></div>
                    }
                  </div>
                  <p className="text-[10px] text-slate-500 truncate">{v.brand.name} · {v.model.name}</p>
                  <p className="text-sm font-bold text-white truncate leading-snug">{v.versionName ?? String(v.yearModel)}</p>
                </div>
              ))}
            </div>

            {/* Specs rows */}
            {specs.map((spec, si) => (
              <div key={spec.label}
                   className={`grid gap-0 border-b border-white/[.04] ${si % 2 === 0 ? '' : 'bg-white/[.02]'}`}
                   style={{ gridTemplateColumns: `180px repeat(${vehicles.length}, 1fr)` }}>
                <div className="px-4 py-3 bg-[#1e293b]/30">
                  <p className="text-[11px] font-semibold text-slate-500">{spec.label}</p>
                </div>
                {vehicles.map(v => (
                  <div key={v.id} className="px-4 py-3 border-l border-white/[.04]">
                    <p className="text-sm font-semibold text-white">{spec.key(v)}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Vehicle detail drawer ───────────────────────────────── */

function VehicleDrawer({
  vehicleId,
  tenantId,
  dealerPhone,
  dealerName,
  dealerLogo,
  branches,
  onClose,
  isFav,
  onFavToggle,
}: {
  vehicleId: string;
  tenantId: string;
  dealerPhone: string | null;
  dealerName: string;
  dealerLogo: string | null;
  branches: ScheduleBranch[];
  onClose: () => void;
  isFav: boolean;
  onFavToggle: () => void;
}) {
  const token = useAuthStore(s => s.token);
  const user  = useAuthStore(s => s.user);
  const [vehicle, setVehicle]   = useState<PublicVehicleDetail | null>(null);
  const [loading, setLoading]   = useState(true);
  const [imgIdx, setImgIdx]     = useState(0);
  const [showCalc, setShowCalc] = useState(false);
  const [showLead, setShowLead] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [chatId, setChatId]     = useState<string | null>(null);
  const [startingChat, setStartingChat] = useState(false);

  const canChat = !user || user.role === 'customer';

  async function startChat() {
    if (!token) { window.location.href = '/entrar'; return; }
    setStartingChat(true);
    try {
      const conv = await api<{ id: string }>('/conversations', {
        method: 'POST', token, body: { tenantId, vehicleId },
      });
      setChatId(conv.id);
    } catch { /* ignora */ }
    finally { setStartingChat(false); }
  }

  useEffect(() => {
    setLoading(true);
    setImgIdx(0);
    setShowCalc(false);
    api<PublicVehicleDetail>(`/catalog/vehicles/${vehicleId}`)
      .then(setVehicle)
      .catch(() => setVehicle(null))
      .finally(() => setLoading(false));
    // registra "visto recentemente" para clientes logados
    if (token) api(`/catalog/views/${vehicleId}`, { method: 'POST', token }).catch(() => {});
  }, [vehicleId, token]);

  const imgs = vehicle?.images ?? [];

  // WhatsApp link
  const waPhone = vehicle
    ? (dealerPhone ? formatPhone(dealerPhone) : null)
    : null;
  const waText = vehicle
    ? encodeURIComponent(
        `Olá! Tenho interesse no veículo: ${vehicle.brand.name} ${vehicle.model.name} ${vehicle.versionName ?? ''} ${vehicle.yearModel}. Poderia me dar mais informações?`
      )
    : '';
  const waUrl = waPhone ? `https://wa.me/55${waPhone}?text=${waText}` : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg
                      bg-[#0f172a] border-l border-white/[.08] shadow-2xl
                      flex flex-col overflow-hidden
                      animate-in slide-in-from-right duration-300">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[.06] shrink-0">
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[.06] transition-all"
          >
            <X size={18} />
          </button>
          {vehicle && (
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-500 uppercase tracking-wide truncate">
                {vehicle.brand.name} · {vehicle.model.name}
              </p>
              <p className="text-sm font-bold text-white truncate">
                {vehicle.versionName ?? String(vehicle.yearModel)}
              </p>
            </div>
          )}
          {/* Favorito no header */}
          {vehicle && (
            <button
              onClick={onFavToggle}
              className={`p-2 rounded-xl transition-all ${
                isFav
                  ? 'text-rose-400 bg-rose-500/10'
                  : 'text-slate-400 hover:text-rose-400 hover:bg-rose-500/10'
              }`}
            >
              <Heart size={16} fill={isFav ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-blue-500" />
          </div>
        )}

        {!loading && !vehicle && (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <Car size={48} className="text-white/10 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Veículo não encontrado</p>
            </div>
          </div>
        )}

        {!loading && vehicle && (
          <div className="flex-1 overflow-y-auto">
            {/* Galeria de fotos */}
            <div className="relative bg-[#0a1120] aspect-[16/10]">
              {imgs.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imgs[imgIdx]?.url}
                  alt={imgs[imgIdx]?.altText ?? ''}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Car size={64} className="text-white/10" />
                </div>
              )}

              {imgs.length > 1 && (
                <>
                  <button
                    onClick={() => setImgIdx(i => (i - 1 + imgs.length) % imgs.length)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full
                               bg-black/50 backdrop-blur-sm flex items-center justify-center
                               text-white hover:bg-black/70 transition-all"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setImgIdx(i => (i + 1) % imgs.length)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full
                               bg-black/50 backdrop-blur-sm flex items-center justify-center
                               text-white hover:bg-black/70 transition-all"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {imgs.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setImgIdx(i)}
                        className={`w-1.5 h-1.5 rounded-full transition-all
                          ${i === imgIdx ? 'bg-white w-4' : 'bg-white/40 hover:bg-white/60'}`}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Thumbnails */}
              {imgs.length > 1 && (
                <div className="absolute bottom-0 left-0 right-0 flex gap-1.5 px-3 pb-10 overflow-x-auto scrollbar-hide">
                  {imgs.slice(0, 8).map((img, i) => (
                    <button
                      key={img.id}
                      onClick={() => setImgIdx(i)}
                      className={`w-12 h-9 rounded-lg overflow-hidden shrink-0 border-2 transition-all
                        ${i === imgIdx ? 'border-blue-500' : 'border-transparent opacity-60 hover:opacity-100'}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Preço + condição */}
            <div className="px-5 pt-5 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {vehicle.promoPrice ? (
                    <>
                      <p className="text-2xl font-extrabold text-rose-400">
                        {formatPrice(vehicle.promoPrice)}
                      </p>
                      <p className="text-sm text-slate-600 line-through mt-0.5">
                        {formatPrice(vehicle.price)}
                      </p>
                    </>
                  ) : (
                    <p className="text-2xl font-extrabold text-blue-400">
                      {formatPrice(vehicle.price)}
                    </p>
                  )}
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full mt-1 shrink-0
                  ${(condMap[vehicle.condition] ?? condMap.used).cls}`}>
                  {(condMap[vehicle.condition] ?? condMap.used).label}
                </span>
              </div>

              {/* Botões de ação */}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setShowLead(true)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl
                             bg-blue-600 text-white font-bold text-sm
                             hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/40"
                >
                  <MessageCircle size={15} />
                  Tenho interesse
                </button>

                {waUrl && (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                               bg-[#25D366]/10 border border-[#25D366]/30 text-[#25D366]
                               font-bold text-sm hover:bg-[#25D366]/20 transition-colors"
                  >
                    {/* WhatsApp SVG inline */}
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    WhatsApp
                  </a>
                )}
              </div>

              {/* Agendar test drive */}
              {canChat && (
                <button
                  onClick={() => setShowSchedule(true)}
                  className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 rounded-xl
                             bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold text-sm
                             hover:bg-amber-500/20 transition-colors"
                >
                  <CalendarPlus size={15} />
                  Agendar test drive
                </button>
              )}

              {/* Conversar pelo chat interno */}
              {canChat && (
                <button
                  onClick={startChat}
                  disabled={startingChat}
                  className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 rounded-xl
                             bg-white/[.05] border border-white/[.1] text-white font-bold text-sm
                             hover:bg-white/[.1] transition-colors disabled:opacity-50"
                >
                  {startingChat
                    ? <Loader2 size={15} className="animate-spin" />
                    : <MessageCircle size={15} className="text-blue-400" />}
                  Conversar com a loja
                </button>
              )}

              {/* Toggle calculadora */}
              <button
                onClick={() => setShowCalc(v => !v)}
                className={`w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-xl
                           border text-xs font-semibold transition-all
                  ${showCalc
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                    : 'border-white/[.07] text-slate-500 hover:border-white/20 hover:text-slate-300'}`}
              >
                <Calculator size={13} />
                {showCalc ? 'Fechar calculadora' : 'Simular financiamento'}
              </button>
            </div>

            {/* Calculadora */}
            {showCalc && (
              <div className="px-5 pb-3">
                <FinancingCalc price={vehicle.price} />
              </div>
            )}

            {/* Especificações em grid */}
            <div className="px-5 py-3 grid grid-cols-2 gap-2">
              {[
                { icon: <Car size={14}/>,       label: 'Ano',          value: `${vehicle.yearModel}/${vehicle.yearMake}` },
                { icon: <Gauge size={14}/>,      label: 'Quilometragem',value: formatKm(vehicle.mileageKm) },
                ...(vehicle.color ? [{ icon: <div className="w-3.5 h-3.5 rounded-full bg-white/30 border border-white/20 shrink-0"/>, label: 'Cor', value: vehicle.color }] : []),
                ...(vehicle.fuel ? [{ icon: <Fuel size={14}/>, label: 'Combustível', value: fuelLabels[vehicle.fuel] ?? vehicle.fuel }] : []),
                ...(vehicle.transmission ? [{ icon: <Settings2 size={14}/>, label: 'Câmbio', value: transLabels[vehicle.transmission] ?? vehicle.transmission }] : []),
                ...(vehicle.doors ? [{ icon: <DoorOpen size={14}/>, label: 'Portas', value: `${vehicle.doors}` }] : []),
                ...(vehicle.engine ? [{ icon: <Settings2 size={14}/>, label: 'Motor', value: vehicle.engine }] : []),
              ].map(({ icon, label, value }) => (
                <div key={label} className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[.04] border border-white/[.05]">
                  <span className="text-slate-500 shrink-0">{icon}</span>
                  <div className="min-w-0">
                    <p className="text-[10px] text-slate-600 uppercase tracking-wide">{label}</p>
                    <p className="text-sm font-semibold text-white truncate">{value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Descrição */}
            {vehicle.description && (
              <div className="px-5 py-3">
                <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Descrição</h4>
                <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-line">
                  {vehicle.description}
                </p>
              </div>
            )}

            <div className="h-6" />
          </div>
        )}
      </div>

      {/* Lead modal */}
      {showLead && vehicle && (
        <LeadModal
          vehicle={vehicle}
          tenantId={tenantId}
          onClose={() => setShowLead(false)}
        />
      )}

      {/* Agendamento de test drive */}
      {showSchedule && vehicle && (
        <ScheduleModal
          tenantId={tenantId}
          dealerName={dealerName}
          vehicle={{
            id: vehicle.id,
            label: `${vehicle.brand.name} ${vehicle.model.name} ${vehicle.versionName ?? ''} ${vehicle.yearModel}`.replace(/\s+/g, ' ').trim(),
            price: vehicle.promoPrice ?? vehicle.price,
            imageUrl: vehicle.images[0]?.url ?? null,
          }}
          branches={branches}
          onClose={() => setShowSchedule(false)}
        />
      )}

      {chatId && (
        <ChatDrawer
          conversationId={chatId}
          token={token!}
          myId={user?.id ?? ''}
          title={dealerName}
          subtitle={vehicle ? `${vehicle.brand.name} ${vehicle.model.name} ${vehicle.yearModel}` : undefined}
          logoUrl={dealerLogo}
          onClose={() => setChatId(null)}
        />
      )}
    </>
  );
}

/* ── Página principal ────────────────────────────────────── */

export default function CatalogoContent() {
  const params = useParams();
  const tenantId = params.id as string;

  const user  = useAuthStore(s => s.user);
  const token = useAuthStore(s => s.token);

  const [dealer, setDealer]               = useState<PublicDealer | null>(null);
  const [loadingDealer, setLoadingDealer] = useState(true);

  const [vehicles, setVehicles]           = useState<PublicVehicle[]>([]);
  const [total, setTotal]                 = useState(0);
  const [loadingV, setLoadingV]           = useState(true);
  const [page, setPage]                   = useState(0);

  const [brands, setBrands]               = useState<PublicBrand[]>([]);

  // Filtros
  const [search, setSearch]               = useState('');
  const [brandId, setBrandId]             = useState('');
  const [condition, setCondition]         = useState('');
  const [filtersOpen, setFiltersOpen]     = useState(false);

  // Drawer
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  // Favoritos
  const [favIds, setFavIds]               = useState<Set<string>>(new Set());

  // Comparador
  const [compareIds, setCompareIds]       = useState<Set<string>>(new Set());
  const [compareVehicles, setCompareVehicles] = useState<PublicVehicleDetail[]>([]);
  const [showCompare, setShowCompare]     = useState(false);

  /* ── Carrega dealer ──────────────────────────────────────── */
  useEffect(() => {
    api<PublicDealer>(`/catalog/dealer/${tenantId}`)
      .then(setDealer)
      .catch(() => setDealer(null))
      .finally(() => setLoadingDealer(false));
    api<PublicBrand[]>('/catalog/brands').then(setBrands).catch(() => {});
  }, [tenantId]);

  /* ── Carrega favoritos (se logado) ─────────────────────── */
  useEffect(() => {
    if (!user || !token) return;
    api<string[]>('/catalog/favorites/ids', { token })
      .then(ids => setFavIds(new Set(ids)))
      .catch(() => {});
  }, [user, token]);

  /* ── Toggle favorito ────────────────────────────────────── */
  const handleFavToggle = useCallback(async (vehicleId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!user || !token) return;
    const wasFav = favIds.has(vehicleId);
    // Optimistic
    setFavIds(prev => {
      const n = new Set(prev);
      if (wasFav) n.delete(vehicleId); else n.add(vehicleId);
      return n;
    });
    try {
      if (wasFav) {
        await api(`/catalog/favorites/${vehicleId}`, { method: 'DELETE', token });
      } else {
        await api(`/catalog/favorites/${vehicleId}`, { method: 'POST', token });
      }
    } catch {
      // Reverte no erro
      setFavIds(prev => {
        const n = new Set(prev);
        if (wasFav) n.add(vehicleId); else n.delete(vehicleId);
        return n;
      });
    }
  }, [user, token, favIds]);

  /* ── Toggle comparador ──────────────────────────────────── */
  const handleCompareToggle = useCallback(async (vehicle: PublicVehicle, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const isIn = compareIds.has(vehicle.id);
    if (isIn) {
      setCompareIds(prev => { const n = new Set(prev); n.delete(vehicle.id); return n; });
      setCompareVehicles(prev => prev.filter(v => v.id !== vehicle.id));
    } else {
      if (compareIds.size >= 3) return;
      setCompareIds(prev => new Set([...prev, vehicle.id]));
      // Carrega detalhe completo
      try {
        const detail = await api<PublicVehicleDetail>(`/catalog/vehicles/${vehicle.id}`);
        setCompareVehicles(prev => [...prev, detail]);
      } catch {
        setCompareIds(prev => { const n = new Set(prev); n.delete(vehicle.id); return n; });
      }
    }
  }, [compareIds]);

  /* ── Carrega veículos ────────────────────────────────────── */
  const fetchVehicles = useCallback((resetPage = false) => {
    const currentPage = resetPage ? 0 : page;
    if (resetPage) setPage(0);

    const qParams = new URLSearchParams({
      tenantId,
      limit: String(PER_PAGE),
      skip: String(currentPage * PER_PAGE),
    });
    if (search.trim())  qParams.set('q', search.trim());
    if (brandId)        qParams.set('brandId', brandId);
    if (condition)      qParams.set('condition', condition);

    setLoadingV(true);
    api<VehiclesPage>(`/catalog/vehicles?${qParams}`)
      .then(data => {
        if (resetPage) {
          setVehicles(data.items);
        } else {
          setVehicles(prev => [...prev, ...data.items]);
        }
        setTotal(data.total);
      })
      .catch(() => {})
      .finally(() => setLoadingV(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, search, brandId, condition, page]);

  useEffect(() => { fetchVehicles(true); }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setTimeout(() => fetchVehicles(true), search ? 400 : 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, brandId, condition]);

  function loadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    const qParams = new URLSearchParams({
      tenantId,
      limit: String(PER_PAGE),
      skip: String(nextPage * PER_PAGE),
    });
    if (search.trim())  qParams.set('q', search.trim());
    if (brandId)        qParams.set('brandId', brandId);
    if (condition)      qParams.set('condition', condition);

    setLoadingV(true);
    api<VehiclesPage>(`/catalog/vehicles?${qParams}`)
      .then(data => { setVehicles(prev => [...prev, ...data.items]); setTotal(data.total); })
      .catch(() => {})
      .finally(() => setLoadingV(false));
  }

  const activeFilters = (brandId ? 1 : 0) + (condition ? 1 : 0);
  const initials = dealer?.tradeName.slice(0, 2).toUpperCase() ?? '??';
  const branch   = dealer?.branches[0] ?? null;

  const dealerPhone = branch?.phone ?? dealer?.primaryPhone ?? null;

  function directionsUrl() {
    if (branch?.latitude && branch?.longitude) {
      return `https://www.google.com/maps/dir/?api=1&destination=${branch.latitude},${branch.longitude}`;
    }
    const addr = [branch?.addressLine, branch?.city, branch?.state].filter(Boolean).join(', ');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr || (dealer?.tradeName ?? ''))}`;
  }

  const selectedVehicle = useMemo(
    () => vehicles.find(v => v.id === selectedVehicleId) ?? null,
    [vehicles, selectedVehicleId],
  );

  return (
    <div className="min-h-screen bg-[#0f172a] text-white">

      {/* ── HEADER ───────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-[#0f172a]/95 border-b border-white/[.06] backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link
            href="/buscar"
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white
                       transition-colors font-medium group"
          >
            <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
            <span className="hidden sm:block">Mapa</span>
          </Link>

          <span className="text-slate-700 text-sm">/</span>

          {loadingDealer ? (
            <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
          ) : (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700
                              flex items-center justify-center shrink-0">
                <span className="text-white text-[11px] font-extrabold">{initials}</span>
              </div>
              <span className="font-bold text-white text-sm truncate">{dealer?.tradeName}</span>
              {branch && (
                <span className="hidden md:block text-xs text-slate-500">
                  {[branch.city, branch.state].filter(Boolean).join(', ')}
                </span>
              )}
            </div>
          )}

          <div className="flex-1" />

          {branch?.phone && (
            <a href={`tel:${branch.phone}`}
               className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400
                          hover:text-white transition-colors font-medium">
              <Phone size={13} /> {branch.phone}
            </a>
          )}
          {dealer?.websiteUrl && (
            <a href={dealer.websiteUrl} target="_blank" rel="noopener noreferrer"
               className="hidden md:flex items-center gap-1 text-xs text-slate-400 hover:text-blue-400 transition-colors">
              <Globe size={13} /> Site
            </a>
          )}
          <a
            href={directionsUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl
                       border border-white/[.08] bg-white/[.04] text-slate-400
                       hover:border-blue-500/50 hover:text-blue-400 transition-all"
          >
            <Navigation size={12} /> Como chegar
          </a>
        </div>
      </header>

      {/* ── HERO DA CONCESSIONÁRIA ────────────────────── */}
      {!loadingDealer && dealer && (
        <div className="bg-gradient-to-b from-[#1e293b] to-[#0f172a] border-b border-white/[.06]">
          <div className="max-w-6xl mx-auto px-4 py-8 flex items-center gap-5">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700
                            flex items-center justify-center shrink-0
                            shadow-xl shadow-blue-900/50">
              <span className="text-white text-2xl font-extrabold tracking-tight">{initials}</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold text-white leading-tight">{dealer.tradeName}</h1>
              {branch && (
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap text-sm text-slate-400">
                  <MapPin size={13} className="text-slate-500 shrink-0" />
                  <span>
                    {[branch.addressLine, branch.city, branch.state].filter(Boolean).join(', ')}
                  </span>
                  {branch.phone && (
                    <>
                      <span className="text-slate-700">·</span>
                      <a href={`tel:${branch.phone}`} className="hover:text-blue-400 transition-colors flex items-center gap-1">
                        <Phone size={12} />{branch.phone}
                      </a>
                    </>
                  )}
                  {dealer.websiteUrl && (
                    <>
                      <span className="text-slate-700">·</span>
                      <a href={dealer.websiteUrl} target="_blank" rel="noopener noreferrer"
                         className="hover:text-blue-400 transition-colors flex items-center gap-1">
                        <ExternalLink size={12} /> {dealer.websiteUrl.replace(/^https?:\/\//, '')}
                      </a>
                    </>
                  )}
                </div>
              )}
              <p className="text-xs text-slate-500 mt-1.5">
                {total > 0 ? `${total} veículo${total !== 1 ? 's' : ''} disponíve${total !== 1 ? 'is' : 'l'}` : 'Carregando estoque…'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── FILTROS ───────────────────────────────────── */}
      <div className="sticky top-14 z-20 bg-[#0f172a]/95 backdrop-blur-md border-b border-white/[.06]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2 flex-wrap">

          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar modelo, versão…"
              className="w-full pl-8 pr-8 py-2 rounded-xl bg-[#1e293b] border border-transparent
                         text-sm text-white placeholder-slate-600
                         outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex gap-1 bg-white/[.04] rounded-xl p-0.5">
            {[
              { value: '',        label: 'Todos' },
              { value: 'new',     label: '0 km' },
              { value: 'semi_new',label: 'Seminovo' },
              { value: 'used',    label: 'Usado' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setCondition(opt.value)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-[10px] transition-all
                  ${condition === opt.value
                    ? 'bg-white/[.08] text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-300'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl
                        text-xs font-semibold border transition-all
              ${filtersOpen || activeFilters > 0
                ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                : 'border-white/[.07] bg-[#1e293b] text-slate-400 hover:border-white/20 hover:text-slate-300'}`}
          >
            <SlidersHorizontal size={13} />
            Filtros
            {activeFilters > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-blue-600
                               text-white text-[10px] font-bold rounded-full
                               flex items-center justify-center">
                {activeFilters}
              </span>
            )}
          </button>

          {(search || brandId || condition) && (
            <button
              onClick={() => { setSearch(''); setBrandId(''); setCondition(''); }}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors font-medium"
            >
              <X size={12} /> Limpar
            </button>
          )}
        </div>

        {filtersOpen && brands.length > 0 && (
          <div className="border-t border-white/[.06] px-4 py-3">
            <div className="max-w-6xl mx-auto">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Filtrar por marca
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setBrandId('')}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all
                    ${!brandId
                      ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                      : 'border-white/[.07] bg-[#1e293b] text-slate-400 hover:border-white/20'}`}
                >
                  Todas
                </button>
                {brands.map(b => (
                  <button
                    key={b.id}
                    onClick={() => setBrandId(b.id === brandId ? '' : b.id)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all
                      ${b.id === brandId
                        ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                        : 'border-white/[.07] bg-[#1e293b] text-slate-400 hover:border-white/20'}`}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── GRID DE VEÍCULOS ─────────────────────────── */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {loadingV && vehicles.length === 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <VehicleCardSkeleton key={i} />)}
          </div>
        )}

        {!loadingV && vehicles.length === 0 && (
          <div className="flex flex-col items-center py-24 text-center">
            <div className="w-20 h-20 rounded-2xl bg-white/[.04] flex items-center justify-center mb-4">
              <Car size={36} className="text-white/15" />
            </div>
            <p className="text-lg font-bold text-slate-400 mb-2">
              {search || brandId || condition ? 'Sem veículos com esses filtros' : 'Sem veículos publicados'}
            </p>
            <p className="text-sm text-slate-600 leading-relaxed max-w-xs">
              {search || brandId || condition
                ? 'Tente remover alguns filtros para ver mais resultados.'
                : 'Esta concessionária ainda não tem veículos no estoque.'}
            </p>
            {(search || brandId || condition) && (
              <button
                onClick={() => { setSearch(''); setBrandId(''); setCondition(''); }}
                className="mt-4 text-sm text-blue-400 hover:text-blue-300 font-semibold transition-colors"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}

        {vehicles.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-slate-500">
                <span className="font-semibold text-white">{vehicles.length}</span>
                {total > vehicles.length && <span> de <span className="font-semibold text-white">{total}</span></span>}
                {' '}veículo{total !== 1 ? 's' : ''}
              </p>
              {compareIds.size > 0 && (
                <button
                  onClick={() => setShowCompare(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-amber-400
                             hover:text-amber-300 transition-colors"
                >
                  <Scale size={13} />
                  Comparar ({compareIds.size})
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {vehicles.map(v => (
                <VehicleCard
                  key={v.id}
                  v={v}
                  onClick={() => setSelectedVehicleId(v.id)}
                  isFav={favIds.has(v.id)}
                  onFavToggle={(e) => handleFavToggle(v.id, e)}
                  isCompared={compareIds.has(v.id)}
                  onCompareToggle={(e) => handleCompareToggle(v, e)}
                  compareDisabled={compareIds.size >= 3}
                />
              ))}
              {loadingV && Array.from({ length: 4 }).map((_, i) => <VehicleCardSkeleton key={`sk-${i}`} />)}
            </div>

            {vehicles.length < total && !loadingV && (
              <div className="flex justify-center mt-10">
                <button
                  onClick={loadMore}
                  className="flex items-center gap-2 px-8 py-3 rounded-2xl
                             border border-white/[.08] bg-white/[.04]
                             text-sm font-semibold text-slate-300
                             hover:border-blue-500/50 hover:bg-blue-500/[.06] hover:text-white
                             transition-all duration-200"
                >
                  Carregar mais
                  <span className="text-xs text-slate-500">({total - vehicles.length} restantes)</span>
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── BARRA FLUTUANTE DO COMPARADOR ──────────────── */}
      {compareIds.size >= 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[35]
                        bg-[#1e293b] border border-white/[.1] rounded-2xl
                        shadow-2xl px-5 py-3 flex items-center gap-4
                        animate-in slide-in-from-bottom duration-300">
          <Scale size={16} className="text-amber-400 shrink-0" />
          <div className="flex items-center gap-2">
            {compareVehicles.map(v => (
              <div key={v.id} className="flex items-center gap-1.5 text-sm font-semibold text-white">
                <span className="text-xs text-slate-500 truncate max-w-[100px]">
                  {v.brand.name} {v.model.name}
                </span>
                <button
                  onClick={() => handleCompareToggle(v as unknown as PublicVehicle)}
                  className="text-slate-600 hover:text-rose-400 transition-colors"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setShowCompare(true)}
            className="flex items-center gap-1.5 bg-amber-500 text-white text-xs font-bold
                       px-4 py-2 rounded-xl hover:bg-amber-400 transition-colors shrink-0"
          >
            Comparar <ArrowRight size={13} />
          </button>
          <button
            onClick={() => { setCompareIds(new Set()); setCompareVehicles([]); }}
            className="text-slate-600 hover:text-slate-400 transition-colors shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── DRAWER de detalhe ────────────────────────── */}
      {selectedVehicleId && (
        <VehicleDrawer
          vehicleId={selectedVehicleId}
          tenantId={tenantId}
          dealerPhone={dealerPhone}
          dealerName={dealer?.tradeName ?? 'Concessionária'}
          dealerLogo={dealer?.logoUrl ?? null}
          branches={dealer?.branches ?? []}
          onClose={() => setSelectedVehicleId(null)}
          isFav={favIds.has(selectedVehicleId)}
          onFavToggle={() => handleFavToggle(selectedVehicleId)}
        />
      )}

      {/* ── MODAL COMPARADOR ─────────────────────────── */}
      {showCompare && compareVehicles.length >= 2 && (
        <CompareModal
          vehicles={compareVehicles}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}
