'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, Phone, Mail, Car, Clock, CheckCircle2,
  XCircle, MessageSquare, ChevronDown, Loader2,
  Search, X, RefreshCw, ExternalLink, Download,
  History, UserCheck, Send, ChevronLeft, Repeat,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { mensagemDeErro } from '@/components/ErroAoCarregar';

/* ── Tipos ───────────────────────────────────────────────── */

type LeadStatus =
  | 'new' | 'contacted' | 'qualified'
  | 'negotiating' | 'won' | 'lost' | 'archived';

interface LeadVehicle {
  id: string;
  versionName: string | null;
  yearModel: number;
  price: string;
  brand: { name: string };
  model: { name: string };
  images: { url: string }[];
}

interface TradeInMeta {
  vehicle?: {
    brandName?: string; modelName?: string; versionName?: string;
    yearMake?: number; yearModel?: number; mileageKm?: number;
    color?: string; fuel?: string; transmission?: string;
    plate?: string; isFinanced?: boolean; hasDebts?: boolean; notes?: string;
  };
  expectedValue?: number | null;
  fipeReference?: number | null;
  appraisal?: { value?: number; note?: string | null; status?: string; evaluatedAt?: string };
}

interface Lead {
  id: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  source: string;
  status: LeadStatus;
  message: string | null;
  createdAt: string;
  vehicle: LeadVehicle | null;
  customer: { id: string; fullName: string; email: string; phone: string | null } | null;
  metadata?: { tradeIn?: TradeInMeta } | null;
}

interface LeadsResponse {
  items: Lead[];
  total: number;
  page: number;
  perPage: number;
}

interface LeadStats {
  new?: number;
  contacted?: number;
  qualified?: number;
  negotiating?: number;
  won?: number;
  lost?: number;
  archived?: number;
}

interface TeamMember { id: string; fullName: string; role: string; email: string; }
interface Interaction {
  id: string; kind: string; content: string | null;
  occurredAt: string; actor: { id: string; fullName: string } | null;
}
interface LeadHistory extends Lead {
  assignee: TeamMember | null;
  interactions: Interaction[];
  appointments: { id: string; scheduledStart: string; scheduledEnd: string; status: string; type: string; notes: string | null }[];
}

/* ── Configs de status ───────────────────────────────────── */

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  new:         { label: 'Novo',        color: 'text-blue-400',    bg: 'bg-blue-500/15 border-blue-500/30',    icon: <Clock size={12}/>       },
  contacted:   { label: 'Contatado',   color: 'text-sky-400',     bg: 'bg-sky-500/15 border-sky-500/30',      icon: <Phone size={12}/>       },
  qualified:   { label: 'Qualificado', color: 'text-violet-400',  bg: 'bg-violet-500/15 border-violet-500/30',icon: <CheckCircle2 size={12}/> },
  negotiating: { label: 'Negociando',  color: 'text-amber-400',   bg: 'bg-amber-500/15 border-amber-500/30',  icon: <MessageSquare size={12}/> },
  won:         { label: 'Ganho',       color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30', icon: <CheckCircle2 size={12}/> },
  lost:        { label: 'Perdido',     color: 'text-rose-400',    bg: 'bg-rose-500/15 border-rose-500/30',    icon: <XCircle size={12}/>     },
  archived:    { label: 'Arquivado',   color: 'text-slate-400',   bg: 'bg-slate-500/15 border-slate-500/30',  icon: <XCircle size={12}/>     },
};

const STATUS_ORDER: LeadStatus[] = ['new','contacted','qualified','negotiating','won','lost','archived'];

/* ── Helpers ─────────────────────────────────────────────── */

function formatPrice(v: string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(parseFloat(v));
}

function timeAgo(dateStr: string) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60)    return 'agora';
  if (diff < 3600)  return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

/* ── StatusBadge ─────────────────────────────────────────── */

