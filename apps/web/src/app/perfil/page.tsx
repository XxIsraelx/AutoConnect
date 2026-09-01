'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Heart, CalendarDays, ArrowLeft, Car, Loader2, Bell, BellOff,
  Eye, Bookmark, MessageSquare, Pencil, KeyRound, Camera, X, Check,
  MapPin, Phone, Mail, Clock, Sparkles, ChevronRight, LogOut,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useRouter } from 'next/navigation';
import ChatDrawer from '@/components/ChatDrawer';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';

const CLOUD_NAME    = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '';
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? '';

async function uploadToCloudinary(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', UPLOAD_PRESET);
  form.append('folder', 'autoconnect/avatars');
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Falha no upload');
  return ((await res.json()) as { secure_url: string }).secure_url;
}

/* ── Tipos ─────────────────────────────────────────────── */
interface SmallVehicle {
  id: string; versionName: string | null; yearModel: number;
  price: string | null; promoPrice: string | null; condition: string; mileageKm: number;
  tenantId: string; brand: { name: string }; model: { name: string }; images: { url: string }[];
}
interface FavoriteVehicle { createdAt: string; vehicle: SmallVehicle }
interface PriceAlert {
  id: string; targetPrice: string; isActive: boolean; triggeredAt: string | null;
  vehicle: SmallVehicle;
}
interface CustomerAppointment {
  id: string; type: string; status: string; scheduledStart: string; notes: string | null;
  vehicle: { id: string; versionName: string | null; yearModel: number; brand: { name: string }; model: { name: string }; images: { url: string }[] } | null;
  salesperson: { fullName: string } | null;
  branch: { name: string; city: string; state: string } | null;
}
interface SavedSearch { id: string; name: string; filters: Record<string, string>; newCount: number }
interface Conversation {
  id: string; status: string; lastMessageAt: string | null;
  tenant: { id: string; tradeName: string; logoUrl: string | null };
  vehicle: { brand: { name: string }; model: { name: string }; yearModel: number; images: { url: string }[] } | null;
  messages: { body: string; createdAt: string }[];
}
interface FullProfile {
  id: string; email: string; fullName: string; avatarUrl: string | null; phone: string | null;
  createdAt: string;
  customerProfile: { documentNumber: string | null; city: string | null; state: string | null; postalCode: string | null } | null;
}
/* ── Helpers ────────────────────────────────────────────── */
function formatPrice(v: string | number | null | undefined) {
  if (!v) return '–';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(Number(v));
}
const STATUS_LABELS: Record<string, string> = { scheduled: 'Agendado', confirmed: 'Confirmado', in_progress: 'Em andamento', completed: 'Concluído', canceled: 'Cancelado', no_show: 'Não compareceu' };
const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-500/15 text-blue-400', confirmed: 'bg-emerald-500/15 text-emerald-400',
  in_progress: 'bg-amber-500/15 text-amber-400', completed: 'bg-slate-500/15 txt-fraco',
  canceled: 'bg-rose-500/15 text-rose-400', no_show: 'bg-rose-500/15 text-rose-400',
};
const CARD = 'sup-card border borda rounded-2xl';

type Tab = 'favorites' | 'viewed' | 'searches' | 'alerts' | 'appointments' | 'conversations';

