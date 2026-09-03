'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Heart, Bell, MessageSquare, Car, ChevronRight,
  Bookmark, TrendingDown, Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import ChatDrawer from '@/components/ChatDrawer';

/* ── Tipos ─────────────────────────────────────────────── */
interface SmallVehicle {
  id: string; versionName: string | null; yearModel: number;
  price: string | null; promoPrice: string | null; tenantId: string;
  brand: { name: string }; model: { name: string }; images: { url: string }[];
}
interface Favorite { vehicle: SmallVehicle }
interface PriceAlert { targetPrice: string; vehicle: SmallVehicle }
interface SavedSearch { id: string; name: string; newCount: number }
interface Conversation {
  id: string; status: string; lastMessageAt: string | null; unreadCountCustomer?: number;
  tenant: { id: string; tradeName: string; logoUrl: string | null };
  vehicle: { brand: { name: string }; model: { name: string }; yearModel: number; images: { url: string }[] } | null;
  messages: { body: string; createdAt: string }[];
}

function fmt(v: string | null | undefined) {
  if (!v) return '–';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

/* ── Botão de ícone com badge ───────────────────────────── */
function IconBtn({ Icon, count, active, dot, onClick }: {
  Icon: React.ElementType; count?: number; active: boolean; dot?: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all border
        ${active ? 'bg-blue-600 text-white border-blue-500'
                 : 'sup-fraca txt-fraco borda hover:txt-forte hover:sup-media'}`}>
      <Icon size={16} />
      {count !== undefined && count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white dark:border-[#0f172a]">
          {count > 9 ? '9+' : count}
        </span>
      )}
      {dot && count === undefined && (
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-white dark:border-[#0f172a]" />
      )}
    </button>
  );
}

/* ── Componente principal ───────────────────────────────── */
export default function HeaderActions() {
  const { token, user } = useAuthStore();
  const isCustomer = user?.role === 'customer';

  const [favs, setFavs]         = useState<Favorite[]>([]);
  const [alerts, setAlerts]     = useState<PriceAlert[]>([]);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [convs, setConvs]       = useState<Conversation[]>([]);
  const [loading, setLoading]   = useState(true);

  const [panel, setPanel]   = useState<null | 'fav' | 'notif' | 'chat'>(null);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!token || !isCustomer) return;
    Promise.all([
      api<Favorite[]>('/catalog/favorites', { token }).catch(() => []),
      api<PriceAlert[]>('/catalog/price-alerts', { token }).catch(() => []),
      api<SavedSearch[]>('/catalog/saved-searches', { token }).catch(() => []),
      api<{ items: Conversation[] }>('/conversations', { token }).catch(() => ({ items: [] })),
    ]).then(([f, a, s, c]) => {
      setFavs(f); setAlerts(a); setSearches(s); setConvs(c.items ?? []);
    }).finally(() => setLoading(false));
  }, [token, isCustomer]);

  useEffect(() => { load(); }, [load]);

  // fecha dropdowns ao clicar fora
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPanel(null);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!token || !isCustomer) return null;

  const unread = convs.reduce((s, c) => s + (c.unreadCountCustomer ?? 0), 0);
  const reached = alerts.filter((a) => Number(a.vehicle.price) <= Number(a.targetPrice));
  const newSearch = searches.filter((s) => s.newCount > 0);
  const notifCount = reached.length + newSearch.length + convs.filter((c) => (c.unreadCountCustomer ?? 0) > 0).length;

  const toggle = (p: 'fav' | 'notif' | 'chat') => setPanel((cur) => (cur === p ? null : p));

  return (
    <div ref={wrapRef} className="flex items-center gap-1.5 shrink-0">
      {/* ── FAVORITOS ── */}
      <div className="relative">
        <IconBtn Icon={Heart} count={favs.length} active={panel === 'fav'} onClick={() => toggle('fav')} />
        {panel === 'fav' && (
          <Dropdown title="Favoritos" footerHref="/perfil" footerLabel="Ver todos no perfil">
            {favs.length === 0
              ? <Empty text="Nenhum favorito ainda" />
              : favs.slice(0, 6).map((f) => (
                <Link key={f.vehicle.id} href={`/catalogo/${f.vehicle.tenantId}`} onClick={() => setPanel(null)}
                  className="flex items-center gap-2.5 px-3 py-2 hover:sup-tenue transition">
                  <Thumb v={f.vehicle} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold txt-forte truncate">{f.vehicle.brand.name} {f.vehicle.model.name}</p>
                    <p className="text-[11px] text-blue-400 font-semibold">{fmt(f.vehicle.promoPrice ?? f.vehicle.price)}</p>
                  </div>
                  <Heart size={13} className="fill-rose-500 text-rose-500 shrink-0" />
                </Link>
              ))}
          </Dropdown>
        )}
      </div>

      {/* ── NOTIFICAÇÕES ── */}
      <div className="relative">
        <IconBtn Icon={Bell} count={notifCount} active={panel === 'notif'} onClick={() => toggle('notif')} />
        {panel === 'notif' && (
          <Dropdown title="Notificações">
            {notifCount === 0 ? (
              <Empty text="Tudo em dia! Sem novidades." />
            ) : (
              <>
                {reached.map((a) => (
                  <Link key={`al-${a.vehicle.id}`} href="/perfil" onClick={() => setPanel(null)}
                    className="flex items-start gap-2.5 px-3 py-2.5 hover:sup-tenue transition">
                    <span className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0 mt-0.5"><TrendingDown size={13} className="text-emerald-400" /></span>
                    <div className="min-w-0">
                      <p className="text-xs txt-forte"><b>{a.vehicle.brand.name} {a.vehicle.model.name}</b> atingiu seu alvo</p>
                      <p className="text-[11px] text-emerald-400 font-semibold">{fmt(a.vehicle.price)} · alvo {fmt(a.targetPrice)}</p>
                    </div>
                  </Link>
                ))}
                {newSearch.map((s) => (
                  <Link key={`se-${s.id}`} href="/perfil" onClick={() => setPanel(null)}
                    className="flex items-start gap-2.5 px-3 py-2.5 hover:sup-tenue transition">
                    <span className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5"><Bookmark size={13} className="text-amber-400" /></span>
                    <div className="min-w-0">
                      <p className="text-xs txt-forte"><b>{s.newCount}</b> novo{s.newCount !== 1 ? 's' : ''} em <b>{s.name}</b></p>
                      <p className="text-[11px] text-slate-500">Busca salva</p>
                    </div>
                  </Link>
                ))}
                {convs.filter((c) => (c.unreadCountCustomer ?? 0) > 0).map((c) => (
                  <button key={`co-${c.id}`} onClick={() => { setActiveConv(c); setPanel(null); }}
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:sup-tenue transition text-left">
                    <span className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5"><MessageSquare size={13} className="text-blue-400" /></span>
                    <div className="min-w-0">
                      <p className="text-xs txt-forte"><b>{c.tenant.tradeName}</b> te respondeu</p>
                      {c.messages[0] && <p className="text-[11px] text-slate-500 truncate">{c.messages[0].body}</p>}
                    </div>
                  </button>
                ))}
              </>
            )}
          </Dropdown>
        )}
      </div>

      {/* ── CHAT ── */}
      <div className="relative">
        <IconBtn Icon={MessageSquare} count={unread} active={panel === 'chat'} onClick={() => toggle('chat')} />
        {panel === 'chat' && (
          <Dropdown title="Conversas" footerHref="/perfil" footerLabel="Ver no perfil">
            {loading ? <div className="py-6 flex justify-center"><Loader2 size={18} className="animate-spin text-slate-500" /></div>
              : convs.length === 0 ? <Empty text="Nenhuma conversa ainda" />
              : convs.map((c) => {
                const last = c.messages[0];
                const cu = c.unreadCountCustomer ?? 0;
                return (
                  <button key={c.id} onClick={() => { setActiveConv(c); setPanel(null); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:sup-tenue transition text-left">
                    <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0 overflow-hidden">
                      {c.tenant.logoUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={c.tenant.logoUrl} alt="" className="w-full h-full object-cover" />
                        : <span className="text-blue-400 font-bold text-sm">{c.tenant.tradeName.charAt(0)}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold txt-forte truncate">{c.tenant.tradeName}</p>
                      {last && <p className="text-[11px] text-slate-500 truncate">{last.body}</p>}
                    </div>
                    {cu > 0
                      ? <span className="w-5 h-5 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center shrink-0">{cu}</span>
                      : <ChevronRight size={14} className="txt-tenue shrink-0" />}
                  </button>
                );
              })}
          </Dropdown>
        )}
      </div>

      {activeConv && (
        <ChatDrawer
          conversationId={activeConv.id}
          token={token}
          myId={user?.id ?? ''}
          title={activeConv.tenant.tradeName}
          subtitle={activeConv.vehicle ? `${activeConv.vehicle.brand.name} ${activeConv.vehicle.model.name}` : undefined}
          logoUrl={activeConv.tenant.logoUrl}
          onClose={() => { setActiveConv(null); load(); }}
        />
      )}
    </div>
  );
}

/* ── Subcomponentes ──────────────────────────────────────── */
function Dropdown({ title, children, footerHref, footerLabel }: {
  title: string; children: React.ReactNode; footerHref?: string; footerLabel?: string;
}) {
  return (
    <div className="absolute right-0 top-full mt-2 w-72 sup-card border borda rounded-2xl shadow-2xl overflow-hidden z-[1001]">
      <div className="px-3 py-2.5 border-b borda">
        <p className="text-xs font-bold txt-forte">{title}</p>
      </div>
      <div className="max-h-[60vh] overflow-y-auto py-1">{children}</div>
      {footerHref && (
        <Link href={footerHref} className="block text-center text-[11px] font-semibold text-blue-400 hover:text-blue-300 py-2.5 border-t borda hover:sup-tenue transition">
          {footerLabel}
        </Link>
      )}
    </div>
  );
}
function Thumb({ v }: { v: SmallVehicle }) {
  return (
    <div className="w-11 h-9 rounded-lg sup-fraca overflow-hidden shrink-0 flex items-center justify-center">
      {v.images[0]
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={v.images[0].url} alt="" className="w-full h-full object-cover" />
        : <Car size={14} className="text-slate-300 dark:text-white/20" />}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="text-xs txt-tenue text-center py-6 px-3">{text}</p>;
}