function StatusBadge({ status }: { status: LeadStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

/* ── StatusDropdown ──────────────────────────────────────── */

function StatusDropdown({
  leadId,
  current,
  onUpdate,
}: {
  leadId: string;
  current: LeadStatus;
  onUpdate: (id: string, status: LeadStatus) => void;
}) {
  const token = useAuthStore(s => s.token);
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);

  async function change(status: LeadStatus) {
    if (status === current || !token) return;
    setSaving(true);
    setOpen(false);
    try {
      await api(`/leads/${leadId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ status }),
      });
      onUpdate(leadId, status);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={saving}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400
                   hover:text-white transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 size={11} className="animate-spin" /> : <ChevronDown size={11} />}
        Mover
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20
                          bg-[#1e293b] border border-white/[.1] rounded-xl
                          shadow-2xl overflow-hidden py-1 min-w-[160px]">
            {STATUS_ORDER.map(s => (
              <button
                key={s}
                onClick={() => change(s)}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 text-xs
                  transition-colors
                  ${s === current
                    ? 'text-white bg-white/[.06] font-bold'
                    : 'text-slate-400 hover:bg-white/[.04] hover:text-white'}`}
              >
                <span className={STATUS_CONFIG[s].color}>{STATUS_CONFIG[s].icon}</span>
                {STATUS_CONFIG[s].label}
                {s === current && <CheckCircle2 size={10} className="ml-auto text-blue-400" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── HistoryModal ────────────────────────────────────────── */

const KIND_LABELS: Record<string, string> = {
  created: 'Lead criado', status_change: 'Status alterado',
  assignment: 'Atribuição', note: 'Nota', call: 'Ligação',
  email: 'E-mail', whatsapp: 'WhatsApp', visit: 'Visita', other: 'Outro',
};

function HistoryModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { token } = useAuthStore();
  const [history, setHistory] = useState<LeadHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote]       = useState('');
  const [saving, setSaving]   = useState(false);
  const [apprValue, setApprValue] = useState('');
  const [apprNote, setApprNote]   = useState('');
  const [apprSaving, setApprSaving] = useState(false);
  const [apprErro, setApprErro] = useState('');

  useEffect(() => {
    if (!token) return;
    api<LeadHistory>(`/leads/${lead.id}/history`, { token })
      .then(setHistory)
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [lead.id, token]);

  async function appraise(status: 'offered' | 'rejected' = 'offered') {
    if (!token) return;
    if (status === 'offered' && !apprValue) return;
    setApprSaving(true);
    setApprErro('');
    try {
      await api(`/leads/${lead.id}/trade-in/appraisal`, {
        token, method: 'POST',
        body: { value: status === 'offered' ? Number(apprValue) : 0, note: apprNote.trim() || undefined, status },
      });
      const updated = await api<LeadHistory>(`/leads/${lead.id}/history`, { token });
      setHistory(updated);
      setApprValue(''); setApprNote('');
    } catch (err) {
      // Sem isto o botão simplesmente parava de responder, e o vendedor não
      // tinha como saber se a avaliação foi registrada.
      setApprErro(mensagemDeErro(err));
    }
    finally { setApprSaving(false); }
  }

  async function addNote() {
    if (!token || !note.trim()) return;
    setSaving(true);
    try {
      await api(`/leads/${lead.id}/interactions`, {
        token, method: 'POST', body: { kind: 'note', content: note.trim() },
      });
      const updated = await api<LeadHistory>(`/leads/${lead.id}/history`, { token });
      setHistory(updated);
      setNote('');
    } catch { /* ignora */ }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg h-full bg-white dark:bg-slate-900 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="font-semibold text-sm">Histórico do Lead</h2>
            <p className="text-xs text-slate-500">{history?.contactName ?? history?.customer?.fullName ?? '–'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-slate-400" />
          </div>
        ) : history ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Assignee */}
            <div className="text-sm">
              <p className="text-xs font-medium text-slate-500 mb-1">Responsável</p>
              <p className="font-medium">{history.assignee?.fullName ?? 'Não atribuído'}</p>
            </div>

            {/* Trade-in (veículo na troca) */}
            {history.source === 'trade_in' && history.metadata?.tradeIn && (() => {
              const ti = history.metadata.tradeIn;
              const v = ti.vehicle ?? {};
              const fmt = (n: number | null | undefined) =>
                n == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);
              const desiredPrice = history.vehicle ? parseFloat(history.vehicle.price) : null;
              const appr = ti.appraisal;
              const appraised = appr && typeof appr.value === 'number' && appr.status !== 'pending';
              return (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 p-4">
                  <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 mb-3 flex items-center gap-1.5">
                    <Repeat size={13} /> Veículo oferecido na troca
                  </p>
                  <p className="font-bold text-sm">
                    {[v.brandName, v.modelName, v.versionName].filter(Boolean).join(' ')}
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs text-slate-600 dark:text-slate-400">
                    <span>Ano: {v.yearMake ?? '—'}/{v.yearModel ?? '—'}</span>
                    <span>KM: {v.mileageKm != null ? v.mileageKm.toLocaleString('pt-BR') : '—'}</span>
                    {v.color && <span>Cor: {v.color}</span>}
                    {v.plate && <span>Placa: {v.plate}</span>}
                    {v.isFinanced && <span className="text-amber-600 dark:text-amber-400">Financiado</span>}
                    {v.hasDebts && <span className="text-amber-600 dark:text-amber-400">Com débitos</span>}
                  </div>
                  {v.notes && <p className="text-xs text-slate-500 mt-2 italic">&ldquo;{v.notes}&rdquo;</p>}

                  <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-emerald-200/60 dark:border-emerald-900/40">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase">Referência FIPE</p>
                      <p className="text-sm font-bold">{fmt(ti.fipeReference)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase">Cliente espera</p>
                      <p className="text-sm font-bold">{fmt(ti.expectedValue)}</p>
                    </div>
                  </div>

                  {appraised ? (
                    <div className="mt-3 pt-3 border-t border-emerald-200/60 dark:border-emerald-900/40">
                      <p className="text-[10px] text-slate-500 uppercase">Sua avaliação</p>
                      <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{fmt(appr!.value)}</p>
                      {desiredPrice != null && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          Diferença a pagar no {history.vehicle?.brand.name} {history.vehicle?.model.name}:{' '}
                          <span className="font-bold text-slate-700 dark:text-slate-200">{fmt(Math.max(0, desiredPrice - (appr!.value ?? 0)))}</span>
                        </p>
                      )}
                      {appr!.note && <p className="text-xs text-slate-500 mt-1 italic">&ldquo;{appr!.note}&rdquo;</p>}
                      <button onClick={() => { setApprValue(String(appr!.value ?? '')); }}
                        className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-2 hover:underline">
                        Reavaliar
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 pt-3 border-t border-emerald-200/60 dark:border-emerald-900/40 space-y-2">
                      <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Avaliar este veículo</p>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
                        <input type="number" value={apprValue} onChange={(e) => setApprValue(e.target.value)}
                          placeholder="Valor que a loja oferece"
                          className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-emerald-500" />
                      </div>
                      <input value={apprNote} onChange={(e) => setApprNote(e.target.value)}
                        placeholder="Observação (opcional)"
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-emerald-500" />
                      <div className="flex gap-2">
                        <button onClick={() => appraise('offered')} disabled={apprSaving || !apprValue}
                          className="flex-1 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-40 flex items-center justify-center gap-1.5">
                          {apprSaving ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Enviar avaliação
                        </button>
                        <button onClick={() => appraise('rejected')} disabled={apprSaving}
                          className="px-3 py-2 text-xs font-semibold rounded-lg border border-rose-200 dark:border-rose-900/40 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition disabled:opacity-40">
                          Recusar
                        </button>
                      </div>
                      {apprErro && (
                        <p className="text-xs text-rose-600 dark:text-rose-400">{apprErro}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Timeline */}
            <div>
              <p className="text-xs font-medium text-slate-500 mb-3">Histórico</p>
              {history.interactions.length === 0 && (
                <p className="text-xs text-slate-400">Nenhuma interação registrada</p>
              )}
              <div className="space-y-3">
                {history.interactions.map((inter) => (
                  <div key={inter.id} className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{KIND_LABELS[inter.kind] ?? inter.kind}</span>
                        {inter.actor && (
                          <span className="text-xs text-slate-500">por {inter.actor.fullName}</span>
                        )}
                      </div>
                      {inter.content && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{inter.content}</p>
                      )}
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {new Date(inter.occurredAt).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Agendamentos */}
            {history.appointments.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500 mb-3">Agendamentos</p>
                <div className="space-y-2">
                  {history.appointments.map((a) => (
                    <div key={a.id} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 text-xs">
                      <p className="font-medium">{a.type} — {a.status}</p>
                      <p className="text-slate-500 mt-0.5">
                        {new Date(a.scheduledStart).toLocaleString('pt-BR')}
                      </p>
                      {a.notes && <p className="text-slate-400 mt-0.5">{a.notes}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Adicionar nota */}
        <div className="border-t border-slate-200 dark:border-slate-800 p-4">
          <div className="flex gap-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Adicionar nota ou interação…"
              rows={2}
              className="flex-1 resize-none px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500 transition"
            />
            <button
              onClick={addNote}
              disabled={!note.trim() || saving}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── LeadCard ────────────────────────────────────────────── */

function LeadCard({
  lead, onStatusChange, onShowHistory, onChat, chatLoading,
}: {
  lead: Lead;
  onStatusChange: (id: string, s: LeadStatus) => void;
  onShowHistory:  (lead: Lead) => void;
  onChat:         (lead: Lead) => void;
  chatLoading:    boolean;
}) {
  const name  = lead.customer?.fullName ?? lead.contactName ?? 'Cliente';
  const email = lead.customer?.email ?? lead.contactEmail;
  const phone = lead.customer?.phone ?? lead.contactPhone;
  const cover = lead.vehicle?.images[0]?.url;
  const tradeIn = lead.source === 'trade_in' ? lead.metadata?.tradeIn : null;
  const tv = tradeIn?.vehicle;
  const tradeInAppraised = tradeIn?.appraisal && typeof tradeIn.appraisal.value === 'number'
    && tradeIn.appraisal.status !== 'pending';

  return (
    <div className={`bg-[#1e293b] border rounded-2xl p-4 transition-all group
                    ${tradeIn ? 'border-emerald-500/30 hover:border-emerald-500/50' : 'border-white/[.06] hover:border-white/[.12]'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
            <span className="text-blue-400 text-sm font-bold">
              {name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-white truncate">{name}</p>
              {tradeIn && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide
                                 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <Repeat size={9} /> Troca
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500">{timeAgo(lead.createdAt)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={lead.status} />
          <StatusDropdown leadId={lead.id} current={lead.status} onUpdate={onStatusChange} />
        </div>
      </div>

      {/* Carro oferecido na troca */}
      {tradeIn && tv && (
        <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/[.06] border border-emerald-500/20 p-2.5 mb-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
            <Repeat size={14} className="text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-emerald-400/80 uppercase tracking-wide">Oferece na troca</p>
            <p className="text-xs font-bold text-white truncate">
              {[tv.brandName, tv.modelName, tv.versionName].filter(Boolean).join(' ')}
              {tv.yearModel ? ` ${tv.yearModel}` : ''}
            </p>
          </div>
          <span className="shrink-0 text-[10px] font-bold text-emerald-400">
            {tradeInAppraised
              ? `avaliado: ${formatPrice(String(tradeIn!.appraisal!.value))}`
              : 'a avaliar'}
          </span>
        </div>
      )}

      {/* Veículo */}
      {lead.vehicle && (
        <div className="flex items-center gap-2.5 rounded-xl bg-white/[.03] border border-white/[.05] p-2.5 mb-3">
          {cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={cover} alt="" className="w-12 h-9 rounded-lg object-cover shrink-0" />
            : <div className="w-12 h-9 rounded-lg bg-white/[.05] flex items-center justify-center shrink-0">
                <Car size={16} className="text-white/20" />
              </div>
          }
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-white truncate">
              {lead.vehicle.brand.name} {lead.vehicle.model.name} {lead.vehicle.versionName ?? ''}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-slate-500">{lead.vehicle.yearModel}</span>
              <span className="text-[10px] font-bold text-blue-400">{formatPrice(lead.vehicle.price)}</span>
            </div>
          </div>
          <Link
            href={`/veiculos/${lead.vehicle.id}`}
            className="shrink-0 text-slate-600 hover:text-slate-400 transition-colors"
            title="Ver veículo"
          >
            <ExternalLink size={12} />
          </Link>
        </div>
      )}

      {/* Mensagem */}
      {lead.message && (
        <p className="text-xs text-slate-400 leading-relaxed mb-3 italic line-clamp-2">
          &ldquo;{lead.message}&rdquo;
        </p>
      )}

      {/* Contato */}
      <div className="flex items-center gap-3 pt-2 border-t border-white/[.05]">
        {email && (
          <a href={`mailto:${email}`}
             className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-blue-400 transition-colors truncate">
            <Mail size={10} /> <span className="truncate">{email}</span>
          </a>
        )}
        {phone && (
          <a href={`tel:${phone}`}
             className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-blue-400 transition-colors shrink-0">
            <Phone size={10} /> {phone}
          </a>
        )}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {lead.customer?.id && (
            <button
              onClick={() => onChat(lead)}
              disabled={chatLoading}
              className="flex items-center gap-1 text-[10px] font-semibold text-blue-400
                         hover:text-blue-300 transition-colors disabled:opacity-50"
              title="Conversar pelo chat"
            >
              {chatLoading
                ? <Loader2 size={10} className="animate-spin" />
                : <MessageSquare size={10} />}
              Conversar
            </button>
          )}
          <button
            onClick={() => onShowHistory(lead)}
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-blue-400 transition-colors"
            title="Ver histórico"
          >
            <History size={10} /> Histórico
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Página principal ────────────────────────────────────── */

export default function LeadsPage() {
  const token = useAuthStore(s => s.token);
  const router = useRouter();

  const [leads, setLeads]         = useState<Lead[]>([]);
  const [stats, setStats]         = useState<LeadStats>({});
  const [loading, setLoading]     = useState(true);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);

  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('');
  const [search, setSearch]             = useState('');
  const [historyLead, setHistoryLead]   = useState<Lead | null>(null);
  const [csvLoading, setCsvLoading]     = useState(false);
  const [chatLoadingId, setChatLoadingId] = useState<string | null>(null);

  async function openChat(lead: Lead) {
    if (!token || !lead.customer?.id) return;
    setChatLoadingId(lead.id);
    try {
      const conv = await api<{ id: string }>('/conversations/from-lead', {
        method: 'POST', token, body: { leadId: lead.id },
      });
      router.push(`/chat?c=${conv.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Não foi possível abrir a conversa.');
      setChatLoadingId(null);
    }
  }

  const loadLeads = useCallback(async (reset = false) => {
    if (!token) return;
    setLoading(true);
    const currentPage = reset ? 1 : page;
    if (reset) setPage(1);

    const params = new URLSearchParams({ page: String(currentPage), perPage: '20' });
    if (statusFilter) params.set('status', statusFilter);

    try {
      const data = await api<LeadsResponse>(`/leads?${params}`, { token });
      setLeads(reset ? data.items : prev => [...prev, ...data.items]);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, page]);

  const loadStats = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api<LeadStats>('/leads/stats', { token });
      setStats(data);
    } catch {}
  }, [token]);

  useEffect(() => {
    loadLeads(true);
    loadStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, token]);

  function handleStatusChange(leadId: string, newStatus: LeadStatus) {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
    loadStats();
  }

  async function exportCsv() {
    if (!token) return;
    setCsvLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const apiBase = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1`;
      const res = await fetch(`${apiBase}/leads/export/csv?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `leads_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignora */ }
    finally { setCsvLoading(false); }
  }

  // Filtragem local por nome/email
  const filtered = search.trim()
    ? leads.filter(l => {
        const q = search.toLowerCase();
        return (
          (l.contactName ?? l.customer?.fullName ?? '').toLowerCase().includes(q) ||
          (l.contactEmail ?? l.customer?.email ?? '').toLowerCase().includes(q) ||
          (l.vehicle?.brand.name ?? '').toLowerCase().includes(q) ||
          (l.vehicle?.model.name ?? '').toLowerCase().includes(q)
        );
      })
    : leads;

  const totalLeads = Object.values(stats).reduce((a, b) => a + b, 0);
  const newLeads   = stats.new ?? 0;

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Leads</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {totalLeads} total
            {newLeads > 0 && <span className="ml-2 text-blue-500 font-semibold">· {newLeads} novo{newLeads !== 1 ? 's' : ''}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={csvLoading}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
            title="Exportar CSV"
          >
            {csvLoading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            CSV
          </button>
          <button
            onClick={() => { loadLeads(true); loadStats(); }}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600
                       dark:hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Stats pills */}
      <div className="flex gap-2 flex-wrap mb-5">
        <button
          onClick={() => setStatusFilter('')}
          className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
            ${!statusFilter
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent'
              : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'}`}
        >
          <Users size={11} /> Todos ({totalLeads})
        </button>
        {STATUS_ORDER.map(s => {
          const count = stats[s] ?? 0;
          if (count === 0 && s !== 'new') return null;
          const cfg = STATUS_CONFIG[s];
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s === statusFilter ? '' : s)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
                ${statusFilter === s
                  ? `${cfg.bg} ${cfg.color} border-current`
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'}`}
            >
              <span className={statusFilter === s ? cfg.color : ''}>{cfg.icon}</span>
              {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Busca */}
      <div className="relative mb-5 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome, e-mail ou veículo…"
          className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 dark:border-slate-700
                     bg-white dark:bg-slate-900 text-sm
                     outline-none focus:ring-2 focus:ring-blue-500/30 transition-all"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X size={13} />
          </button>
        )}
      </div>

      {/* Grid de leads */}
      {loading && leads.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-slate-100 dark:bg-[#1e293b] border border-slate-200 dark:border-white/[.06] p-4 animate-pulse h-44" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-white/[.04] flex items-center justify-center mb-4">
            <Users size={28} className="text-slate-300 dark:text-white/15" />
          </div>
          <p className="text-base font-bold text-slate-400 mb-1">
            {search ? 'Nenhum lead encontrado' : statusFilter ? `Sem leads ${STATUS_CONFIG[statusFilter].label.toLowerCase()}s` : 'Nenhum lead ainda'}
          </p>
          <p className="text-sm text-slate-400 dark:text-slate-600">
            {!search && !statusFilter
              ? 'Quando clientes demonstrarem interesse, os leads aparecerão aqui.'
              : 'Tente mudar os filtros.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(lead => (
              <LeadCard key={lead.id} lead={lead} onStatusChange={handleStatusChange} onShowHistory={setHistoryLead} onChat={openChat} chatLoading={chatLoadingId === lead.id} />
            ))}
          </div>

          {/* Load more */}
          {leads.length < total && !loading && !search && (
            <div className="flex justify-center mt-8">
              <button
                onClick={() => {
                  const nextPage = page + 1;
                  setPage(nextPage);
                  loadLeads();
                }}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl
                           border border-slate-200 dark:border-white/[.08]
                           text-sm font-semibold text-slate-500 dark:text-slate-300
                           hover:border-blue-500/50 hover:text-blue-500 transition-all"
              >
                Carregar mais
                <span className="text-xs opacity-60">({total - leads.length} restantes)</span>
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal de histórico */}
      {historyLead && (
        <HistoryModal lead={historyLead} onClose={() => setHistoryLead(null)} />
      )}
    </div>
  );
}
