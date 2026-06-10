'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Send, MessageSquare, Circle, Loader2, User,
  RefreshCw, AlertCircle, ChevronLeft, BadgeDollarSign, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';
import ProposalBubble, { getProposal } from '@/components/chat/ProposalBubble';

/* ── Tipos ─────────────────────────────────────────────── */
interface Conversation {
  id: string;
  status: string;
  lastMessageAt: string | null;
  customer: { id: string; fullName: string; email: string; avatarUrl: string | null };
  salesperson: { id: string; fullName: string; email: string } | null;
  vehicle: { id: string; versionName: string | null; yearModel: number; brand: { name: string }; model: { name: string }; images: { url: string }[] } | null;
  messages: { body: string; createdAt: string; kind: string }[];
}

interface Message {
  id: string;
  body: string;
  kind: string;
  createdAt: string;
  senderUserId: string | null;
  sender: { id: string; fullName: string; avatarUrl: string | null } | null;
  metadata?: unknown;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
            {conv.customer.fullName?.charAt(0).toUpperCase()}
          </span>
        </div>
        {conv.status === 'open' && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-slate-900" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <p className="text-sm font-medium truncate">{conv.customer.fullName}</p>
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
  const [loadingMsgs,   setLoadingMsgs]   = useState(false);
  const [sending,       setSending]       = useState(false);
  const [typingUsers,   setTypingUsers]   = useState<Set<string>>(new Set());
  const [showProposal,  setShowProposal]  = useState(false);
  const socketRef  = useRef<Socket | null>(null);
  const msgsEndRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<NodeJS.Timeout | null>(null);

  const activeConv = conversations.find((c) => c.id === activeId);

  /* Carrega conversas */
  const loadConversations = useCallback(async () => {
    if (!token) return;
    setLoadingConvs(true);
    try {
      const r = await api<{ items: Conversation[] }>('/conversations', { token });
      setConversations(r.items);
    } catch { /* ignora */ }
    finally { setLoadingConvs(false); }
  }, [token]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

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
    api<Message[]>(`/conversations/${activeId}/messages`, { token })
      .then(setMessages)
      .catch(() => null)
      .finally(() => setLoadingMsgs(false));
  }, [activeId, token]);

  /* Socket.io */
  useEffect(() => {
    if (!token) return;
    const socket = io(`${API_URL.replace('/api/v1', '')}/chat`, {
      auth: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('conversation:message', (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('conversation:message:update', (msg: Message) => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
    });

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
    setSending(true);
    socketRef.current.emit('conversation:send', {
      conversationId: activeId, body: newMsg.trim(),
    }, () => setSending(false));
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
                      {activeConv.customer.fullName?.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{activeConv.customer.fullName}</p>
                    {activeConv.vehicle && (
                      <p className="text-xs text-slate-500">
                        {activeConv.vehicle.brand.name} {activeConv.vehicle.model.name} {activeConv.vehicle.yearModel}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-950">
              {loadingMsgs ? (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <Loader2 size={20} className="animate-spin" />
                </div>
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
                        {msg.sender?.fullName?.charAt(0).toUpperCase() ?? '?'}
                      </div>
                    )}
                    <div className={cn(
                      'max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm',
                      isMe
                        ? 'bg-blue-600 text-white rounded-tr-sm'
                        : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-sm shadow-sm',
                    )}>
                      <p className="leading-relaxed break-words">{msg.body}</p>
                      <p className={cn('text-[10px] mt-1', isMe ? 'text-blue-200 text-right' : 'text-slate-400')}>
                        {fmtTime(msg.createdAt)}
                      </p>
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
              <div className="flex items-end gap-2">
                <button
                  onClick={() => setShowProposal(true)}
                  title="Enviar proposta comercial"
                  className="p-2.5 rounded-xl border border-amber-300 dark:border-amber-500/40
                             text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10
                             transition shrink-0"
                >
                  <BadgeDollarSign size={16} />
                </button>
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