/* ═══════════════════════════════════════════════════════════ */
export default function PerfilPage() {
  const { token, user, updateUser, clear } = useAuthStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('favorites');

  const [profile, setProfile]   = useState<FullProfile | null>(null);
  const [favorites, setFavorites] = useState<FavoriteVehicle[]>([]);
  const [viewed, setViewed]     = useState<SmallVehicle[]>([]);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [alerts, setAlerts]     = useState<PriceAlert[]>([]);
  const [appointments, setAppointments] = useState<CustomerAppointment[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading]   = useState(true);
  const [erro, setErro]         = useState<unknown>(null);
  const [erroAvatar, setErroAvatar] = useState('');

  const [editOpen, setEditOpen]     = useState(false);
  const [pwOpen, setPwOpen]         = useState(false);
  const [chatConv, setChatConv]     = useState<Conversation | null>(null);
  const [scheduleVehicle, setScheduleVehicle] = useState<SmallVehicle | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!token) router.replace('/login'); }, [token, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [prof, favs, vw, srch, als, appts, convs] = await Promise.all([
        api<FullProfile>('/users/me', { token }),
        api<FavoriteVehicle[]>('/catalog/favorites', { token }),
        api<SmallVehicle[]>('/catalog/recently-viewed', { token }),
        api<SavedSearch[]>('/catalog/saved-searches', { token }),
        api<PriceAlert[]>('/catalog/price-alerts', { token }),
        api<CustomerAppointment[]>('/appointments', { token }),
        api<{ items: Conversation[] }>('/conversations', { token }),
      ]);
      setProfile(prof); setFavorites(favs); setViewed(vw); setSearches(srch);
      setAlerts(als); setAppointments(appts); setConversations(convs.items ?? []);
      setErro(null);
    } catch (err) {
      // Sem isto, favoritos/agendamentos/conversas apareciam todos vazios e o
      // cliente concluía que não tinha nada salvo.
      setErro(err);
    }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function removeFavorite(id: string) {
    if (!token) return;
    await api(`/catalog/favorites/${id}`, { token, method: 'DELETE' });
    setFavorites((p) => p.filter((f) => f.vehicle.id !== id));
  }
  async function removeAlert(id: string) {
    if (!token) return;
    await api(`/catalog/price-alerts/${id}`, { token, method: 'DELETE' });
    setAlerts((p) => p.filter((a) => a.vehicle.id !== id));
  }
  async function deleteSearch(id: string) {
    if (!token) return;
    await api(`/catalog/saved-searches/${id}`, { token, method: 'DELETE' });
    setSearches((p) => p.filter((s) => s.id !== id));
  }
  async function cancelAppointment(id: string) {
    if (!token) return;
    await api(`/appointments/${id}/cancel`, { token, method: 'PATCH' });
    setAppointments((p) => p.map((a) => a.id === id ? { ...a, status: 'canceled' } : a));
  }

  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setUploadingAvatar(true);
    try {
      const url = await uploadToCloudinary(file);
      await api('/users/me', { token, method: 'PATCH', body: { avatarUrl: url } });
      setProfile((p) => p ? { ...p, avatarUrl: url } : p);
      updateUser({ avatarUrl: url });
      setErroAvatar('');
    } catch (err) {
      // Antes a foto simplesmente não trocava, sem nenhum aviso.
      setErroAvatar(textoDoErro(err));
    }
    finally { setUploadingAvatar(false); }
  }

  if (!token) return null;

  const pendingAppts = appointments.filter((a) => a.status === 'scheduled' || a.status === 'confirmed').length;
  const totalNew = searches.reduce((s, x) => s + x.newCount, 0);
  const memberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : '';

  const TABS: { value: Tab; label: string; Icon: React.ElementType; count?: number; dot?: boolean }[] = [
    { value: 'favorites',     label: 'Favoritos',     Icon: Heart,         count: favorites.length },
    { value: 'viewed',        label: 'Vistos',        Icon: Eye,           count: viewed.length },
    { value: 'searches',      label: 'Buscas',        Icon: Bookmark,      count: searches.length, dot: totalNew > 0 },
    { value: 'alerts',        label: 'Alertas',       Icon: Bell,          count: alerts.length },
    { value: 'appointments',  label: 'Agendamentos',  Icon: CalendarDays,  count: appointments.length },
    { value: 'conversations', label: 'Conversas',     Icon: MessageSquare, count: conversations.length },
  ];

  return (
    <div className="min-h-screen sup-base txt-forte">
      {/* Nav */}
      <div className="sticky top-0 z-20 sup-base/90 backdrop-blur border-b borda">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/buscar" className="p-1.5 rounded-lg hover:sup-fraca transition txt-fraco hover:txt-forte">
            <ArrowLeft size={18} />
          </Link>
          <span className="font-bold text-sm flex-1">Meu Perfil</span>
          <button onClick={() => { clear(); router.replace('/buscar'); }}
            className="flex items-center gap-1.5 text-xs txt-fraco hover:text-rose-400 transition">
            <LogOut size={14} /> Sair
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* ── HERO ── */}
        <div className={`${CARD} relative overflow-hidden p-6 mb-5`}>
          <div className="absolute -top-16 -right-10 w-56 h-56 rounded-full bg-blue-600/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-10 w-56 h-56 rounded-full bg-indigo-600/10 blur-3xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Avatar */}
            <div className="relative shrink-0">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-3xl font-extrabold overflow-hidden ring-2 ring-slate-200 dark:ring-white/10">
                {profile?.avatarUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
                  : (user?.fullName?.charAt(0).toUpperCase() ?? '?')}
              </div>
              <button onClick={() => avatarInput.current?.click()} disabled={uploadingAvatar}
                className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-blue-600 border-2 border-slate-50 dark:border-[#1e293b] flex items-center justify-center hover:bg-blue-500 transition">
                {uploadingAvatar ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
              </button>
              <input ref={avatarInput} type="file" accept="image/*" hidden onChange={onAvatarPick} />
              {erroAvatar && (
                <p className="absolute top-full left-0 mt-2 w-48 text-xs text-rose-400">
                  {erroAvatar}
                </p>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-extrabold truncate">{profile?.fullName ?? user?.fullName}</h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs txt-fraco">
                <span className="flex items-center gap-1"><Mail size={11} /> {profile?.email ?? user?.email}</span>
                {profile?.phone && <span className="flex items-center gap-1"><Phone size={11} /> {profile.phone}</span>}
                {profile?.customerProfile?.city && (
                  <span className="flex items-center gap-1"><MapPin size={11} /> {profile.customerProfile.city}/{profile.customerProfile.state}</span>
                )}
              </div>
              {memberSince && <p className="text-[11px] txt-tenue mt-1">Cliente desde {memberSince}</p>}
            </div>

            {/* Ações */}
            <div className="flex sm:flex-col gap-2 shrink-0">
              <button onClick={() => setEditOpen(true)}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl sup-fraca hover:sup-media text-xs font-semibold transition">
                <Pencil size={13} /> Editar
              </button>
              <button onClick={() => setPwOpen(true)}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl sup-fraca hover:sup-media text-xs font-semibold transition">
                <KeyRound size={13} /> Senha
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="relative grid grid-cols-4 gap-2 mt-5">
            {[
              { label: 'Favoritos', value: favorites.length, Icon: Heart, color: 'text-rose-400' },
              { label: 'Agendados', value: pendingAppts, Icon: CalendarDays, color: 'text-blue-400' },
              { label: 'Alertas', value: alerts.length, Icon: Bell, color: 'text-amber-400' },
              { label: 'Vistos', value: viewed.length, Icon: Eye, color: 'text-emerald-400' },
            ].map((s) => (
              <div key={s.label} className="sup-tenue border borda rounded-xl px-2 py-3 text-center">
                <s.Icon size={15} className={`${s.color} mx-auto mb-1`} />
                <p className="text-lg font-extrabold leading-none">{s.value}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 -mx-1 px-1 scrollbar-none">
          {TABS.map(({ value, label, Icon, count, dot }) => (
            <button key={value} onClick={() => setTab(value)}
              className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all
                ${tab === value ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30' : 'sup-card txt-fraco hover:txt-forte border borda'}`}>
              <Icon size={13} /> {label}
              {count !== undefined && count > 0 && (
                <span className={`text-[10px] font-bold rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center
                  ${tab === value ? 'sup-media' : 'sup-media txt-fraco'}`}>{count}</span>
              )}
              {dot && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-white dark:border-[#0f172a]" />}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-500"><Loader2 size={26} className="animate-spin" /></div>
        ) : erro ? (
          <ErroAoCarregar erro={erro} onTentarNovamente={load} carregando={loading} contexto="seus dados" />
        ) : (
          <>
            {/* FAVORITOS */}
            {tab === 'favorites' && (favorites.length === 0 ? (
              <Empty Icon={Heart} title="Nenhum favorito ainda" hint="Salve veículos que você gostar para acompanhar aqui."
                ctaHref="/buscar" ctaLabel="Explorar veículos" />
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {favorites.map((f) => (
                  <VehicleRow key={f.vehicle.id} v={f.vehicle}
                    right={
                      <>
                        <button onClick={() => setScheduleVehicle(f.vehicle)} title="Agendar test drive"
                          className="p-2 rounded-lg sup-tenue hover:bg-blue-500/15 hover:text-blue-400 transition">
                          <CalendarDays size={14} />
                        </button>
                        <button onClick={() => removeFavorite(f.vehicle.id)} title="Remover"
                          className="p-2 rounded-lg sup-tenue hover:bg-rose-500/15 transition">
                          <Heart size={14} className="fill-rose-500 text-rose-500" />
                        </button>
                      </>
                    } />
                ))}
              </div>
            ))}

            {/* VISTOS */}
            {tab === 'viewed' && (viewed.length === 0 ? (
              <Empty Icon={Eye} title="Nada visto ainda" hint="Os veículos que você abrir aparecem aqui."
                ctaHref="/buscar" ctaLabel="Explorar veículos" />
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {viewed.map((v) => <VehicleRow key={v.id} v={v} />)}
              </div>
            ))}

            {/* BUSCAS SALVAS */}
            {tab === 'searches' && (searches.length === 0 ? (
              <Empty Icon={Bookmark} title="Nenhuma busca salva" hint="Salve filtros na busca para ser avisado de novos veículos."
                ctaHref="/buscar" ctaLabel="Ir para a busca" />
            ) : (
              <div className="space-y-3">
                {searches.map((s) => (
                  <div key={s.id} className={`${CARD} p-4 flex items-center gap-3 group hover:borda-forte transition`}>
                    <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
                      <Bookmark size={16} className="text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{s.name}</p>
                      <p className="text-xs text-slate-500">{Object.keys(s.filters).length} filtro(s)</p>
                    </div>
                    {s.newCount > 0 && (
                      <span className="text-[11px] font-bold bg-amber-500/15 text-amber-400 px-2 py-1 rounded-full">{s.newCount} novo{s.newCount !== 1 ? 's' : ''}</span>
                    )}
                    <Link href="/buscar" className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500 transition" title="Abrir busca">
                      <ChevronRight size={14} />
                    </Link>
                    <button onClick={() => deleteSearch(s.id)} className="p-2 rounded-lg sup-tenue hover:bg-rose-500/15 hover:text-rose-400 transition opacity-0 group-hover:opacity-100" title="Remover">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ))}

            {/* ALERTAS */}
            {tab === 'alerts' && (alerts.length === 0 ? (
              <Empty Icon={Bell} title="Nenhum alerta de preço" hint="Crie alertas nos veículos e avisaremos quando o preço cair." />
            ) : (
              <div className="space-y-3">
                {alerts.map((a) => {
                  const cur = Number(a.vehicle.price ?? 0);
                  const tgt = Number(a.targetPrice);
                  const reached = cur <= tgt;
                  const dropNeeded = Math.max(0, cur - tgt);
                  // barra: quanto o preço atual já está próximo do alvo
                  const progress = reached ? 100 : Math.max(4, Math.min(96, (tgt / cur) * 100));
                  return (
                    <div key={a.vehicle.id} className={`${CARD} p-4`}>
                      <div className="flex items-center gap-3">
                        <Thumb v={a.vehicle} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate">{a.vehicle.brand.name} {a.vehicle.model.name} {a.vehicle.yearModel}</p>
                          <div className="flex items-center gap-3 mt-0.5 text-xs">
                            <span className="txt-fraco">Atual <b className="txt-forte">{formatPrice(a.vehicle.price)}</b></span>
                            <span className="txt-fraco">Alvo <b className="text-amber-400">{formatPrice(a.targetPrice)}</b></span>
                          </div>
                        </div>
                        <button onClick={() => removeAlert(a.vehicle.id)} className="p-2 rounded-lg sup-tenue hover:bg-rose-500/15 hover:text-rose-400 transition" title="Remover alerta">
                          <BellOff size={14} />
                        </button>
                      </div>
                      <div className="mt-3">
                        <div className="h-1.5 rounded-full sup-fraca overflow-hidden">
                          <div className={`h-full rounded-full ${reached ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${progress}%` }} />
                        </div>
                        <p className="text-[11px] mt-1.5 text-slate-500">
                          {reached
                            ? <span className="text-emerald-400 font-semibold">✓ Preço atingiu seu alvo!</span>
                            : <>Faltam <b className="txt-medio">{formatPrice(dropNeeded)}</b> para o seu alvo</>}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* AGENDAMENTOS */}
            {tab === 'appointments' && (appointments.length === 0 ? (
              <Empty Icon={CalendarDays} title="Nenhum agendamento" hint="Agende um test drive a partir dos seus favoritos." />
            ) : (
              <div className="space-y-3">
                {appointments.map((a) => (
                  <div key={a.id} className={`${CARD} p-4`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${STATUS_COLORS[a.status] ?? 'sup-fraca txt-fraco'}`}>
                        {STATUS_LABELS[a.status] ?? a.status}
                      </span>
                      <p className="text-xs txt-fraco flex items-center gap-1.5">
                        <Clock size={12} />
                        {new Date(a.scheduledStart).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                        {' · '}{new Date(a.scheduledStart).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {a.vehicle && (
                      <div className="flex items-center gap-2.5 mb-2">
                        {a.vehicle.images[0] && <img src={a.vehicle.images[0].url} alt="" className="w-12 h-9 object-cover rounded-lg" />}
                        <p className="text-sm font-semibold">{a.vehicle.brand.name} {a.vehicle.model.name} {a.vehicle.yearModel}</p>
                      </div>
                    )}
                    {a.branch && <p className="text-xs text-slate-500">{a.branch.name} · {a.branch.city}/{a.branch.state}</p>}
                    {(a.status === 'scheduled' || a.status === 'confirmed') && (
                      <button onClick={() => cancelAppointment(a.id)} className="mt-3 text-xs text-rose-400 hover:text-rose-300 font-medium">Cancelar agendamento</button>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {/* CONVERSAS */}
            {tab === 'conversations' && (conversations.length === 0 ? (
              <Empty Icon={MessageSquare} title="Nenhuma conversa" hint="Fale com as concessionárias a partir das páginas dos veículos." />
            ) : (
              <div className="space-y-3">
                {conversations.map((c) => {
                  const last = c.messages[0];
                  return (
                    <button key={c.id} onClick={() => setChatConv(c)}
                      className={`${CARD} w-full p-4 flex items-center gap-3 text-left hover:borda-forte transition`}>
                      <div className="w-11 h-11 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0 overflow-hidden">
                        {c.tenant.logoUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={c.tenant.logoUrl} alt="" className="w-full h-full object-cover" />
                          : <span className="text-blue-400 font-bold">{c.tenant.tradeName.charAt(0)}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{c.tenant.tradeName}</p>
                        {c.vehicle && <p className="text-[11px] text-blue-400 truncate">{c.vehicle.brand.name} {c.vehicle.model.name} {c.vehicle.yearModel}</p>}
                        {last && <p className="text-xs text-slate-500 truncate mt-0.5">{last.body}</p>}
                      </div>
                      <ChevronRight size={16} className="txt-tenue shrink-0" />
                    </button>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Modais */}
      {editOpen && profile && (
        <EditProfileModal profile={profile} token={token!} onClose={() => setEditOpen(false)}
          onSaved={(p) => { setProfile(p); updateUser({ fullName: p.fullName }); setEditOpen(false); }} />
      )}
      {pwOpen && <ChangePasswordModal token={token!} onClose={() => setPwOpen(false)} />}
      {chatConv && (
        <ChatDrawer
          conversationId={chatConv.id}
          token={token!}
          myId={user?.id ?? ''}
          title={chatConv.tenant.tradeName}
          subtitle={chatConv.vehicle ? `${chatConv.vehicle.brand.name} ${chatConv.vehicle.model.name}` : undefined}
          logoUrl={chatConv.tenant.logoUrl}
          onClose={() => setChatConv(null)}
        />
      )}
      {scheduleVehicle && (
        <ScheduleModal vehicle={scheduleVehicle} token={token!}
          onClose={() => setScheduleVehicle(null)} onScheduled={() => { setScheduleVehicle(null); load(); setTab('appointments'); }} />
      )}
    </div>
  );
}

/* ── Modal: agendar test drive ── */
function ScheduleModal({ vehicle, token, onClose, onScheduled }: { vehicle: SmallVehicle; token: string; onClose: () => void; onScheduled: () => void }) {
  const [datetime, setDatetime] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const input = 'w-full rounded-xl sup-base border borda px-3 py-2.5 text-sm txt-forte outline-none focus:border-blue-500 transition';
  const minDt = new Date(Date.now() + 3600000).toISOString().slice(0, 16);

  async function save() {
    setErr('');
    if (!datetime) return setErr('Escolha data e horário.');
    setSaving(true);
    try {
      await api('/appointments', {
        token, method: 'POST',
        body: { tenantId: vehicle.tenantId, vehicleId: vehicle.id, type: 'test_drive', scheduledStart: new Date(datetime).toISOString(), notes: notes || undefined },
      });
      onScheduled();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erro ao agendar'); setSaving(false); }
  }

  return (
    <Modal title="Agendar test drive" onClose={onClose}>
      <div className="flex items-center gap-3 mb-4 p-3 rounded-xl sup-tenue border borda">
        <Thumb v={vehicle} />
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">{vehicle.brand.name} {vehicle.model.name} {vehicle.yearModel}</p>
          <p className="text-xs text-blue-400 font-semibold">{formatPrice(vehicle.promoPrice ?? vehicle.price)}</p>
        </div>
      </div>
      <div className="space-y-3">
        <Labeled label="Data e horário">
          <input type="datetime-local" min={minDt} value={datetime} onChange={(e) => setDatetime(e.target.value)} className={input} />
        </Labeled>
        <Labeled label="Observações (opcional)">
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: prefiro de manhã" className={`${input} resize-none`} />
        </Labeled>
      </div>
      {err && <p className="text-xs text-rose-400 mt-3">{err}</p>}
      <div className="flex gap-2 mt-5">
        <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium txt-fraco border borda rounded-xl hover:sup-tenue">Cancelar</button>
        <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold bg-blue-600 hover:bg-blue-500 rounded-xl transition disabled:opacity-50">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <CalendarDays size={15} />} Agendar
        </button>
      </div>
    </Modal>
  );
}

/* ── Subcomponentes ──────────────────────────────────────── */

function Thumb({ v }: { v: SmallVehicle }) {
  return (
    <div className="w-14 h-11 rounded-lg sup-fraca overflow-hidden shrink-0 flex items-center justify-center">
      {v.images[0]
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={v.images[0].url} alt="" className="w-full h-full object-cover" />
        : <Car size={16} className="text-slate-300 dark:text-white/20" />}
    </div>
  );
}

function VehicleRow({ v, right }: { v: SmallVehicle; right?: React.ReactNode }) {
  return (
    <div className={`${CARD} p-3 flex items-center gap-3 hover:borda-forte transition group`}>
      <Thumb v={v} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate">{v.brand.name} {v.model.name} {v.yearModel}</p>
        <p className="text-[11px] text-slate-500 truncate">{v.versionName ?? ''} · {v.mileageKm.toLocaleString('pt-BR')} km</p>
        <p className="text-sm font-extrabold text-blue-400 mt-0.5">{formatPrice(v.promoPrice ?? v.price)}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Link href={`/catalogo/${v.tenantId}`} className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 rounded-lg transition">Ver</Link>
        {right}
      </div>
    </div>
  );
}

function Empty({ Icon, title, hint, ctaHref, ctaLabel }: { Icon: React.ElementType; title: string; hint: string; ctaHref?: string; ctaLabel?: string }) {
  return (
    <div className={`${CARD} flex flex-col items-center text-center py-14 px-6`}>
      <div className="w-16 h-16 rounded-2xl sup-tenue flex items-center justify-center mb-4">
        <Icon size={28} className="text-slate-300 dark:text-white/15" />
      </div>
      <p className="text-sm font-bold txt-medio">{title}</p>
      <p className="text-xs text-slate-500 mt-1 max-w-xs">{hint}</p>
      {ctaHref && (
        <Link href={ctaHref} className="mt-4 flex items-center gap-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl transition">
          <Sparkles size={13} /> {ctaLabel}
        </Link>
      )}
    </div>
  );
}

/* ── Modal: Editar perfil ── */
function EditProfileModal({ profile, token, onClose, onSaved }: { profile: FullProfile; token: string; onClose: () => void; onSaved: (p: FullProfile) => void }) {
  const [form, setForm] = useState({
    fullName: profile.fullName ?? '', phone: profile.phone ?? '',
    documentNumber: profile.customerProfile?.documentNumber ?? '',
    city: profile.customerProfile?.city ?? '', state: profile.customerProfile?.state ?? '',
    postalCode: profile.customerProfile?.postalCode ?? '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const input = 'w-full rounded-xl sup-base border borda px-3 py-2.5 text-sm txt-forte outline-none focus:border-blue-500 transition';

  async function save() {
    setSaving(true);
    try {
      const p = await api<FullProfile>('/users/me', { token, method: 'PATCH', body: form });
      onSaved(p);
    } catch { setSaving(false); }
  }

  return (
    <Modal title="Editar perfil" onClose={onClose}>
      <div className="space-y-3">
        <Labeled label="Nome completo"><input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} className={input} /></Labeled>
        <Labeled label="Telefone"><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(62) 99999-9999" className={input} /></Labeled>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2"><Labeled label="Cidade"><input value={form.city} onChange={(e) => set('city', e.target.value)} className={input} /></Labeled></div>
          <Labeled label="UF"><input value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase().slice(0, 2))} maxLength={2} className={input} /></Labeled>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="CPF"><input value={form.documentNumber} onChange={(e) => set('documentNumber', e.target.value)} className={input} /></Labeled>
          <Labeled label="CEP"><input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} className={input} /></Labeled>
        </div>
      </div>
      <div className="flex gap-2 mt-5">
        <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium txt-fraco border borda rounded-xl hover:sup-tenue">Cancelar</button>
        <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold bg-blue-600 hover:bg-blue-500 rounded-xl transition disabled:opacity-50">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Salvar
        </button>
      </div>
    </Modal>
  );
}

/* ── Modal: Trocar senha ── */
function ChangePasswordModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [conf, setConf] = useState('');
  const [saving, setSaving] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  const input = 'w-full rounded-xl sup-base border borda px-3 py-2.5 text-sm txt-forte outline-none focus:border-blue-500 transition';

  async function save() {
    setErr('');
    if (nw.length < 6) return setErr('A nova senha deve ter pelo menos 6 caracteres.');
    if (nw !== conf) return setErr('As senhas não coincidem.');
    setSaving(true);
    try {
      await api('/users/me/password', { token, method: 'POST', body: { currentPassword: cur, newPassword: nw } });
      setDone(true); setTimeout(onClose, 1400);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erro'); setSaving(false); }
  }

  return (
    <Modal title="Trocar senha" onClose={onClose}>
      {done ? (
        <div className="text-center py-6">
          <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3"><Check size={22} className="text-emerald-400" /></div>
          <p className="text-sm font-bold">Senha alterada!</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <Labeled label="Senha atual"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} className={input} /></Labeled>
            <Labeled label="Nova senha"><input type="password" value={nw} onChange={(e) => setNw(e.target.value)} className={input} /></Labeled>
            <Labeled label="Confirmar nova senha"><input type="password" value={conf} onChange={(e) => setConf(e.target.value)} className={input} /></Labeled>
          </div>
          {err && <p className="text-xs text-rose-400 mt-3">{err}</p>}
          <div className="flex gap-2 mt-5">
            <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium txt-fraco border borda rounded-xl hover:sup-tenue">Cancelar</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold bg-blue-600 hover:bg-blue-500 rounded-xl transition disabled:opacity-50">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Alterar
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ── UI utils ── */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md sup-card border borda rounded-2xl p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg txt-fraco hover:txt-forte hover:sup-fraca"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold txt-fraco uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}
