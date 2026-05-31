'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Send, MessageSquare, Circle, Loader2, User,
  RefreshCw, AlertCircle, ChevronLeft,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';

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

    socket.on('conversation:typing', ({ userId, isTyping }: { userId: string; isTyping: boolean }) => {
      setTypingUsers((prev) => {
        const next = new Set(prev);
        if (isTyping) next.add(userId); else next.delete(userId);
        return next;
      });
    });

    return () => { socket.disconnect(); };
  }, [token]);

  /* Join/leave sala */
  useEffect(() => {
    if (!socketRef.current || !activeId) return;
    socketRef.current.emit('conversation:join', { conversationId: activeId });
  }, [activeId]);

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
    </div>
  );
}
