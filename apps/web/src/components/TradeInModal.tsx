'use client';

/* Modal público de troca ("tenho um carro na troca")
   Usado em /catalogo/[id] e /c/[slug] quando o dealer aceita troca.
   O cliente descreve o próprio veículo → POST /catalog/trade-in.
   Não exige login (vira lead com dados de contato). */

import { useState } from 'react';
import { X, Repeat, Check, Loader2, AlertCircle, Car } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

export interface TradeInDesired {
  id: string;
  label: string;            // "Toyota Corolla XEi 2024"
  price?: number | null;
}

interface Props {
  tenantId: string;
  dealerName: string;
  desired?: TradeInDesired | null;   // veículo que o cliente quer comprar
  onClose: () => void;
}

const FUELS = [
  ['', 'Combustível'], ['flex', 'Flex'], ['gasoline', 'Gasolina'], ['ethanol', 'Etanol'],
  ['diesel', 'Diesel'], ['hybrid', 'Híbrido'], ['electric', 'Elétrico'], ['gnv', 'GNV'],
] as const;
const TRANS = [
  ['', 'Câmbio'], ['manual', 'Manual'], ['automatic', 'Automático'], ['cvt', 'CVT'], ['automated_manual', 'Automatizado'],
] as const;

const THIS_YEAR = new Date().getFullYear();
const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);

