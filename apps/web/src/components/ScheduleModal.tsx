'use client';

/* Modal público de agendamento (test drive / visita)
   Usado em /catalogo/[id] e /c/[slug].
   Cliente logado escolhe data + horário → POST /appointments */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  X, Calendar, Check, Loader2, AlertCircle, Car, MapPin, Clock,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

export interface ScheduleVehicle {
  id: string;
  label: string;          // "Toyota Corolla XEi 2024"
  price?: string | null;
  imageUrl?: string | null;
}

export interface ScheduleBranch {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
}

interface Props {
  tenantId: string;
  dealerName: string;
  vehicle?: ScheduleVehicle | null;   // ausente = visita à loja
  branches?: ScheduleBranch[];
  onClose: () => void;
}

/* Slots de 30 em 30min, 08:00–19:00 */
const SLOTS: string[] = [];
for (let h = 8; h < 19; h++) {
  SLOTS.push(`${String(h).padStart(2, '0')}:00`, `${String(h).padStart(2, '0')}:30`);
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function ScheduleModal({ tenantId, dealerName, vehicle, branches, onClose }: Props) {
  const user   = useAuthStore(s => s.user);
  const token  = useAuthStore(s => s.token);
  const router = useRouter();

  const [date, setDate]         = useState(todayISO(1));
  const [slot, setSlot]         = useState('');
  const [branchId, setBranchId] = useState(branches?.[0]?.id ?? '');
  const [notes, setNotes]       = useState('');
  const [sending, setSending]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const isTestDrive = !!vehicle;

  /* Slots passados ficam indisponíveis quando a data é hoje */
  const availableSlots = useMemo(() => {
    if (date !== todayISO()) return SLOTS;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return SLOTS.filter(s => {
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m > nowMin + 60; // pelo menos 1h de antecedência
    });
  }, [date]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!slot) { setError('Escolha um horário.'); return; }
    setSending(true);
    setError(null);
    try {
      await api('/appointments', {
        method: 'POST',
        token: token!,
        body: JSON.stringify({
          tenantId,
          vehicleId: vehicle?.id,
          branchId: branchId || undefined,
          type: isTestDrive ? 'test_drive' : 'in_person',
          scheduledStart: new Date(`${date}T${slot}:00`).toISOString(),
          notes: notes.trim() || undefined,
        }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao agendar. Tente novamente.');
    } finally {
      setSending(false);
    }
  }

  /* ── Não logado ── */
  if (!user || !token) {
    return (
      <Shell onClose={onClose}>
        <div className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <Calendar size={28} className="text-blue-400" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Faça login para agendar</h3>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            Você precisa de uma conta de cliente para agendar
            {isTestDrive ? ' um test drive' : ' uma visita'}.
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => router.push('/entrar')}
              className="w-full bg-blue-600 text-white font-bold py-2.5 rounded-xl hover:bg-blue-500 transition-colors text-sm"
            >
              Entrar na conta
            </button>
            <button
              onClick={() => router.push('/cadastrar')}
              className="w-full border border-white/[.1] text-slate-300 font-semibold py-2.5 rounded-xl hover:bg-white/[.05] transition-colors text-sm"
            >
              Criar conta grátis
            </button>
            <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-400 transition-colors mt-1">
              Cancelar
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  /* ── Sucesso ── */
  if (sent) {
    const when = new Date(`${date}T${slot}:00`).toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: 'long',
    });
    return (
      <Shell onClose={onClose}>
        <div className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <Check size={28} className="text-emerald-400" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Agendamento solicitado!</h3>
          <p className="text-sm text-slate-400 leading-relaxed mb-1">
            {isTestDrive ? 'Test drive' : 'Visita'} em <span className="text-white font-semibold">{when}</span> às{' '}
            <span className="text-white font-semibold">{slot}</span>.
          </p>
          <p className="text-xs text-slate-500 mb-6">
            A {dealerName} vai confirmar o horário e você receberá um aviso por e-mail.
          </p>
          <button
            onClick={onClose}
            className="w-full bg-emerald-600 text-white font-bold py-2.5 rounded-xl hover:bg-emerald-500 transition-colors text-sm"
          >
            Fechar
          </button>
        </div>
      </Shell>
    );
  }

  /* ── Formulário ── */
  return (
    <Shell onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-white/[.06]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center">
            <Calendar size={17} className="text-blue-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              {isTestDrive ? 'Agendar test drive' : 'Agendar visita'}
            </h3>
            <p className="text-xs text-slate-500">{dealerName}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[.06] transition-all">
          <X size={16} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {/* Veículo */}
        {vehicle && (
          <div className="flex items-center gap-3 rounded-xl bg-white/[.04] border border-white/[.06] p-3">
            <div className="w-14 h-11 rounded-lg overflow-hidden bg-[#0f172a] shrink-0 flex items-center justify-center">
              {vehicle.imageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={vehicle.imageUrl} alt="" className="w-full h-full object-cover" />
                : <Car size={18} className="text-white/15" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{vehicle.label}</p>
              {vehicle.price && (
                <p className="text-xs text-blue-400 font-semibold">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(Number(vehicle.price))}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Filial */}
        {branches && branches.length > 1 && (
          <div>
            <label className="text-[11px] font-semibold text-slate-400 block mb-1.5 flex items-center gap-1.5">
              <MapPin size={11} /> Filial
            </label>
            <select
              value={branchId}
              onChange={e => setBranchId(e.target.value)}
              className="w-full rounded-xl bg-[#0f172a] border border-white/[.08] text-sm text-white px-3 py-2.5
                         outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            >
              {branches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.city ? ` — ${b.city}/${b.state ?? ''}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Data */}
        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1.5 flex items-center gap-1.5">
            <Calendar size={11} /> Data
          </label>
          <input
            type="date"
            value={date}
            min={todayISO()}
            max={todayISO(60)}
            onChange={e => { setDate(e.target.value); setSlot(''); }}
            className="w-full rounded-xl bg-[#0f172a] border border-white/[.08] text-sm text-white px-3 py-2.5
                       outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all
                       [color-scheme:dark]"
            required
          />
        </div>

        {/* Horários */}
        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1.5 flex items-center gap-1.5">
            <Clock size={11} /> Horário
          </label>
          {availableSlots.length === 0 ? (
            <p className="text-xs text-slate-500 bg-white/[.03] rounded-xl px-3 py-3">
              Sem horários disponíveis hoje — escolha outra data.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 max-h-32 overflow-y-auto pr-1">
              {availableSlots.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSlot(s)}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition-all border
                    ${slot === s
                      ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/40'
                      : 'bg-[#0f172a] border-white/[.07] text-slate-400 hover:border-blue-500/50 hover:text-white'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Observações */}
        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1.5">
            Observações (opcional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={isTestDrive ? 'Ex: Prefiro dirigir na estrada…' : 'Ex: Quero conhecer os SUVs disponíveis…'}
            rows={2}
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
          disabled={sending || !slot}
          className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl
                     hover:bg-blue-500 transition-colors text-sm
                     disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center justify-center gap-2"
        >
          {sending
            ? <><Loader2 size={15} className="animate-spin" /> Agendando…</>
            : <>Confirmar agendamento{slot ? ` · ${slot}` : ''}</>}
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
        <div className="bg-[#1e293b] border border-white/[.1] rounded-2xl shadow-2xl max-w-md w-full max-h-[92vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  );
}
