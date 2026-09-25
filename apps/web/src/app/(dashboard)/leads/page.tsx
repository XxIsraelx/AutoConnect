'use client';

import { useState, useEffect, useCallback} from 'react';
import {
  Users, Phone, Car, Clock, CheckCircle2,
  XCircle, MessageSquare, ChevronDown, Loader2,
  Search, X, RefreshCw, ExternalLink, Download,
  History, UserCheck, Send, Repeat, Handshake, UserPlus,
  AlertTriangle, Timer, Inbox,
} from 'lucide-react';
import {
  FILTROS_DE_RESPONSAVEL, FILTROS_DE_SLA, MOTIVOS_DE_PERDA_DE_LEAD,
  rotuloDoMotivo, situacaoDoSla, type FiltroDeResponsavel, type FiltroDeSla,
  type SlaSituacao,
} from '@autoconnect/shared';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import { ContatoDoLead } from '@/components/ContatoDoLead';
import NovoLeadModal from './NovoLeadModal';

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
  assignee: TeamMember | null;
  metadata?: { tradeIn?: TradeInMeta } | null;
  /** Prazo de primeiro contato. Nulo em lead anterior à funcionalidade. */
  firstResponseDueAt: string | null;
  /** Primeira interação de saída do vendedor. Nota interna não conta. */
  firstRespondedAt: string | null;
  lostReasonCode: string | null;
  lostReason: string | null;
}

interface LeadsResponse {
  items: Lead[];
  total: number;
  page: number;
  perPage: number;
  /** Quantos segundos antes do prazo a etiqueta passa a avisar — vem da API
   *  para concordar exatamente com o filtro "vencendo". */
  slaAlertaSegundos: number;
}

/**
 * Contagens do painel.
 *
 * Virou `{ porStatus, porMotivoDePerda }`: era um mapa aberto de status, e a
 * tela somava `Object.values(...)` para o total — acrescentar os motivos
 * dentro dele somaria um objeto.
 */
