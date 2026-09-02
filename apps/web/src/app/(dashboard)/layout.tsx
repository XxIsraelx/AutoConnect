'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Car, Users, MessageSquare,
  CalendarDays, Settings, LogOut, ChevronRight,
  Info, AlertTriangle, OctagonAlert, X,
  TrendingUp, UserSquare2, Menu, Handshake,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import ThemeToggle from '@/components/ThemeToggle';

/* ── Badge de leads novos ─────────────────────────────────── */

const POLL_INTERVAL = 30_000; // 30 segundos
const STORAGE_KEY   = 'ac_leads_seen_count';

function notify(title: string, body: string, href: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const n = new Notification(title, { body, icon: '/icon-192.png', tag: href });
  n.onclick = () => { window.focus(); window.location.href = href; n.close(); };
}

function useLeadsBadge(token: string | null) {
  const [badge, setBadge] = useState(0);
  const [apptBadge, setApptBadge] = useState(0);
  const [chatBadge, setChatBadge] = useState(0);
  const prev = useState<{ leads: number | null; appts: number | null; msgs: number | null }>(
    () => ({ leads: null, appts: null, msgs: null }),
  )[0];

  const fetchNew = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api<{
        leadsNew: number;
        appointmentsPending?: number;
        unreadMessages?: number;
      }>('/tenant/stats', { token });
      const leads = data.leadsNew ?? 0;
      const appts = data.appointmentsPending ?? 0;
      const msgs  = data.unreadMessages ?? 0;

      // Notifica apenas quando o contador AUMENTA (evita spam no primeiro load)
      if (prev.leads !== null && leads > prev.leads) {
        notify('Novo lead recebido 🚗', 'Um cliente demonstrou interesse. Responda rápido!', '/leads');
      }
      if (prev.appts !== null && appts > prev.appts) {
        notify('Novo agendamento 📅', 'Um cliente solicitou um agendamento. Confirme o horário.', '/agendamentos');
      }
      if (prev.msgs !== null && msgs > prev.msgs) {
        notify('Nova mensagem 💬', 'Um cliente enviou uma mensagem no chat.', '/chat');
      }
      prev.leads = leads;
      prev.appts = appts;
      prev.msgs  = msgs;

      setBadge(leads);
      setApptBadge(appts);
      setChatBadge(msgs);
    } catch { /* ignora erros silenciosamente */ }
  }, [token, prev]);

  useEffect(() => {
    fetchNew();
    const id = setInterval(fetchNew, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchNew]);

  return { badge, apptBadge, chatBadge };
}

/* ── Pedido de permissão de notificação ──────────────────── */
function NotificationPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default'
        && localStorage.getItem('autoconnect:notif-dismissed') !== '1') {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  return (
    <div className="mx-3 mb-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50">
      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug mb-2">
        Receba avisos de novos leads e agendamentos mesmo com a aba em segundo plano.
      </p>
      <div className="flex gap-1.5">
        <button
          onClick={() => Notification.requestPermission().finally(() => setShow(false))}
          className="flex-1 text-[11px] font-bold py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
        >
          Ativar
        </button>
        <button
          onClick={() => { localStorage.setItem('autoconnect:notif-dismissed', '1'); setShow(false); }}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          Agora não
        </button>
      </div>
    </div>
  );
}

/* ── Aviso global ─────────────────────────────────────────── */

interface Announcement { id: string; message: string; type: string }

function useAnnouncement() {
  const [ann, setAnn] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api<Announcement | null>('/admin/announcements/active', {})
      .then((data) => { if (data) setAnn(data); })
      .catch(() => null);
  }, []);

  return { ann: dismissed ? null : ann, dismiss: () => setDismissed(true) };
}

