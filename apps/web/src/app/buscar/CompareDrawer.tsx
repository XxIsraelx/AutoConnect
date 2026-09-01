'use client';

import { X, Car, GitCompare } from 'lucide-react';
import type { PublicVehicle } from './types';

const FUEL: Record<string, string> = {
  flex: 'Flex', gasoline: 'Gasolina', ethanol: 'Etanol', diesel: 'Diesel',
  hybrid: 'Híbrido', electric: 'Elétrico', gnv: 'GNV',
};
const TRANS: Record<string, string> = {
  manual: 'Manual', automatic: 'Automático', cvt: 'CVT', automated_manual: 'Automatizado',
};
const COND: Record<string, string> = {
  new: 'Novo', used: 'Usado', semi_new: 'Semi-novo', demo: 'Demo',
};

/** Verde do "melhor valor": o emerald-400 do escuro fica ilegível no branco. */
const DESTAQUE = 'text-emerald-600 dark:text-emerald-400';

function brl(v: string | null | undefined) {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

/** Acha qual valor numérico é o "melhor" (menor preço/km, maior ano) p/ destacar */
function bestIndex(values: (number | null)[], dir: 'min' | 'max'): number {
  let best = -1, bestVal: number | null = null;
  values.forEach((v, i) => {
    if (v == null) return;
    if (bestVal == null || (dir === 'min' ? v < bestVal : v > bestVal)) { bestVal = v; best = i; }
  });
  return best;
}

export default function CompareDrawer({
  vehicles, dealerNames, open, onClose, onRemove,
}: {
  vehicles: PublicVehicle[];
  dealerNames: Map<string, string>;
  open: boolean;
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const prices = vehicles.map((v) => Number(v.promoPrice ?? v.price));
  const kms    = vehicles.map((v) => v.mileageKm);
  const years  = vehicles.map((v) => v.yearModel);
  const bestPrice = bestIndex(prices, 'min');
  const bestKm    = bestIndex(kms, 'min');
  const bestYear  = bestIndex(years, 'max');

  const rows: { label: string; render: (v: PublicVehicle, i: number) => React.ReactNode }[] = [
    { label: 'Preço', render: (v, i) => (
      <span className={`font-extrabold ${i === bestPrice ? DESTAQUE : 'txt-forte'}`}>
        {brl(v.promoPrice ?? v.price)}
      </span>
    )},
    { label: 'Ano', render: (v, i) => (
      <span className={i === bestYear ? `${DESTAQUE} font-bold` : ''}>{v.yearModel}</span>
    )},
    { label: 'KM', render: (v, i) => (
      <span className={i === bestKm ? `${DESTAQUE} font-bold` : ''}>
        {v.mileageKm.toLocaleString('pt-BR')} km
      </span>
    )},
    { label: 'Condição',    render: (v) => COND[v.condition] ?? v.condition },
    { label: 'Combustível', render: (v) => (v.fuel ? FUEL[v.fuel] ?? v.fuel : '—') },
    { label: 'Câmbio',      render: (v) => (v.transmission ? TRANS[v.transmission] ?? v.transmission : '—') },
    { label: 'Cor',         render: (v) => v.color ?? '—' },
    { label: 'Carroceria',  render: (v) => v.model.category ?? '—' },
    { label: 'Loja',        render: (v) => dealerNames.get(v.tenantId) ?? '—' },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm transition-opacity duration-300
          ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Drawer */}
      <aside
        className={`fixed top-0 right-0 z-[2001] h-full w-full max-w-2xl sup-base border-l borda
                    shadow-2xl transition-transform duration-300 flex flex-col
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b borda shrink-0">
          <div className="flex items-center gap-2">
            <GitCompare size={16} className="text-blue-600 dark:text-blue-400" />
            <h2 className="text-sm font-bold txt-forte">Comparar veículos</h2>
            <span className="text-xs text-slate-500">({vehicles.length})</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg txt-fraco hover:txt-forte hover:sup-fraca transition">
            <X size={18} />
          </button>
        </div>

        {vehicles.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-3">
            <GitCompare size={40} className="text-slate-300 dark:text-white/10" />
            <p className="text-sm">Selecione veículos para comparar</p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            {/* Cabeçalho com fotos */}
            <div className="grid sticky top-0 sup-base z-10 border-b borda"
                 style={{ gridTemplateColumns: `90px repeat(${vehicles.length}, minmax(0,1fr))` }}>
              <div className="p-3" />
              {vehicles.map((v) => {
                const cover = v.images[0]?.url;
                return (
                  <div key={v.id} className="p-3 border-l borda relative">
                    <button
                      onClick={() => onRemove(v.id)}
                      className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/60 text-white
                                 flex items-center justify-center hover:bg-rose-600 transition"
                    >
                      <X size={11} />
                    </button>
                    <div className="aspect-[4/3] rounded-lg overflow-hidden sup-fraca mb-2 flex items-center justify-center">
                      {cover
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={cover} alt="" className="w-full h-full object-cover" />
                        : <Car size={20} className="text-slate-300 dark:text-white/20" />}
                    </div>
                    <p className="text-[10px] text-slate-500 uppercase truncate">{v.brand.name}</p>
                    <p className="text-xs font-bold txt-forte truncate">{v.model.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{v.versionName ?? `${v.yearModel}`}</p>
                  </div>
                );
              })}
            </div>

            {/* Linhas de atributos */}
            {rows.map((row, ri) => (
              <div key={row.label}
                   className={`grid ${ri % 2 ? 'bg-slate-50/70 dark:bg-white/[.015]' : ''}`}
                   style={{ gridTemplateColumns: `90px repeat(${vehicles.length}, minmax(0,1fr))` }}>
                <div className="p-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  {row.label}
                </div>
                {vehicles.map((v, i) => (
                  <div key={v.id} className="p-3 text-sm txt-medio border-l borda truncate">
                    {row.render(v, i)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </aside>
    </>
  );
}
