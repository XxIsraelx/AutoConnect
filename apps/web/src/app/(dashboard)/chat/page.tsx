'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Send, MessageSquare, Circle, Loader2,
  RefreshCw, AlertCircle, ChevronLeft, BadgeDollarSign, X, Archive,
  Link as LinkIcon, MessageCircle, Clock, Check, CheckCheck, FileText,
} from 'lucide-react';
import {
  MODELOS_DE_WHATSAPP, MODELOS_MANUAIS, formatarTelefoneBr, janelaDeAtendimentoAberta,
  janelaFechaEm, type ChaveDoModelo,
} from '@autoconnect/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';
import ProposalBubble, { getProposal } from '@/components/chat/ProposalBubble';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';

/* ── Tipos ─────────────────────────────────────────────── */
interface Conversation {
  id: string;
  status: string;
  lastMessageAt: string | null;
  /**
   * Nulo quando a conversa é de um lead **sem conta** — o caso da Onda 0, que
   * até aqui não tinha chat nenhum. Aí quem identifica é o contato copiado.
   */
  customer: { id: string; fullName: string; email: string; avatarUrl: string | null } | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  salesperson: { id: string; fullName: string; email: string } | null;
  vehicle: { id: string; versionName: string | null; yearModel: number; brand: { name: string }; model: { name: string }; images: { url: string }[] } | null;
  messages: { body: string; createdAt: string; kind: string }[];
  /** `whatsapp`: entra e sai pelo número oficial da loja. */
  channel: 'chat' | 'whatsapp';
  /** Última mensagem do cliente — no WhatsApp, abre e fecha a janela de 24 h. */
  customerLastMessageAt: string | null;
  contactPhoneNormalized: string | null;
}

interface Message {
  id: string;
  conversationId?: string;
  body: string;
  kind: string;
  createdAt: string;
  senderUserId: string | null;
  sender: { id: string; fullName: string; avatarUrl: string | null } | null;
  metadata?: unknown;
  /** Só no que a loja mandou pelo WhatsApp: enviando → enviada → entregue → lida, ou falhou. */
  deliveryStatus?: string | null;
  failureReason?: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Com quem é a conversa — com conta ou sem. */
function nomeDoContato(conv: Conversation): string {
  return conv.customer?.fullName ?? conv.contactName ?? 'Visitante';
}

/**
 * Conversa de quem não tem conta: entra por link, não por login. A de
 * WhatsApp também não tem conta, mas não precisa de link — o cliente responde
 * pelo próprio WhatsApp.
 */
function semConta(conv: Conversation): boolean {
  return !conv.customer && conv.channel !== 'whatsapp';
}

function ehWhatsApp(conv: Conversation | undefined): boolean {
  return conv?.channel === 'whatsapp';
}

/** Insere ou substitui pelo id: o socket e a resposta do POST trazem a mesma mensagem. */
function comMensagem(lista: Message[], msg: Message): Message[] {
  return lista.some((m) => m.id === msg.id)
    ? lista.map((m) => (m.id === msg.id ? msg : m))
    : [...lista, msg];
}

/** O texto do modelo com os campos no lugar dos números, para a prévia. */
function previaDoModelo(chave: ChaveDoModelo): string {
  const m = MODELOS_DE_WHATSAPP[chave];
  return m.texto.replace(/\{\{(\d+)\}\}/g, (_, n: string) => `[${m.campos[Number(n) - 1]}]`);
}

/** O que aconteceu com a mensagem que a loja mandou pelo WhatsApp. */
function StatusDeEntrega({ msg }: { msg: Message }) {
  switch (msg.deliveryStatus) {
    case 'enviando': return <Clock size={11} aria-label="enviando" />;
    case 'enviada':  return <Check size={11} aria-label="enviada" />;
    case 'entregue': return <CheckCheck size={11} aria-label="entregue" />;
    case 'lida':     return <CheckCheck size={11} className="text-emerald-300" aria-label="lida" />;
    case 'falhou':   return <AlertCircle size={11} className="text-rose-200" aria-label="não enviada" />;
    default:         return null;
  }
}

/* ── Helpers ──────────────────────────────────────────── */
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  const diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (diff === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

/* ── Componente da lista de conversas ───────────────────── */
function ConversationItem({ conv, active, onClick }: {
  conv: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  const last = conv.messages[0];
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left transition-all',
        active
          ? 'bg-blue-50 dark:bg-blue-950/20 border-r-2 border-blue-600'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
      )}
    >
      <div className="relative shrink-0">
        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
          <span className="text-blue-600 dark:text-blue-400 text-sm font-bold">
            {nomeDoContato(conv).charAt(0).toUpperCase()}
          </span>
        </div>
        {conv.status === 'open' && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-slate-900" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <p className="text-sm font-medium truncate">
            {nomeDoContato(conv)}
            {semConta(conv) && (
              <span className="ml-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                sem conta
              </span>
            )}
            {ehWhatsApp(conv) && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                <MessageCircle size={10} /> WhatsApp
              </span>
            )}
          </p>
          {conv.lastMessageAt && (
            <span className="text-xs text-slate-400 shrink-0">{fmtDate(conv.lastMessageAt)}</span>
          )}
        </div>
        {conv.vehicle && (
          <p className="text-xs text-blue-500 truncate mb-0.5">
            {conv.vehicle.brand.name} {conv.vehicle.model.name} {conv.vehicle.yearModel}
          </p>
        )}
        {last && (
          <p className="text-xs text-slate-500 truncate">{last.body}</p>
        )}
      </div>
    </button>
  );
}