interface LeadStats {
  porStatus: Partial<Record<LeadStatus, number>>;
  porMotivoDePerda: Record<string, number>;
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

const RESPONSAVEL_LABELS: Record<FiltroDeResponsavel, string> = {
  todos: 'Todos',
  meus: 'Meus leads',
  sem_responsavel: 'Sem responsável',
};

const SLA_LABELS: Record<FiltroDeSla, string> = {
  todos: 'Todos',
  no_prazo: 'No prazo',
  vencendo: 'Vencendo',
  estourado: 'Prazo estourado',
};

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

/* ── Etiqueta do prazo de primeiro contato ───────────────── */

const SLA_CONFIG: Record<SlaSituacao, { label: string; classe: string; icon: React.ReactNode } | null> = {
  // Lead anterior à funcionalidade, ou loja sem expediente: nada a exibir.
  sem_prazo: null,
  // Respondido dentro do prazo não vira selo: a tela ficaria coberta de verde
  // e o que importa — o que ainda não foi respondido — se perderia no meio.
  respondido: null,
  no_prazo: {
    label: 'No prazo',
    classe: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    icon: <Timer size={9} />,
  },
  vencendo: {
    label: 'Vencendo',
    classe: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    icon: <Timer size={9} />,
  },
  estourado: {
    label: 'Prazo estourado',
    classe: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    icon: <AlertTriangle size={9} />,
  },
  respondido_fora_do_prazo: {
    label: 'Respondido fora do prazo',
    classe: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    icon: <AlertTriangle size={9} />,
  },
};

/** "faltam 12min", "13min de atraso". */
function tempoRestante(segundos: number): string {
  const abs = Math.abs(segundos);
  const texto = abs < 60
    ? `${abs}s`
    : abs < 3600
      ? `${Math.floor(abs / 60)}min`
      : `${Math.floor(abs / 3600)}h`;
  return segundos >= 0 ? `faltam ${texto}` : `${texto} de atraso`;
}

/**
 * Em que pé está o prazo deste lead.
 *
 * A conta vem do `@autoconnect/shared` — a mesma que a API usa para calcular o
 * prazo. Duas fórmulas é como se produz uma etiqueta "no prazo" sobre um lead
 * que a API já contabilizou como estourado.
 */
function EtiquetaDeSla({ lead, alertaSegundos }: { lead: Lead; alertaSegundos: number }) {
  const { situacao, restanteSegundos } = situacaoDoSla(
    {
      criadoEm: lead.createdAt,
      prazo: lead.firstResponseDueAt,
      respondidoEm: lead.firstRespondedAt,
    },
    new Date(),
    alertaSegundos,
  );

  const cfg = SLA_CONFIG[situacao];
  if (!cfg) return null;

  return (
    <span
      title={lead.firstResponseDueAt
        ? `Prazo de primeiro contato: ${new Date(lead.firstResponseDueAt).toLocaleString('pt-BR')}`
        : undefined}
      className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide
                  px-1.5 py-0.5 rounded-full border ${cfg.classe}`}
    >
      {cfg.icon} {cfg.label}
      {restanteSegundos != null && (
        <span className="font-semibold normal-case opacity-80">
          · {tempoRestante(restanteSegundos)}
        </span>
      )}
    </span>
  );
}

/* ── Atribuir vendedor ───────────────────────────────────── */

/**
 * Atribuição do lead a um vendedor.
 *
 * A tela mostrava "Responsável: Não atribuído" e não oferecia como mudar — o
 * endpoint existia desde sempre e nenhuma tela o chamava. Sem isto o gerente
 * não distribui a fila, e a comissão, que é por vendedor, não tem a quem ir.
 */
function AtribuirVendedor({
  lead, onAtribuido,
}: {
  lead: Lead;
  onAtribuido: () => void;
}) {
  const token = useAuthStore(s => s.token);
  const [aberto, setAberto] = useState(false);
  const [equipe, setEquipe] = useState<TeamMember[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || equipe || !token) return;
    api<TeamMember[]>('/users', { token })
      .then(setEquipe)
      .catch((e) => setErro(textoDoErro(e)));
  }, [aberto, equipe, token]);

  async function atribuir(salesPersonId: string | null) {
    if (!token) return;
    setSalvando(true);
    setErro(null);
    try {
      await api(`/leads/${lead.id}/assign`, {
        method: 'PATCH', token, body: { salesPersonId },
      });
      setAberto(false);
      onAtribuido();
    } catch (e) {
      setErro(textoDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setAberto(v => !v)}
        disabled={salvando}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400
                   hover:text-brand-accent transition-colors disabled:opacity-50"
      >
        {salvando ? <Loader2 size={11} className="animate-spin" /> : <UserCheck size={11} />}
        {lead.assignee ? lead.assignee.fullName.split(' ')[0] : 'Atribuir'}
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-xl border
                          border-slate-200 dark:border-white/[.08] bg-white dark:bg-[#1e293b]
                          shadow-xl overflow-hidden">
            {!equipe ? (
              <p className="px-3 py-2 text-xs text-slate-400">carregando…</p>
            ) : (
              <>
                {lead.assignee && (
                  <button
                    onClick={() => void atribuir(null)}
                    className="w-full text-left px-3 py-2 text-xs text-slate-500
                               hover:bg-slate-100 dark:hover:bg-white/[.06] transition"
                  >
                    Remover atribuição
                  </button>
                )}
                {equipe
                  .filter(m => m.id !== lead.assignee?.id)
                  .map(m => (
                    <button
                      key={m.id}
                      onClick={() => void atribuir(m.id)}
                      className="w-full text-left px-3 py-2 text-xs
                                 hover:bg-slate-100 dark:hover:bg-white/[.06] transition"
                    >
                      {m.fullName}
                    </button>
                  ))}
              </>
            )}
          </div>
        </>
      )}

      {erro && (
        <p className="absolute right-0 top-full mt-1 z-30 w-56 text-[11px] rounded-lg
                      bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900
                      text-rose-700 dark:text-rose-300 px-2 py-1.5">
          {erro}
          <button onClick={() => setErro(null)} className="block mt-1 underline">fechar</button>
        </p>
      )}
    </div>
  );
}

/* ── Abrir negócio a partir do lead ──────────────────────── */

/**
 * O caminho lead → negócio.
 *
 * Existe porque `won` passou a exigir um negócio ligado ao lead: sem este
 * botão, marcar o lead como ganho era impossível pela interface, e o erro 409
 * não dizia por onde começar.
 *
 * O negócio herda do lead o veículo e o cliente — que é o motivo de vir por
 * aqui em vez da tela do veículo: o vínculo com o comprador já está feito.
 */
function AbrirNegocio({ lead }: { lead: Lead }) {
  const token = useAuthStore(s => s.token);
  const router = useRouter();
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Sem veículo não há negócio: o valor da venda vem do carro.
  if (!lead.vehicle) return null;
  if (lead.status === 'lost' || lead.status === 'archived') return null;

  async function abrir() {
    if (!token || !lead.vehicle) return;
    setAbrindo(true);
    setErro(null);
    try {
      const negocio = await api<{ id: string }>('/deals', {
        method: 'POST',
        token,
        body: {
          vehicleId: lead.vehicle.id,
          leadId: lead.id,
          ...(lead.customer ? { customerUserId: lead.customer.id } : {}),
          listPrice: lead.vehicle.price,
          discount: '0',
          saleValue: lead.vehicle.price,
        },
      });
      router.push(`/negocios/${negocio.id}`);
    } catch (e) {
      // 409 quando o carro já tem negócio vivo — mensagem do backend serve.
      setErro(textoDoErro(e));
    } finally {
      setAbrindo(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => void abrir()}
        disabled={abrindo}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400
                   hover:text-brand-accent transition-colors disabled:opacity-50"
      >
        {abrindo ? <Loader2 size={11} className="animate-spin" /> : <Handshake size={11} />}
        Negócio
      </button>
      {erro && (
        <p className="absolute right-0 top-full mt-1 z-30 w-56 text-[11px] rounded-lg
                      bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900
                      text-rose-700 dark:text-rose-300 px-2 py-1.5">
          {erro}
          <button onClick={() => setErro(null)} className="block mt-1 underline">fechar</button>
        </p>
      )}
    </div>
  );
}

/* ── VeiculoDoLead ───────────────────────────────────────── */

/**
 * Vincula (ou corrige) o veículo de interesse do lead.
 *
 * É o que faltava para o lead de balcão e o de telefone existirem de verdade:
 * eles nascem sem carro — quem entra na loja ainda está escolhendo — e, sem
 * veículo, não há botão de negócio. "Completar depois" era uma promessa que o
 * produto não cumpria, porque `PATCH /leads/:id` só movia status.
 *
 * O estoque é pedido só quando o menu abre: o card não vai buscar 100 veículos
 * por lead da lista.
 */
function VeiculoDoLead({ lead, onAtualizado }: { lead: Lead; onAtualizado: (l: Lead) => void }) {
  const token = useAuthStore(s => s.token);
  const [aberto, setAberto] = useState(false);
  const [estoque, setEstoque] = useState<LeadVehicle[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || estoque || !token) return;
    api<{ items: LeadVehicle[] }>('/vehicles?status=available&perPage=100', { token })
      .then((v) => setEstoque(v.items ?? []))
      .catch((e) => setErro(textoDoErro(e)));
  }, [aberto, estoque, token]);

  if (lead.status === 'lost' || lead.status === 'archived') return null;

  async function vincular(vehicleId: string | null) {
    if (!token) return;
    setSalvando(true);
    setErro(null);
    try {
      const atualizado = await api<Lead>(`/leads/${lead.id}`, {
        method: 'PATCH', token, body: { vehicleId },
      });
      setAberto(false);
      onAtualizado(atualizado);
    } catch (e) {
      setErro(textoDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setAberto(v => !v)}
        disabled={salvando}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400
                   hover:text-brand-accent transition-colors disabled:opacity-50"
      >
        {salvando ? <Loader2 size={11} className="animate-spin" /> : <Car size={11} />}
        {lead.vehicle ? 'Trocar veículo' : 'Vincular veículo'}
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-64 max-h-72 overflow-y-auto
                          rounded-xl border borda bg-white dark:bg-[#0f172a] shadow-xl p-1">
            {erro ? (
              <p className="text-[11px] text-rose-500 px-2 py-1.5">{erro}</p>
            ) : !estoque ? (
              <p className="text-[11px] text-slate-500 px-2 py-1.5">Carregando estoque…</p>
            ) : estoque.length === 0 ? (
              <p className="text-[11px] text-slate-500 px-2 py-1.5">
                Nenhum veículo disponível no estoque.
              </p>
            ) : (
              estoque.map((v) => (
                <button
                  key={v.id}
                  onClick={() => void vincular(v.id)}
                  disabled={salvando || v.id === lead.vehicle?.id}
                  className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg
                             hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-40"
                >
                  {v.brand.name} {v.model.name} {v.versionName ?? ''}
                  <span className="text-slate-500"> · {v.yearModel}</span>
                </button>
              ))
            )}
            {lead.vehicle && (
              <button
                onClick={() => void vincular(null)}
                disabled={salvando}
                className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg text-rose-500
                           hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50
                           border-t borda mt-1 pt-2"
              >
                Remover vínculo
              </button>
            )}
          </div>
        </>
      )}
    </div>
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
  /** Recebe o lead **como a API o gravou** — ver o comentário em `change`. */
  onUpdate: (lead: Lead) => void;
}) {
  const token = useAuthStore(s => s.token);
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [erro, setErro]     = useState<string | null>(null);
  // Segundo passo do menu: perder exige motivo, e a API recusa sem ele.
  const [escolhendoMotivo, setEscolhendoMotivo] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState('');

  function fechar() {
    setOpen(false);
    setEscolhendoMotivo(false);
    setMotivo(null);
    setDetalhe('');
  }

  async function change(status: LeadStatus, perda?: { codigo: string; texto: string }) {
    if (status === current || !token) return;
    setSaving(true);
    setErro(null);
    try {
      // A resposta é o lead gravado, e é ela que entra na lista. A atualização
      // otimista anterior copiava só o status: o card mostrava "SEM MOTIVO
      // INFORMADO" logo depois de o vendedor escolher o motivo, com o código
      // certo no banco — e convidava a escolher de novo.
      const atualizado = await api<Lead>(`/leads/${leadId}`, {
        method: 'PATCH',
        token,
        body: {
          status,
          ...(perda
            ? { lostReasonCode: perda.codigo, ...(perda.texto ? { lostReason: perda.texto } : {}) }
            : {}),
        },
      });
      fechar();
      onUpdate(atualizado);
    } catch (err) {
      // Antes ia só para o console: mover para "Ganho" sem negócio ligado é
      // recusado com 409, e a tela não dava sinal nenhum — o clique
      // simplesmente não fazia nada.
      setErro(textoDoErro(err));
    } finally {
      setSaving(false);
    }
  }

  function escolher(status: LeadStatus) {
    if (status === 'lost') {
      // Não fecha o menu: ele vira a lista de motivos. Abrir outro modal aqui
      // esconderia de qual lead se está falando.
      setEscolhendoMotivo(true);
      return;
    }
    setOpen(false);
    void change(status);
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
      {erro && (
        <p className="absolute right-0 top-full mt-1 z-30 w-56 text-[11px] rounded-lg
                      bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900
                      text-rose-700 dark:text-rose-300 px-2 py-1.5">
          {erro}
          <button onClick={() => setErro(null)} className="block mt-1 underline">fechar</button>
        </p>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={fechar} />
          <div className="absolute right-0 top-full mt-1 z-20
                          bg-white dark:bg-[#1e293b] border border-white/[.1] rounded-xl
                          shadow-2xl overflow-hidden py-1 w-[230px] max-w-[85vw]">
            {!escolhendoMotivo ? (
              STATUS_ORDER.map(s => (
                <button
                  key={s}
                  onClick={() => escolher(s)}
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
              ))
            ) : (
              <div className="py-1">
                <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Por que foi perdido?
                </p>
                {MOTIVOS_DE_PERDA_DE_LEAD.map((m) => (
                  <button
                    key={m.codigo}
                    disabled={saving}
                    onClick={() => {
                      // "Outro" abre o campo de texto; os demais já bastam.
                      if (m.codigo === 'outro') { setMotivo('outro'); return; }
                      void change('lost', { codigo: m.codigo, texto: '' });
                    }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors
                      ${motivo === m.codigo
                        ? 'text-white bg-white/[.06] font-bold'
                        : 'text-slate-400 hover:bg-white/[.04] hover:text-white'}`}
                  >
                    {m.rotulo}
                  </button>
                ))}

                {motivo === 'outro' && (
                  <div className="px-3 pt-2 pb-1 space-y-2">
                    <textarea
                      value={detalhe}
                      onChange={(e) => setDetalhe(e.target.value)}
                      rows={2}
                      autoFocus
                      placeholder="Descreva o motivo"
                      className="w-full resize-none px-2 py-1.5 text-xs rounded-lg
                                 border border-slate-200 dark:border-slate-700
                                 bg-slate-50 dark:bg-slate-800 outline-none
                                 focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      disabled={saving || !detalhe.trim()}
                      onClick={() => void change('lost', { codigo: 'outro', texto: detalhe.trim() })}
                      className="w-full py-1.5 text-xs font-bold rounded-lg bg-rose-600 text-white
                                 hover:bg-rose-700 transition disabled:opacity-40"
                    >
                      Marcar como perdido
                    </button>
                  </div>
                )}

                <button
                  onClick={() => { setEscolhendoMotivo(false); setMotivo(null); setDetalhe(''); }}
                  className="w-full text-left px-3 py-2 mt-1 text-[11px] text-slate-500
                             hover:bg-white/[.04] transition-colors border-t border-white/[.06]"
                >
                  ← Voltar
                </button>
              </div>
            )}
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
  // Escrito pela deduplicação: o mesmo contato chegou de novo e virou
  // interação neste lead, em vez de um cartão novo no funil.
  duplicate: 'Contato repetido', trade_in_appraisal: 'Avaliação da troca',
  // Escritas pelo sistema, sem ator: a distribuição automática e o estouro do
  // prazo de primeiro contato.
  rotation: 'Rodízio', sla_breach: 'Prazo estourado',
};

function HistoryModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { token } = useAuthStore();
  const [history, setHistory] = useState<LeadHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote]       = useState('');
  const [saving, setSaving]   = useState(false);
  const [erroNota, setErroNota] = useState('');
  const [apprValue, setApprValue] = useState('');
  const [apprNote, setApprNote]   = useState('');
  const [apprSaving, setApprSaving] = useState(false);
  const [apprErro, setApprErro] = useState('');

  const [erroHistorico, setErroHistorico] = useState<unknown>(null);

  const carregarHistorico = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setErroHistorico(null);
    api<LeadHistory>(`/leads/${lead.id}/history`, { token })
      .then(setHistory)
      // Antes o erro era descartado e o painel abria vazio, como se o lead
      // não tivesse histórico nenhum.
      .catch(setErroHistorico)
      .finally(() => setLoading(false));
  }, [lead.id, token]);

  useEffect(() => { carregarHistorico(); }, [carregarHistorico]);

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
      setApprErro(textoDoErro(err));
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
      setErroNota('');
    } catch (err) {
      // A nota sumia do campo sem ter sido salva.
      setErroNota(textoDoErro(err));
    }
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
        ) : erroHistorico ? (
          <div className="flex-1 overflow-y-auto">
            <ErroAoCarregar erro={erroHistorico} onTentarNovamente={carregarHistorico} carregando={loading} contexto="o histórico" />
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
          {erroNota && (
            <p className="text-xs text-rose-600 dark:text-rose-400 mt-1.5">{erroNota}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── LeadCard ────────────────────────────────────────────── */

function LeadCard({
  lead, onStatusChange, onShowHistory, onChat, chatLoading, onRecarregar, slaAlerta,
}: {
  lead: Lead;
  onStatusChange: (lead: Lead) => void;
  onRecarregar:   () => void;
  onShowHistory:  (lead: Lead) => void;
  onChat:         (lead: Lead) => void;
  chatLoading:    boolean;
  slaAlerta:      number;
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
    <div className={`bg-white dark:bg-[#1e293b] border rounded-2xl p-4 transition-all group
                    ${tradeIn ? 'border-emerald-500/30 hover:border-emerald-500/50' : 'border-slate-200 dark:border-white/[.06] hover:border-slate-300 dark:hover:border-white/[.12]'}`}>
      {/* Header */}
      {/* Cabeçalho: só identidade. As ações ficavam aqui num grupo shrink-0 e,
          quando passaram de uma para três, ocuparam 265 dos 286px da linha — o
          nome do cliente ficava com 0px e o selo caía em cima do avatar. */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
            <span className="text-blue-600 dark:text-blue-400 text-sm font-bold">
              {name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold txt-forte truncate">{name}</p>
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
        <div className="shrink-0">
          <StatusBadge status={lead.status} />
        </div>
      </div>

      {/* Prazo de primeiro contato e motivo da perda — o que o gerente procura
          ao bater o olho na fila. */}
      {(lead.status === 'lost' || lead.firstResponseDueAt) && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {lead.status !== 'lost' && (
            <EtiquetaDeSla lead={lead} alertaSegundos={slaAlerta} />
          )}
          {lead.status === 'lost' && (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase
                             tracking-wide px-1.5 py-0.5 rounded-full border
                             bg-rose-500/10 text-rose-400 border-rose-500/25">
              <XCircle size={9} /> {rotuloDoMotivo(lead.lostReasonCode)}
            </span>
          )}
          {lead.status === 'lost' && lead.lostReason && (
            <span className="text-[10px] text-slate-500 truncate max-w-full">
              {lead.lostReason}
            </span>
          )}
        </div>
      )}

      {/* Ações em linha própria, com quebra: aguenta ação nova sem voltar a
          espremer o nome. Alinhadas à direita porque os menus suspensos abrem
          ancorados na direita — à esquerda eles vazariam pela borda do card. */}
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 mb-3">
        <AtribuirVendedor lead={lead} onAtribuido={onRecarregar} />
        <VeiculoDoLead lead={lead} onAtualizado={onStatusChange} />
        <AbrirNegocio lead={lead} />
        <StatusDropdown leadId={lead.id} current={lead.status} onUpdate={onStatusChange} />
      </div>

      {/* Carro oferecido na troca */}
      {tradeIn && tv && (
        <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/[.06] border border-emerald-500/20 p-2.5 mb-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
            <Repeat size={14} className="text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-emerald-400/80 uppercase tracking-wide">Oferece na troca</p>
            <p className="text-xs font-bold txt-forte truncate">
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
        <div className="flex items-center gap-2.5 rounded-xl sup-tenue border borda p-2.5 mb-3">
          {cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={cover} alt="" className="w-12 h-9 rounded-lg object-cover shrink-0" />
            : <div className="w-12 h-9 rounded-lg sup-fraca flex items-center justify-center shrink-0">
                <Car size={16} className="text-slate-300 dark:text-white/20" />
              </div>
          }
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold txt-forte truncate">
              {lead.vehicle.brand.name} {lead.vehicle.model.name} {lead.vehicle.versionName ?? ''}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-slate-500">{lead.vehicle.yearModel}</span>
              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">{formatPrice(lead.vehicle.price)}</span>
            </div>
          </div>
          <Link
            href={`/veiculos/${lead.vehicle.id}`}
            className="shrink-0 text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 transition-colors"
            title="Ver veículo"
          >
            <ExternalLink size={12} />
          </Link>
        </div>
      )}

      {/* Mensagem */}
      {lead.message && (
        <p className="text-xs txt-fraco leading-relaxed mb-3 italic line-clamp-2">
          &ldquo;{lead.message}&rdquo;
        </p>
      )}

      {/* Contato — cada clique vira interação na timeline */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-2 border-t borda">
        <ContatoDoLead leadId={lead.id} phone={phone} email={email} compacto />
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {lead.customer?.id && (
            <button
              onClick={() => onChat(lead)}
              disabled={chatLoading}
              className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400
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
  const [stats, setStats]         = useState<LeadStats>({ porStatus: {}, porMotivoDePerda: {} });
  const [loading, setLoading]     = useState(true);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [erro, setErro]           = useState<unknown>(null);
  const [erroStats, setErroStats] = useState(false);

  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('');
  const [responsavel, setResponsavel] = useState<FiltroDeResponsavel>('todos');
  const [filtroSla, setFiltroSla]     = useState<FiltroDeSla>('todos');
  // Vem da API junto da lista: é o mesmo número que o filtro "vencendo" usou,
  // e é o que faz etiqueta e filtro concordarem.
  const [slaAlerta, setSlaAlerta]     = useState(225);
  const [search, setSearch]             = useState('');
  const [historyLead, setHistoryLead]   = useState<Lead | null>(null);
  const [csvLoading, setCsvLoading]     = useState(false);
  const [erroCsv, setErroCsv]           = useState('');
  const [chatLoadingId, setChatLoadingId] = useState<string | null>(null);
  const [novoLead, setNovoLead]           = useState(false);
  const [avisoDeDedupe, setAvisoDeDedupe] = useState(false);

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

  // A página vem por argumento: logo após `setPage`, o `page` desta closure
  // ainda é o antigo, e "Carregar mais" rebuscava a página 1 duplicando leads.
  const loadLeads = useCallback(async (reset = false, pagina?: number) => {
    if (!token) return;
    setLoading(true);
    const currentPage = reset ? 1 : (pagina ?? page);
    if (reset) setPage(1);

    const params = new URLSearchParams({ page: String(currentPage), perPage: '20' });
    if (statusFilter) params.set('status', statusFilter);
    if (responsavel !== 'todos') params.set('responsavel', responsavel);
    if (filtroSla !== 'todos')   params.set('sla', filtroSla);

    setErro(null);
    try {
      const data = await api<LeadsResponse>(`/leads?${params}`, { token });
      setLeads(reset ? data.items : prev => [...prev, ...data.items]);
      setTotal(data.total);
      setSlaAlerta(data.slaAlertaSegundos);
    } catch (err) {
      // Antes só ia para o console: a tela mostrava "Nenhum lead ainda" e o
      // vendedor concluía que não havia fila para atender.
      setErro(err);
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, responsavel, filtroSla, page]);

  const loadStats = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api<LeadStats>('/leads/stats', { token });
      setStats(data);
      setErroStats(false);
    } catch {
      // Sem a contagem, "0 total" seria mentira: o cabeçalho avisa (ver JSX).
      setErroStats(true);
    }
  }, [token]);

  useEffect(() => {
    loadLeads(true);
    loadStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, responsavel, filtroSla, token]);

  /**
   * Substitui o lead da lista pelo que a API devolveu.
   *
   * Não é otimismo: a resposta do PATCH é a linha gravada, com motivo da perda
   * e veículo já no formato do card. Copiar só o campo alterado é o que fazia
   * o motivo aparecer como "sem motivo informado" até recarregar a página.
   */
  function handleLeadAtualizado(atualizado: Lead) {
    setLeads(prev => prev.map(l => (l.id === atualizado.id ? { ...l, ...atualizado } : l)));
    loadStats();
  }

  async function exportCsv() {
    if (!token) return;
    setCsvLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      // O CSV segue os mesmos filtros da tela: baixar algo diferente do que
      // está à vista é como o vendedor conclui que a exportação está quebrada.
      if (responsavel !== 'todos') params.set('responsavel', responsavel);
      const apiBase = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1`;
      const res = await fetch(`${apiBase}/leads/export/csv?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // fetch não lança em 4xx/5xx: sem isto o corpo do erro era baixado
      // como se fosse o CSV.
      if (!res.ok) throw new ApiError(res.status, `Falha ao exportar (HTTP ${res.status})`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `leads_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setErroCsv('');
    } catch (err) {
      // Nenhum arquivo baixava e nada indicava o motivo.
      setErroCsv(textoDoErro(err));
    }
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

  const totalLeads = Object.values(stats.porStatus).reduce((a, b) => a + b, 0);
  const newLeads   = stats.porStatus.new ?? 0;

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Leads</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {erroStats ? (
              <span className="text-rose-600 dark:text-rose-400">
                Contagem indisponível ·{' '}
                <button onClick={loadStats} className="underline hover:no-underline">tentar novamente</button>
              </span>
            ) : (
              <>
                {totalLeads} total
                {newLeads > 0 && <span className="ml-2 text-blue-500 font-semibold">· {newLeads} novo{newLeads !== 1 ? 's' : ''}</span>}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setAvisoDeDedupe(false); setNovoLead(true); }}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg
                       whitespace-nowrap bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            <UserPlus size={13} />
            Novo lead
          </button>
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

      {avisoDeDedupe && (
        <p className="text-xs rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200
                      dark:border-amber-900/40 text-amber-700 dark:text-amber-300 px-3 py-2 mb-4">
          Esse contato já tinha um lead aberto nos últimos 30 dias. Registramos o
          atendimento no lead que já existia, em vez de criar outro.{' '}
          <button onClick={() => setAvisoDeDedupe(false)} className="underline">ok</button>
        </p>
      )}

      {erroCsv && (
        <p className="text-xs text-rose-600 dark:text-rose-400 -mt-2">
          Falha ao exportar: {erroCsv}
        </p>
      )}

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
          const count = stats.porStatus[s] ?? 0;
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

      {/* Por que a loja não vendeu. Aparece só quando há perda registrada:
          uma faixa vazia ensinaria o vendedor a ignorá-la. */}
      {Object.keys(stats.porMotivoDePerda).length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-5 text-[11px]">
          <span className="font-semibold text-slate-400 uppercase tracking-wide">
            Perdas por motivo
          </span>
          {Object.entries(stats.porMotivoDePerda)
            .sort(([, a], [, b]) => b - a)
            .map(([codigo, quantos]) => (
              <span key={codigo} className="text-slate-500">
                {codigo === 'sem_motivo' ? 'Sem motivo informado' : rotuloDoMotivo(codigo)}
                <span className="ml-1 font-bold text-slate-400">{quantos}</span>
              </span>
            ))}
        </div>
      )}

      {/* Responsável e prazo — os dois recortes que o gerente usa para achar
          o que está parado. "Sem responsável" é a fila: sem esse filtro, o
          lead que o rodízio não conseguiu distribuir some no meio dos outros. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5">
        <div className="flex flex-wrap gap-1.5">
          {FILTROS_DE_RESPONSAVEL.map((f) => (
            <button
              key={f}
              onClick={() => setResponsavel(f)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5
                          rounded-full border transition-all
                ${responsavel === f
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'}`}
            >
              {f === 'todos' && <Users size={11} />}
              {f === 'meus' && <UserCheck size={11} />}
              {f === 'sem_responsavel' && <Inbox size={11} />}
              {RESPONSAVEL_LABELS[f]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTROS_DE_SLA.filter((f) => f !== 'todos').map((f) => (
            <button
              key={f}
              onClick={() => setFiltroSla(filtroSla === f ? 'todos' : f)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5
                          rounded-full border transition-all
                ${filtroSla === f
                  ? f === 'estourado'
                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/40'
                    : f === 'vencendo'
                      ? 'bg-amber-500/15 text-amber-400 border-amber-500/40'
                      : 'bg-slate-500/15 text-slate-300 border-slate-500/40'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'}`}
            >
              {f === 'estourado' ? <AlertTriangle size={11} /> : <Timer size={11} />}
              {SLA_LABELS[f]}
            </button>
          ))}
        </div>
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
            <div key={i} className="rounded-2xl bg-slate-100 dark:bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-200 dark:border-white/[.06] p-4 animate-pulse h-44" />
          ))}
        </div>
      ) : erro && leads.length === 0 ? (
        <ErroAoCarregar erro={erro} onTentarNovamente={() => loadLeads(true)} carregando={loading} contexto="os leads" />
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
              <LeadCard key={lead.id} lead={lead} onStatusChange={handleLeadAtualizado} onShowHistory={setHistoryLead} onChat={openChat} chatLoading={chatLoadingId === lead.id} onRecarregar={() => loadLeads(true)} slaAlerta={slaAlerta} />
            ))}
          </div>

          {/* Falha ao carregar mais: os leads já exibidos continuam na tela. */}
          {erro && leads.length > 0 && (
            <p className="text-xs text-rose-600 dark:text-rose-400 text-center mt-6">
              Não foi possível carregar mais leads: {textoDoErro(erro)}
            </p>
          )}

          {/* Load more */}
          {leads.length < total && !loading && !search && (
            <div className="flex justify-center mt-8">
              <button
                onClick={() => {
                  const nextPage = page + 1;
                  setPage(nextPage);
                  loadLeads(false, nextPage);
                }}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl
                           border border-slate-200 dark:border-slate-200 dark:border-white/[.08]
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

      {/* Cadastro manual — quem chegou por telefone, WhatsApp ou balcão */}
      {novoLead && (
        <NovoLeadModal
          onClose={() => setNovoLead(false)}
          onCriado={(deduplicado) => {
            setNovoLead(false);
            setAvisoDeDedupe(deduplicado);
            loadLeads(true);
            loadStats();
          }}
        />
      )}
    </div>
  );
}
