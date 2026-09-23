'use client';

/**
 * A loja marca um compromisso.
 *
 * Até aqui só o cliente logado conseguia agendar, pela página pública: o
 * vendedor que combinava um test drive por telefone não tinha onde registrar,
 * e o lembrete automático nunca saía. A agenda mostrava metade do dia real.
 *
 * Dois caminhos de identificação, e eles cobrem os três casos:
 *
 *  - **lead existente** — a lista traz o contato pronto. Quando o lead é de um
 *    cliente com conta, o `customerUserId` vai junto e o agendamento aparece
 *    também no `/perfil` dele;
 *  - **contato avulso** — nome e telefone digitados na hora, para quem ligou e
 *    ainda não virou lead.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, CalendarPlus, Loader2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { APPOINTMENT_TYPES } from '@autoconnect/shared';

const ROTULO_DO_TIPO: Record<(typeof APPOINTMENT_TYPES)[number], string> = {
  test_drive: 'Test drive',
  evaluation: 'Avaliação',
  in_person: 'Visita',
  online: 'Atendimento online',
  delivery: 'Entrega',
  service: 'Serviço',
};

interface LeadDaLoja {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  vehicle: { id: string } | null;
  customer: { id: string; fullName: string } | null;
}
interface VeiculoDaLoja {
  id: string;
  versionName: string | null;
  yearModel: number;
  brand: { name: string };
  model: { name: string };
}
interface Membro { id: string; fullName: string; role: string }

export default function NovoAgendamentoModal({
  membros, onClose, onCriado,
}: {
  membros: Membro[];
  onClose: () => void;
  onCriado: () => void;
}) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [modo, setModo] = useState<'lead' | 'avulso'>('lead');
  const [leadId, setLeadId] = useState('');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');

  const [tipo, setTipo] = useState<(typeof APPOINTMENT_TYPES)[number]>('test_drive');
  const [quando, setQuando] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [salespersonId, setSalespersonId] = useState(user?.id ?? '');
  const [observacao, setObservacao] = useState('');

  const [leads, setLeads] = useState<LeadDaLoja[]>([]);
  const [veiculos, setVeiculos] = useState<VeiculoDaLoja[]>([]);
  const [erroDasListas, setErroDasListas] = useState('');

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [errosDeCampo, setErrosDeCampo] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!token) return;
    Promise.all([
      api<{ items: LeadDaLoja[] }>('/leads?perPage=100', { token }),
      api<{ items: VeiculoDaLoja[] }>('/vehicles?status=available&perPage=100', { token }),
    ])
      .then(([l, v]) => {
        setLeads(l.items ?? []);
        setVeiculos(v.items ?? []);
        setErroDasListas('');
      })
      // Sem as listas ainda dá para agendar por contato avulso: a falha vira
      // aviso, não tela de erro.
      .catch((e) => setErroDasListas(textoDoErro(e)));
  }, [token]);

  const leadEscolhido = leads.find((l) => l.id === leadId) ?? null;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSalvando(true);
    setErro('');
    setErrosDeCampo({});

    try {
      await api('/appointments/dealer', {
        method: 'POST',
        token,
        body: {
          ...(modo === 'lead'
            ? {
                leadId: leadId || undefined,
                // Cliente com conta: o agendamento também aparece no /perfil dele.
                customerUserId: leadEscolhido?.customer?.id,
              }
            : {
                contactName: nome.trim(),
                contactPhone: telefone.trim(),
                contactEmail: email.trim() || undefined,
              }),
          type: tipo,
          scheduledStart: new Date(quando).toISOString(),
          vehicleId: vehicleId || undefined,
          salespersonId: salespersonId || undefined,
          notes: observacao.trim() || undefined,
        },
      });
      onCriado();
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length > 0) {
        setErrosDeCampo(Object.fromEntries(err.fieldErrors.map((f) => [f.field, f.message])));
        setErro('Confira os campos destacados.');
      } else {
        setErro(textoDoErro(err));
      }
    } finally {
      setSalvando(false);
    }
  }

  const campo = 'w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/30 transition';
  const borda = (e?: string) => (e ? 'border-rose-500' : 'border-slate-200 dark:border-slate-700');

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 !mt-0 z-[2000] bg-black/50 backdrop-blur-sm" />
      <div className="fixed inset-0 !mt-0 z-[2001] flex items-start justify-center overflow-y-auto p-4 py-6">
        <form
          onSubmit={salvar}
          className="w-full max-w-md my-auto rounded-2xl bg-white dark:bg-slate-900
                     border border-slate-200 dark:border-slate-800 shadow-2xl"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <CalendarPlus size={15} className="text-blue-500" /> Novo agendamento
            </h2>
            <button type="button" onClick={onClose} aria-label="Fechar"
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-3.5">
            {/* Quem */}
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
              {([['lead', 'Lead / cliente'], ['avulso', 'Contato avulso']] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setModo(v)}
                  className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition
                    ${modo === v ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {l}
                </button>
              ))}
            </div>

            {modo === 'lead' ? (
              <div>
                <label htmlFor="na-lead" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Lead</label>
                <select id="na-lead" value={leadId} required
                  onChange={(e) => {
                    setLeadId(e.target.value);
                    // Herda o carro do lead: é quase sempre o do test drive.
                    const l = leads.find((x) => x.id === e.target.value);
                    if (l?.vehicle?.id) setVehicleId(l.vehicle.id);
                  }}
                  className={`${campo} ${borda(errosDeCampo.leadId)}`}>
                  <option value="">Escolha um lead…</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.customer?.fullName ?? l.contactName ?? 'Sem nome'}
                      {l.contactPhone ? ` · ${l.contactPhone}` : ''}
                      {l.customer ? ' · tem conta' : ''}
                    </option>
                  ))}
                </select>
                {errosDeCampo.leadId && <p className="text-[11px] text-rose-500 mt-1">{errosDeCampo.leadId}</p>}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label htmlFor="na-nome" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Nome</label>
                  <input id="na-nome" value={nome} onChange={(e) => setNome(e.target.value)} required
                    className={`${campo} ${borda(errosDeCampo.contactName)}`} />
                  {errosDeCampo.contactName && <p className="text-[11px] text-rose-500 mt-1">{errosDeCampo.contactName}</p>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="na-tel" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Telefone</label>
                    <input id="na-tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} required
                      inputMode="tel" placeholder="(11) 98765-4321"
                      className={`${campo} ${borda(errosDeCampo.contactPhone)}`} />
                    {errosDeCampo.contactPhone && <p className="text-[11px] text-rose-500 mt-1">{errosDeCampo.contactPhone}</p>}
                  </div>
                  <div>
                    <label htmlFor="na-email" className="text-[11px] font-semibold text-slate-500 block mb-1.5">E-mail (opcional)</label>
                    <input id="na-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      className={`${campo} ${borda(errosDeCampo.contactEmail)}`} />
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">
                  Sem e-mail o agendamento funciona, mas o lembrete automático de 24h não sai.
                </p>
              </div>
            )}

            {/* Quando e o quê */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="na-tipo" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Tipo</label>
                <select id="na-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}
                  className={`${campo} ${borda()}`}>
                  {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{ROTULO_DO_TIPO[t]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="na-quando" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Data e hora</label>
                <input id="na-quando" type="datetime-local" value={quando} required
                  onChange={(e) => setQuando(e.target.value)} style={{ colorScheme: 'light' }}
                  className={`${campo} ${borda(errosDeCampo.scheduledStart)}`} />
                {errosDeCampo.scheduledStart && <p className="text-[11px] text-rose-500 mt-1">{errosDeCampo.scheduledStart}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="na-veiculo" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Veículo (opcional)</label>
              <select id="na-veiculo" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}
                className={`${campo} ${borda()}`}>
                <option value="">Nenhum</option>
                {veiculos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.brand.name} {v.model.name} {v.versionName ?? ''} {v.yearModel}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="na-vendedor" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Vendedor responsável</label>
              <select id="na-vendedor" value={salespersonId} onChange={(e) => setSalespersonId(e.target.value)}
                className={`${campo} ${borda()}`}>
                <option value="">Eu mesmo</option>
                {membros.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="na-obs" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Observação</label>
              <textarea id="na-obs" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)}
                className={`${campo} ${borda()} resize-none`} />
            </div>

            {erroDasListas && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Não foi possível carregar leads e estoque ({erroDasListas}). Dá para agendar por
                contato avulso mesmo assim.
              </p>
            )}

            {erro && (
              <div role="alert" className="flex items-start gap-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 rounded-lg px-3 py-2">
                <AlertCircle size={13} className="mt-0.5 shrink-0" /> {erro}
              </div>
            )}
          </div>

          <div className="flex gap-2 px-5 py-4 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando}
              className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />}
              Agendar
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