function AnnouncementBanner({ ann, onDismiss }: { ann: Announcement; onDismiss: () => void }) {
  const styles = {
    info:     { bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',   text: 'text-blue-800 dark:text-blue-200',   Icon: Info          },
    warning:  { bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800', text: 'text-amber-800 dark:text-amber-200', Icon: AlertTriangle  },
    critical: { bg: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800',       text: 'text-red-800 dark:text-red-200',     Icon: OctagonAlert   },
  };
  const s = styles[ann.type as keyof typeof styles] ?? styles.info;

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 border-b text-sm ${s.bg} ${s.text}`}>
      <s.Icon size={15} className="shrink-0" />
      <span className="flex-1">{ann.message}</span>
      <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100 transition">
        <X size={14} />
      </button>
    </div>
  );
}

/* ── Nav config ───────────────────────────────────────────── */

const nav = [
  { href: '/dashboard',     label: 'Dashboard',     icon: LayoutDashboard },
  { href: '/veiculos',      label: 'Veículos',       icon: Car             },
  { href: '/leads',         label: 'Leads',          icon: Users,  badge: true },
  { href: '/negocios',      label: 'Negócios',       icon: Handshake        },
  { href: '/relatorios',    label: 'Relatórios',     icon: TrendingUp       },
  { href: '/agendamentos',  label: 'Agendamentos',   icon: CalendarDays     },
  { href: '/chat',          label: 'Chat',           icon: MessageSquare    },
  { href: '/equipe',        label: 'Equipe',         icon: UserSquare2      },
  { href: '/configuracoes', label: 'Configurações',  icon: Settings         },
];

/* ── Layout ───────────────────────────────────────────────── */

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const { token, user, clear } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const { badge: leadsNew, apptBadge, chatBadge } = useLeadsBadge(token);
  const { ann, dismiss } = useAnnouncement();

  useEffect(() => { setHydrated(true); }, []);
  // Fecha a gaveta ao navegar — senão ela continuaria cobrindo a tela nova.
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  // Trava o scroll do fundo enquanto a gaveta está aberta.
  useEffect(() => {
    if (!menuOpen) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = anterior; };
  }, [menuOpen]);
  useEffect(() => {
    if (!hydrated) return;
    if (!token) { router.replace('/login'); return; }
    // Clientes não acessam o painel da concessionária
    if (user?.role === 'customer') router.replace('/perfil');
  }, [hydrated, token, user, router]);

  if (!hydrated || !token || user?.role === 'customer') return null;

  function handleLogout() {
    clear();
    router.replace('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">

      {/* Fundo escurecido atrás da gaveta — só existe no mobile com o menu aberto */}
      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          aria-hidden
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────
          No mobile vira gaveta sobreposta (fixed + translate); a partir de md
          volta a ser coluna fixa no fluxo, como era. */}
      <aside
        className={cn(
          'w-60 flex flex-col shrink-0 border-r border-slate-200',
          'dark:border-slate-800 bg-white dark:bg-slate-900',
          'fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:transition-none',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
          'md:static md:translate-x-0 md:z-auto',
        )}
      >

        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-200 dark:border-slate-800
                        flex items-center justify-between gap-2">
          <Link href="/dashboard" className="text-lg font-bold tracking-tight
                                             hover:text-blue-600 transition-colors">
            AutoConnect
          </Link>
          {/* Fechar a gaveta — no desktop a sidebar é fixa, então não aparece */}
          <button
            onClick={() => setMenuOpen(false)}
            aria-label="Fechar menu"
            className="md:hidden p-1.5 -mr-1.5 rounded-lg text-slate-500
                       hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {nav.map(({ href, label, icon: Icon, badge: showBadge }) => {
            const active     = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            const badgeCount = showBadge
              ? leadsNew
              : href === '/agendamentos' ? apptBadge
              : href === '/chat'         ? chatBadge : 0;

            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                  active
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                <Icon size={16} />
                {label}

                <span className="ml-auto flex items-center gap-1.5">
                  {/* Badge de notificação */}
                  {badgeCount > 0 && (
                    <span className={cn(
                      'flex items-center justify-center min-w-[18px] h-[18px] px-1',
                      'text-[10px] font-bold rounded-full',
                      active
                        ? 'bg-white/25 text-white'
                        : 'bg-blue-600 text-white',
                    )}>
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                  {active && badgeCount === 0 && (
                    <ChevronRight size={14} />
                  )}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Tema */}
        <div className="px-3 pb-2">
          <ThemeToggle compacto preencher />
        </div>

        {/* Notificações do navegador */}
        <NotificationPrompt />

        {/* User */}
        <div className="px-3 py-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
            <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-500/20
                            flex items-center justify-center shrink-0">
              <span className="text-blue-600 dark:text-blue-400 text-xs font-bold">
                {user?.fullName?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate leading-tight">{user?.fullName}</p>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm
                       text-slate-600 dark:text-slate-400
                       hover:bg-slate-100 dark:hover:bg-slate-800
                       hover:text-rose-500 transition-all"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto flex flex-col min-w-0">
        {/* Barra só do mobile: dá acesso ao menu, que aqui fica escondido */}
        <div className="md:hidden sticky top-0 z-20 flex items-center gap-3 px-4 h-14
                        border-b border-slate-200 dark:border-slate-800
                        bg-white dark:bg-slate-900">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            className="p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-400
                       hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <Menu size={20} />
          </button>
          <Link href="/dashboard" className="font-bold tracking-tight">AutoConnect</Link>

          {/* Total de pendências, já que os badges do menu ficam ocultos */}
          {leadsNew + apptBadge + chatBadge > 0 && (
            <span className="ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5
                             text-[11px] font-bold rounded-full bg-blue-600 text-white">
              {leadsNew + apptBadge + chatBadge > 99 ? '99+' : leadsNew + apptBadge + chatBadge}
            </span>
          )}
        </div>

        {ann && <AnnouncementBanner ann={ann} onDismiss={dismiss} />}
        <div className="flex-1">{children}</div>
      </main>
    </div>
  );
}