export default function TradeInModal({ tenantId, dealerName, desired, onClose }: Props) {
  const user = useAuthStore((s) => s.user);

  const [f, setF] = useState({
    brandName: '', modelName: '', versionName: '',
    yearMake: '', yearModel: '', mileageKm: '', color: '',
    fuel: '', transmission: '', plate: '',
    isFinanced: false, hasDebts: false,
    expectedValue: '', notes: '',
    contactName: user?.fullName ?? '', contactEmail: user?.email ?? '', contactPhone: '',
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  const inputCls =
    'w-full rounded-xl sup-base border borda text-sm txt-forte placeholder-slate-400 dark:placeholder-slate-600 px-3 py-2.5 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const yearMake = Number(f.yearMake);
    const yearModel = Number(f.yearModel);
    const mileageKm = Number(f.mileageKm);
    if (!f.brandName.trim() || !f.modelName.trim()) { setError('Informe marca e modelo do seu carro.'); return; }
    if (!Number.isInteger(yearModel) || yearModel < 1950 || yearModel > THIS_YEAR + 1) { setError('Ano do modelo inválido.'); return; }
    if (!Number.isInteger(yearMake) || yearMake < 1950 || yearMake > THIS_YEAR + 1) { setError('Ano de fabricação inválido.'); return; }
    if (!Number.isInteger(mileageKm) || mileageKm < 0) { setError('Quilometragem inválida.'); return; }
    if (!f.contactName.trim() || !f.contactEmail.trim()) { setError('Informe seu nome e e-mail para contato.'); return; }

    setSending(true);
    try {
      await api('/catalog/trade-in', {
        method: 'POST',
        body: JSON.stringify({
          tenantId,
          desiredVehicleId: desired?.id,
          contactName: f.contactName.trim(),
          contactEmail: f.contactEmail.trim(),
          contactPhone: f.contactPhone.trim() || undefined,
          expectedValue: f.expectedValue ? Number(f.expectedValue) : undefined,
          message: f.notes.trim() || undefined,
          vehicle: {
            brandName: f.brandName.trim(),
            modelName: f.modelName.trim(),
            versionName: f.versionName.trim() || undefined,
            yearMake, yearModel, mileageKm,
            color: f.color.trim() || undefined,
            fuel: f.fuel || undefined,
            transmission: f.transmission || undefined,
            plate: f.plate.trim() || undefined,
            isFinanced: f.isFinanced,
            hasDebts: f.hasDebts,
            notes: f.notes.trim() || undefined,
          },
        }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar proposta. Tente novamente.');
    } finally {
      setSending(false);
    }
  }

  /* ── Sucesso ── */
  if (sent) {
    return (
      <Shell onClose={onClose}>
        <div className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <Check size={28} className="text-emerald-400" />
          </div>
          <h3 className="text-lg font-bold txt-forte mb-2">Proposta de troca enviada!</h3>
          <p className="text-sm txt-fraco leading-relaxed mb-1">
            A <span className="txt-forte font-semibold">{dealerName}</span> vai avaliar o seu{' '}
            <span className="txt-forte font-semibold">{f.brandName} {f.modelName}</span> e responder com um valor.
          </p>
          <p className="text-xs text-slate-500 mb-6">Você receberá a avaliação por e-mail em {f.contactEmail}.</p>
          <button onClick={onClose}
            className="w-full bg-emerald-600 text-white font-bold py-2.5 rounded-xl hover:bg-emerald-500 transition-colors text-sm">
            Fechar
          </button>
        </div>
      </Shell>
    );
  }

  /* ── Formulário ── */
  return (
    <Shell onClose={onClose}>
      <div className="flex items-center justify-between p-5 border-b borda">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <Repeat size={17} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="text-base font-bold txt-forte">Oferecer meu carro na troca</h3>
            <p className="text-xs text-slate-500">{dealerName}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl txt-fraco hover:txt-forte hover:sup-fraca transition-all">
          <X size={16} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {desired && (
          <div className="flex items-center gap-3 rounded-xl bg-emerald-500/[.06] border border-emerald-500/20 p-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
              <Car size={16} className="text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs txt-fraco">Seu carro vai abater do valor de</p>
              <p className="text-sm font-bold txt-forte truncate">
                {desired.label}{desired.price != null ? ` · ${brl(desired.price)}` : ''}
              </p>
            </div>
          </div>
        )}

        {/* Seu veículo */}
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Seu veículo</p>
        <div className="grid grid-cols-2 gap-2.5">
          <input className={inputCls} placeholder="Marca *" value={f.brandName} onChange={(e) => set('brandName', e.target.value)} />
          <input className={inputCls} placeholder="Modelo *" value={f.modelName} onChange={(e) => set('modelName', e.target.value)} />
        </div>
        <input className={inputCls} placeholder="Versão (ex: XEi 2.0)" value={f.versionName} onChange={(e) => set('versionName', e.target.value)} />
        <div className="grid grid-cols-3 gap-2.5">
          <input className={inputCls} type="number" placeholder="Ano fab. *" value={f.yearMake} onChange={(e) => set('yearMake', e.target.value)} />
          <input className={inputCls} type="number" placeholder="Ano mod. *" value={f.yearModel} onChange={(e) => set('yearModel', e.target.value)} />
          <input className={inputCls} type="number" placeholder="KM *" value={f.mileageKm} onChange={(e) => set('mileageKm', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <select className={`${inputCls} [color-scheme:dark]`} value={f.fuel} onChange={(e) => set('fuel', e.target.value)}>
            {FUELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className={`${inputCls} [color-scheme:dark]`} value={f.transmission} onChange={(e) => set('transmission', e.target.value)}>
            {TRANS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <input className={inputCls} placeholder="Cor" value={f.color} onChange={(e) => set('color', e.target.value)} />
          <input className={inputCls} placeholder="Placa (opcional)" value={f.plate} onChange={(e) => set('plate', e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-4 text-xs txt-medio">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={f.isFinanced} onChange={(e) => set('isFinanced', e.target.checked)} className="accent-emerald-500" />
            Está financiado
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={f.hasDebts} onChange={(e) => set('hasDebts', e.target.checked)} className="accent-emerald-500" />
            Tem débitos (IPVA/multas)
          </label>
        </div>
        <input className={inputCls} type="number" placeholder="Quanto espera receber pela troca? (opcional)"
          value={f.expectedValue} onChange={(e) => set('expectedValue', e.target.value)} />
        <textarea className={`${inputCls} resize-none`} rows={2} placeholder="Observações (estado, revisões, detalhes…)"
          value={f.notes} onChange={(e) => set('notes', e.target.value)} />

        {/* Contato */}
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pt-1">Seu contato</p>
        <div className="grid grid-cols-2 gap-2.5">
          <input className={inputCls} placeholder="Nome *" value={f.contactName} onChange={(e) => set('contactName', e.target.value)} />
          <input className={inputCls} placeholder="Telefone" value={f.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
        </div>
        <input className={inputCls} type="email" placeholder="E-mail *" value={f.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />

        {error && (
          <div className="flex items-center gap-2 text-rose-400 text-xs bg-rose-500/10 rounded-xl px-3 py-2">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <button type="submit" disabled={sending}
          className="w-full bg-emerald-600 text-white font-bold py-3 rounded-xl hover:bg-emerald-500 transition-colors text-sm
                     disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          {sending ? <><Loader2 size={15} className="animate-spin" /> Enviando…</> : <>Enviar proposta de troca</>}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="sup-card border borda rounded-2xl shadow-2xl max-w-md w-full max-h-[92vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  );
}
