'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Loader2, X, Send } from 'lucide-react';
import { api } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  senderUserId: string | null;
  sender: { fullName: string } | null;
}

/** Drawer de chat reutilizável — usado no /perfil, catálogo e página da loja */
export default function ChatDrawer({
  conversationId, token, myId, title, subtitle, logoUrl, onClose,
}: {
  conversationId: string;
  token: string;
  myId: string;
  title: string;
  subtitle?: string;
  logoUrl?: string | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const socketRef = useRef<Socket | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<ChatMessage[]>(`/conversations/${conversationId}/messages`, { token })
      .then(setMessages).catch(() => {}).finally(() => setLoading(false));

    const socket = io(`${API_URL.replace('/api/v1', '')}/chat`, { auth: { token }, transports: ['websocket'] });
    socketRef.current = socket;
    socket.on('conversation:message', (m: ChatMessage) => setMessages((p) => [...p, m]));
    socket.emit('conversation:join', { conversationId });
    return () => { socket.disconnect(); };
  }, [conversationId, token]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function send() {
    if (!text.trim() || !socketRef.current) return;
    socketRef.current.emit('conversation:send', { conversationId, body: text.trim() });
    setText('');
  }

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm" />
      <aside className="fixed top-0 right-0 z-[2001] h-full w-full max-w-md bg-[#0f172a] border-l border-white/[.08] shadow-2xl flex flex-col text-white">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-white/[.06] shrink-0">
          <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center overflow-hidden">
            {logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={logoUrl} alt="" className="w-full h-full object-cover" />
              : <span className="text-blue-400 font-bold text-sm">{title.charAt(0).toUpperCase()}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{title}</p>
            {subtitle && <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[.06]"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {loading ? (
            <div className="flex justify-center pt-10"><Loader2 size={22} className="animate-spin text-slate-500" /></div>
          ) : messages.length === 0 ? (
            <p className="text-center text-xs text-slate-600 pt-10">Nenhuma mensagem ainda. Diga olá! 👋</p>
          ) : messages.map((m) => {
            const mine = m.senderUserId === myId;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${mine ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-[#1e293b] text-slate-200 rounded-tl-sm'}`}>
                  <p className="leading-relaxed break-words">{m.body}</p>
                  <p className={`text-[10px] mt-1 ${mine ? 'text-blue-200 text-right' : 'text-slate-500'}`}>
                    {new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        <div className="p-3 border-t border-white/[.06] flex items-center gap-2 shrink-0">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Escreva uma mensagem…"
            className="flex-1 rounded-xl bg-[#1e293b] border border-white/[.08] px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500" />
          <button onClick={send} disabled={!text.trim()} className="w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 flex items-center justify-center transition disabled:opacity-40">
            <Send size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}