/* ── Página principal ──────────────────────────────────── */
export default function ChatPage() {
  const { token, user } = useAuthStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId,      setActiveId]      = useState<string | null>(null);
  const [messages,      setMessages]      = useState<Message[]>([]);
  const [newMsg,        setNewMsg]        = useState('');
  const [loadingConvs,  setLoadingConvs]  = useState(true);
  const [erroConvs,     setErroConvs]     = useState<unknown>(null);
  const [loadingMsgs,   setLoadingMsgs]   = useState(false);
  const [erroMsgs,      setErroMsgs]      = useState<unknown>(null);
  const [tentativaMsgs, setTentativaMsgs] = useState(0);
  const [sending,       setSending]       = useState(false);
  const [typingUsers,   setTypingUsers]   = useState<Set<string>>(new Set());
  const [showProposal,  setShowProposal]  = useState(false);
  const socketRef  = useRef<Socket | null>(null);
  const msgsEndRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<NodeJS.Timeout | null>(null);

  const activeConv = conversations.find((c) => c.id === activeId);
  // O handler do socket é registrado uma vez; é pela ref que ele sabe qual
  // conversa está na tela.
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [modeloAberto, setModeloAberto] = useState(false);
  const [modelo, setModelo] = useState<ChaveDoModelo>('primeiro_contato');
  const [enviandoModelo, setEnviandoModelo] = useState(false);
  useEffect(() => { setErroEnvio(null); setModeloAberto(false); }, [activeId]);

  async function enviarModelo() {
    if (!token || !activeId || enviandoModelo) return;
    setEnviandoModelo(true);
    setErroEnvio(null);
    try {
      const msg = await api<Message>(`/whatsapp/conversas/${activeId}/modelo`, {
        method: 'POST', token, body: { modelo },
      });
      setMessages((prev) => comMensagem(prev, msg));
      setModeloAberto(false);
      if (msg.deliveryStatus === 'falhou') setErroEnvio(msg.failureReason ?? 'O WhatsApp recusou o modelo.');
    } catch (err) {
      setErroEnvio(textoDoErro(err));
    } finally {
      setEnviandoModelo(false);
    }
  }

  const [encerrando, setEncerrando] = useState(false);
  const [erroEncerrar, setErroEncerrar] = useState<string | null>(null);

  /**
   * Link de acesso do visitante sem conta.
   *
   * O banco guarda o hash, como no convite de equipe: o link cru só existe no
   * instante em que é gerado. Pedir outro invalida o anterior — a tela diz isso
   * antes, porque o cliente pode já estar com um aberto.
   */
  const [linkVisitante, setLinkVisitante] = useState<string | null>(null);
  const [gerandoLink, setGerandoLink] = useState(false);
  const [erroLink, setErroLink] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function gerarLink(conversationId: string) {
    if (!token) return;
    setGerandoLink(true);
    setErroLink(null);
    try {
      const r = await api<{ guestUrl: string }>(`/conversations/${conversationId}/guest-link`, {
        method: 'POST', token,
      });
      setLinkVisitante(r.guestUrl);
      setCopiado(false);
    } catch (err) {
      setErroLink(textoDoErro(err));
    } finally {
      setGerandoLink(false);
    }
  }

  async function copiarLink() {
    if (!linkVisitante) return;
    try {
      await navigator.clipboard.writeText(linkVisitante);
      setCopiado(true);
    } catch {
      // Silencioso com motivo: a área de transferência é negada em alguns
      // navegadores e contextos, e o link continua na tela para copiar à mão.
    }
  }

  // Link é de uma conversa: trocar de conversa não pode deixar o anterior à
  // mostra, que seria mandar o link do cliente errado.
  useEffect(() => { setLinkVisitante(null); setErroLink(null); setCopiado(false); }, [activeId]);

  async function encerrar(id: string) {
    if (!token) return;
    setEncerrando(true);
    setErroEncerrar(null);
    try {
      await api(`/conversations/${id}/close`, { method: 'PATCH', token });
      setConversations((cs) =>
        cs.map((c) => (c.id === id ? { ...c, status: 'closed' } : c)),
      );
    } catch (e) {
      setErroEncerrar(textoDoErro(e));
    } finally {
      setEncerrando(false);
    }
  }

  /* Carrega conversas */
  const loadConversations = useCallback(async () => {
    if (!token) return;
    setLoadingConvs(true);
    try {
      const r = await api<{ items: Conversation[] }>('/conversations', { token });
      setConversations(r.items);
      setErroConvs(null);
    } catch (err) {
      // Lista vazia fazia parecer que nenhum cliente tinha escrito.
      setErroConvs(err);
    }
    finally { setLoadingConvs(false); }
  }, [token]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  /**
   * Recarga silenciosa, sem o spinner: é o que o socket dispara quando chega
   * mensagem de outra conversa, ou uma conversa nova (o cliente que escreveu
   * no WhatsApp agora). Falha aqui não substitui a lista por erro — a lista
   * que está na tela continua valendo, e o botão de atualizar mostra o erro.
   */
  const recarregarLista = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api<{ items: Conversation[] }>('/conversations', { token });
      setConversations(r.items);
    } catch {
      // Silencioso com motivo: é uma atualização de fundo; a lista atual fica.
    }
  }, [token]);
  const recarregarRef = useRef(recarregarLista);
  useEffect(() => { recarregarRef.current = recarregarLista; }, [recarregarLista]);
  /* Deep-link: abre conversa via ?c=<id> (ex: vindo de um lead) */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const c = new URLSearchParams(window.location.search).get('c');
    if (c) setActiveId(c);
  }, []);

  /* Carrega mensagens quando muda de conversa */
  useEffect(() => {
    if (!activeId || !token) { setMessages([]); return; }
    setLoadingMsgs(true);
    setErroMsgs(null);
    api<Message[]>(`/conversations/${activeId}/messages`, { token })
      .then(setMessages)
      // Antes o erro era engolido: ficavam na tela as mensagens da conversa
      // anterior, ou "Nenhuma mensagem ainda" — como se o cliente não tivesse
      // escrito nada.
      .catch((err) => { setMessages([]); setErroMsgs(err); })
      .finally(() => setLoadingMsgs(false));
  }, [activeId, token, tentativaMsgs]);

  /* Socket.io */
  useEffect(() => {
    if (!token) return;
    const socket = io(`${API_URL.replace('/api/v1', '')}/chat`, {
      auth: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    // O socket entra na sala de cada conversa aberta e não sai: sem o filtro,
    // a mensagem de uma conversa aparecia na que estivesse na tela.
    socket.on('conversation:message', (msg: Message) => {
      if (msg.conversationId && msg.conversationId !== activeIdRef.current) {
        void recarregarRef.current();
        return;
      }
      setMessages((prev) => comMensagem(prev, msg));
      if (msg.senderUserId === null) {
        // O cliente escreveu: no WhatsApp, é o que reabre a janela de 24 h.
        setConversations((cs) => cs.map((c) =>
          c.id === activeIdRef.current ? { ...c, customerLastMessageAt: msg.createdAt } : c));
      }
    });

    socket.on('conversation:message:update', (msg: Message) => {
      if (msg.conversationId && msg.conversationId !== activeIdRef.current) return;
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
    });

    // Conversa nova ou movimentada na loja (sala `tenant:<id>`).
    socket.on('conversation:updated', () => { void recarregarRef.current(); });

    socket.on('conversation:typing', ({ userId, isTyping }: { userId: string; isTyping: boolean }) => {
      setTypingUsers((prev) => {
        const next = new Set(prev);
        if (isTyping) next.add(userId); else next.delete(userId);
        return next;
      });
    });

    return () => { socket.disconnect(); };
  }, [token]);

  /* Join/leave sala + marca como lida */
  useEffect(() => {
    if (!socketRef.current || !activeId) return;
    socketRef.current.emit('conversation:join', { conversationId: activeId });
    socketRef.current.emit('conversation:read', { conversationId: activeId });
  }, [activeId]);

  /* Mensagem recebida com a conversa aberta → marca como lida na hora */
  useEffect(() => {
    if (!socketRef.current || !activeId || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.senderUserId !== user?.id) {
      socketRef.current.emit('conversation:read', { conversationId: activeId });
    }
  }, [messages, activeId, user?.id]);

  /* Scroll ao fundo */
  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    if (!newMsg.trim() || !activeId || !socketRef.current || sending) return;
    const texto = newMsg.trim();
    setSending(true);
    setErroEnvio(null);
    socketRef.current.emit('conversation:send', {
      conversationId: activeId, body: texto,
    }, (r?: { ok: boolean; error?: string }) => {
      setSending(false);
      // A recusa (janela do WhatsApp fechada, conversa encerrada) aparece aqui,
      // e o texto volta para o campo em vez de sumir.
      if (r && !r.ok) {
        setErroEnvio(r.error ?? 'Não foi possível enviar a mensagem.');
        setNewMsg((atual) => atual || texto);
      }
    });
    setNewMsg('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function onTyping() {
    if (!socketRef.current || !activeId) return;
    socketRef.current.emit('conversation:typing', { conversationId: activeId, isTyping: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socketRef.current?.emit('conversation:typing', { conversationId: activeId, isTyping: false });
    }, 2000);
  }

  const isTyping = typingUsers.size > 0 && !typingUsers.has(user?.id ?? '');

  return (
    <div className="flex h-full overflow-hidden">
      {/* Lista de conversas (sidebar) */}
      <aside className={cn(
        'w-full md:w-72 lg:w-80 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0',
        activeId && 'hidden md:flex',
      )}>
        <div className="px-4 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h1 className="font-semibold text-sm">Chat</h1>
          <button onClick={loadConversations} disabled={loadingConvs}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <RefreshCw size={13} className={cn(loadingConvs && 'animate-spin')} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            <div className="flex items-center justify-center h-32 text-slate-500">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : erroConvs ? (
            <div className="flex flex-col items-center justify-center h-40 text-center gap-2 px-4">
              <AlertCircle size={22} className="text-rose-500" />
              <p className="text-xs text-slate-400">{textoDoErro(erroConvs)}</p>
              <button onClick={loadConversations}
                className="text-xs font-semibold text-blue-500 hover:underline">
                Tentar novamente
              </button>
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400 gap-2">
              <MessageSquare size={24} />
              <p className="text-xs">Nenhuma conversa</p>
            </div>
          ) : conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              active={conv.id === activeId}
              onClick={() => setActiveId(conv.id)}
            />
          ))}
        </div>
      </aside>

      {/* Área de mensagens */}
      <main className={cn(
        'flex-1 flex flex-col overflow-hidden',
        !activeId && 'hidden md:flex',
      )}>
        {!activeId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
            <MessageSquare size={40} />
            <p className="text-sm">Selecione uma conversa para começar</p>
          </div>
        ) : (
          <>
            {/* Header da conversa */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <button onClick={() => setActiveId(null)} className="md:hidden p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                <ChevronLeft size={16} />
              </button>
              {activeConv && (
                <>
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <span className="text-blue-600 dark:text-blue-400 text-xs font-bold">
                      {nomeDoContato(activeConv).charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{nomeDoContato(activeConv)}</p>
                    {ehWhatsApp(activeConv) && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <MessageCircle size={11} /> WhatsApp
                        {activeConv.contactPhoneNormalized && ` · ${formatarTelefoneBr(activeConv.contactPhoneNormalized)}`}
                      </p>
                    )}
                    {activeConv.vehicle && (
                      <p className="text-xs text-slate-500">
                        {activeConv.vehicle.brand.name} {activeConv.vehicle.model.name} {activeConv.vehicle.yearModel}
                      </p>
                    )}
                  </div>

                  {/* Encerrar. O endpoint existia e nenhuma tela o chamava: a
                      conversa ficava aberta para sempre, e a caixa do vendedor
                      acumulava atendimento já resolvido. */}
                  {activeConv.status === 'open' && (
                    <button
                      onClick={() => void encerrar(activeConv.id)}
                      disabled={encerrando}
                      title="Encerrar conversa"
                      className="ml-auto p-2 rounded-lg text-slate-400 hover:text-rose-600
                                 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800
                                 transition disabled:opacity-50"
                    >
                      {encerrando ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
                    </button>
                  )}
                </>
              )}
            </div>
            {erroEncerrar && (
              <p className="px-4 py-2 text-xs text-rose-600 dark:text-rose-400 border-b
                            border-slate-200 dark:border-slate-800">
                {erroEncerrar}
              </p>
            )}

            {/* ── Conversa sem conta (B11) ──────────────────────────
                O lead da Onda 0 nasce sem conta, então não há login por onde
                ele entrar: a porta é um link. Ele vai por e-mail quando há
                endereço, e fica aqui para a loja mandar por WhatsApp — que é o
                canal que a revenda usa de verdade. */}
            {activeConv && semConta(activeConv) && (
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800
                              bg-amber-50/70 dark:bg-amber-950/20">
                <div className="flex items-start gap-2">
                  <LinkIcon size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-700 dark:text-slate-200 leading-snug">
                      <b>{nomeDoContato(activeConv)}</b> não tem conta no AutoConnect.
                      Ele lê e responde por um link — mande pelo WhatsApp
                      {activeConv.contactPhone ? ` (${activeConv.contactPhone})` : ''}
                      {activeConv.contactEmail ? '; o e-mail já foi enviado' : ''}.
                    </p>

                    {linkVisitante ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <code className="text-[11px] bg-white dark:bg-slate-900 border border-amber-200
                                         dark:border-amber-500/30 rounded-lg px-2 py-1 break-all max-w-full">
                          {linkVisitante}
                        </code>
                        <button onClick={() => void copiarLink()}
                                className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                          {copiado ? 'Copiado!' : 'Copiar'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => void gerarLink(activeConv.id)}
                        disabled={gerandoLink}
                        className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold
                                   px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-500/40
                                   text-amber-700 dark:text-amber-300 hover:bg-amber-100/70
                                   dark:hover:bg-amber-500/10 transition disabled:opacity-50"
                      >
                        {gerandoLink
                          ? <><Loader2 size={11} className="animate-spin" /> Gerando…</>
                          : <>Gerar link de acesso</>}
                      </button>
                    )}
                    <p className="text-[10px] text-slate-500 mt-1.5">
                      Gerar um link novo invalida o anterior.
                    </p>
                    {erroLink && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">{erroLink}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-950">
              {loadingMsgs ? (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : erroMsgs ? (
                <ErroAoCarregar
                  erro={erroMsgs}
                  onTentarNovamente={() => setTentativaMsgs((n) => n + 1)}
                  contexto="as mensagens"
                />
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                  <AlertCircle size={24} />
                  <p className="text-xs">Nenhuma mensagem ainda</p>
                </div>
              ) : messages.map((msg) => {
                const isMe = msg.senderUserId === user?.id;
                const proposal = getProposal(msg.metadata);
                if (proposal) {
                  return (
                    <div key={msg.id} className={cn('flex gap-2', isMe && 'flex-row-reverse')}>
                      <ProposalBubble proposal={proposal} mine={isMe} canRespond={false} />
                    </div>
                  );
                }
                return (
                  <div key={msg.id} className={cn('flex gap-2', isMe && 'flex-row-reverse')}>
                    {!isMe && (
                      <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 text-xs font-bold text-slate-500">
                        {/* `senderUserId` nulo é o visitante sem conta: quem
                            identifica é o contato copiado na conversa. */}
                        {(msg.sender?.fullName
                          ?? (activeConv ? nomeDoContato(activeConv) : '?')).charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className={cn(
                      'max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm',
                      isMe
                        ? 'bg-blue-600 text-white rounded-tr-sm'
                        : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-sm shadow-sm',
                    )}>
                      {typeof (msg.metadata as { modelo?: unknown } | undefined)?.modelo === 'string' && (
                        <p className={cn('text-[10px] font-semibold mb-1 flex items-center gap-1', isMe ? 'text-blue-100' : 'text-slate-400')}>
                          <FileText size={10} />
                          Modelo: {MODELOS_DE_WHATSAPP[(msg.metadata as { modelo: ChaveDoModelo }).modelo]?.rotulo ?? 'aprovado'}
                        </p>
                      )}
                      <p className="leading-relaxed break-words whitespace-pre-line">{msg.body}</p>
                      <p className={cn('text-[10px] mt-1 flex items-center gap-1', isMe ? 'text-blue-200 justify-end' : 'text-slate-400')}>
                        {fmtTime(msg.createdAt)}
                        {isMe && <StatusDeEntrega msg={msg} />}
                      </p>
                      {msg.deliveryStatus === 'falhou' && (
                        <p className="text-[11px] mt-1 text-rose-100">
                          Não chegou ao cliente{msg.failureReason ? `: ${msg.failureReason}` : '.'}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              {isTyping && (
                <div className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs">
                    <Circle size={8} className="text-slate-400 animate-pulse" />
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-2.5 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.1s]" />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                  </div>
                </div>
              )}
              <div ref={msgsEndRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              {erroEnvio && (
                <p role="alert" className="mb-2 text-xs text-rose-600 dark:text-rose-400">{erroEnvio}</p>
              )}
              {activeConv && ehWhatsApp(activeConv) && (
                <PainelDoWhatsApp
                  conv={activeConv}
                  aberto={modeloAberto}
                  onAbrir={() => setModeloAberto((v) => !v)}
                  modelo={modelo}
                  onModelo={setModelo}
                  enviando={enviandoModelo}
                  onEnviar={() => void enviarModelo()}
                />
              )}
              {!(activeConv && ehWhatsApp(activeConv) && !janelaDeAtendimentoAberta(activeConv.customerLastMessageAt)) && (
              <div className="flex items-end gap-2">
                {!ehWhatsApp(activeConv) && (
                <button
                  onClick={() => setShowProposal(true)}
                  title="Enviar proposta comercial"
                  className="p-2.5 rounded-xl border border-amber-300 dark:border-amber-500/40
                             text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10
                             transition shrink-0"
                >
                  <BadgeDollarSign size={16} />
                </button>
                )}
                <textarea
                  value={newMsg}
                  onChange={(e) => { setNewMsg(e.target.value); onTyping(); }}
                  onKeyDown={onKeyDown}
                  placeholder="Digite uma mensagem…"
                  rows={1}
                  className="flex-1 resize-none px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition max-h-32"
                  style={{ overflowY: 'auto' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!newMsg.trim() || sending}
                  className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 transition shrink-0"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Modal de proposta comercial */}
      {showProposal && activeConv && (
        <ProposalModal
          conv={activeConv}
          onClose={() => setShowProposal(false)}
          onSend={(proposal, body) => {
            socketRef.current?.emit('conversation:send', {
              conversationId: activeId,
              body,
              metadata: { proposal },
            });
            setShowProposal(false);
          }}
        />
      )}
    </div>
  );
}

/* ── WhatsApp: janela de 24 h e modelos ───────────────────── */

/**
 * A regra do WhatsApp na tela: dentro da janela, o campo de sempre (e o modelo
 * à mão, para o retorno de proposta); fora dela, o campo some e sobra o modelo
 * — em vez de deixar o vendedor digitar e descobrir a recusa depois.
 */
function PainelDoWhatsApp({ conv, aberto, onAbrir, modelo, onModelo, enviando, onEnviar }: {
  conv: Conversation;
  aberto: boolean;
  onAbrir: () => void;
  modelo: ChaveDoModelo;
  onModelo: (m: ChaveDoModelo) => void;
  enviando: boolean;
  onEnviar: () => void;
}) {
  const janela = janelaDeAtendimentoAberta(conv.customerLastMessageAt);
  const fecha = janelaFechaEm(conv.customerLastMessageAt);
  const mostrarModelos = !janela || aberto;

  return (
    <div className="mb-2 space-y-2">
      {janela ? (
        <p className="text-[11px] text-slate-500 flex items-center gap-2">
          Janela de conversa aberta até {fecha?.toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.
          <button onClick={onAbrir} className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline">
            {aberto ? 'Fechar modelos' : 'Usar um modelo'}
          </button>
        </p>
      ) : (
        <p className="text-xs rounded-xl px-3 py-2 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
          {conv.customerLastMessageAt
            ? 'O cliente não escreve há mais de 24 horas. Pelas regras do WhatsApp, a loja só pode mandar um modelo aprovado — quando ele responder, a conversa livre volta.'
            : 'A loja fala primeiro: pelas regras do WhatsApp, o primeiro contato é por um modelo aprovado. Quando o cliente responder, a conversa livre começa.'}
        </p>
      )}
      {mostrarModelos && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Modelo">
            {MODELOS_MANUAIS.map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={modelo === k}
                onClick={() => onModelo(k)}
                className={cn(
                  'text-[11px] font-medium px-2.5 py-1 rounded-full border transition',
                  modelo === k
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300',
                )}
              >
                {MODELOS_DE_WHATSAPP[k].rotulo}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{previaDoModelo(modelo)}</p>
          <button
            onClick={onEnviar}
            disabled={enviando}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white
                       hover:bg-emerald-700 disabled:opacity-50 transition"
          >
            {enviando ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Enviar modelo
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Modal de envio de proposta ─────────────────────────── */
function ProposalModal({ conv, onClose, onSend }: {
  conv: Conversation;
  onClose: () => void;
  onSend: (proposal: Record<string, unknown>, body: string) => void;
}) {
  const vehicleLabel = conv.vehicle
    ? `${conv.vehicle.brand.name} ${conv.vehicle.model.name} ${conv.vehicle.versionName ?? ''} ${conv.vehicle.yearModel}`.replace(/\s+/g, ' ').trim()
    : undefined;

  const [price, setPrice]               = useState('');
  const [downPayment, setDownPayment]   = useState('');
  const [installments, setInstallments] = useState(48);

  const priceNum = parseFloat(price) || 0;
  const downNum  = parseFloat(downPayment) || 0;
  const financed = Math.max(priceNum - downNum, 0);
  // Tabela PRICE com taxa de referência 1,49% a.m. (mesma da calculadora pública)
  const rate = 0.0149;
  const x = Math.pow(1 + rate, installments);
  const installmentValue = financed > 0 ? (financed * rate * x) / (x - 1) : 0;

  const brl = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (priceNum <= 0) return;
    onSend(
      {
        price: priceNum,
        downPayment: downNum,
        installments,
        installmentValue: Math.round(installmentValue * 100) / 100,
        vehicleLabel,
        status: 'pending',
      },
      `Proposta: ${brl(priceNum)} · entrada ${brl(downNum)} · ${installments}× de ${brl(installmentValue)}`,
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <form onSubmit={submit}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BadgeDollarSign size={16} className="text-amber-500" />
              <h3 className="text-sm font-bold">Enviar proposta</h3>
            </div>
            <button type="button" onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              <X size={14} />
            </button>
          </div>

          {vehicleLabel && (
            <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">{vehicleLabel}</p>
          )}

          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Valor do veículo (R$)</label>
            <input type="number" min={1} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required
              placeholder="85000"
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Entrada (R$)</label>
            <input type="number" min={0} step="0.01" value={downPayment} onChange={(e) => setDownPayment(e.target.value)}
              placeholder="20000"
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Parcelas</label>
            <select value={installments} onChange={(e) => setInstallments(Number(e.target.value))}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500">
              {[12, 24, 36, 48, 60, 72].map((n) => <option key={n} value={n}>{n}×</option>)}
            </select>
          </div>

          {priceNum > 0 && (
            <div className="text-xs text-slate-500 bg-amber-50 dark:bg-amber-500/10 rounded-xl px-3 py-2.5">
              Financiado: <b className="text-slate-700 dark:text-slate-200">{brl(financed)}</b> →{' '}
              <b className="text-amber-600 dark:text-amber-400">{installments}× de {brl(installmentValue)}</b>
              <span className="block text-[10px] mt-0.5 text-slate-400">Taxa de referência 1,49% a.m. (Tabela PRICE)</span>
            </div>
          )}

          <button type="submit" disabled={priceNum <= 0}
            className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition disabled:opacity-40">
            Enviar proposta
          </button>
        </form>
      </div>
    </>
  );
}
