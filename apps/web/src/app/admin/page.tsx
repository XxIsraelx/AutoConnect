'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, Ticket, Building2, Users, Megaphone, ClipboardList, Activity,
  Banknote, LogOut, RefreshCw,
} from 'lucide-react';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';
import { Toast, criarChamar, type PropsDaAba } from './comum';
import { AbaVisaoGeral } from './AbaVisaoGeral';
import { AbaConvites } from './AbaConvites';
import { AbaConcessionarias } from './AbaConcessionarias';
import { AbaUsuarios } from './AbaUsuarios';
import { AbaAvisos } from './AbaAvisos';
import { AbaAuditoria } from './AbaAuditoria';
import { AbaSistema } from './AbaSistema';
import { AbaSaques } from './AbaSaques';

type Tab = 'overview' | 'invites' | 'tenants' | 'users' | 'announcements' | 'saques' | 'audit' | 'system';

const NAV: { id: Tab; label: string; icon: React.ElementType; Aba: (p: PropsDaAba) => JSX.Element }[] = [
  { id: 'overview',      label: 'Visão geral',     icon: LayoutDashboard, Aba: AbaVisaoGeral },
  { id: 'tenants',       label: 'Concessionárias', icon: Building2,       Aba: AbaConcessionarias },
  { id: 'users',         label: 'Usuários',        icon: Users,           Aba: AbaUsuarios },
  { id: 'invites',       label: 'Convites',        icon: Ticket,          Aba: AbaConvites },
  { id: 'announcements', label: 'Avisos',          icon: Megaphone,       Aba: AbaAvisos },
  // Saída de dinheiro da conta da plataforma. Aba própria, e não dentro de
  // Concessionárias: ali é o que as lojas pagam; aqui é o que sai do caixa.
  { id: 'saques',        label: 'Saques',          icon: Banknote,        Aba: AbaSaques },
  { id: 'audit',         label: 'Auditoria',       icon: ClipboardList,   Aba: AbaAuditoria },
  { id: 'system',        label: 'Sistema',         icon: Activity,        Aba: AbaSistema },
];

/**
 * Painel do super admin.
 *
 * Cada aba mora num arquivo próprio e carrega os próprios dados, com o próprio
 * estado de erro. Este arquivo só monta a moldura: cabeçalho, barra de abas
 * (que rola na horizontal no celular, sem empurrar a página) e o toast das ações.
 */
export default function AdminPage() {
  const router = useRouter();
  const { token, user, clear } = useAuthStore();

  const [tab, setTab] = useState<Tab>('overview');
  const [sinal, setSinal] = useState(0);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);
  const relogioDoToast = useRef<ReturnType<typeof setTimeout>>();
  const barraRef = useRef<HTMLElement>(null);

  // Na hidratação o store ainda devolve o estado do servidor (sem token): sem
  // esperar por ela, recarregar /admin mandava o super admin para o /login.
  const [hidratado, setHidratado] = useState(false);
  useEffect(() => { setHidratado(true); }, []);

  useEffect(() => {
    if (!hidratado) return;
    if (!token) { router.replace('/login'); return; }
    if (user?.role !== 'super_admin') router.replace('/dashboard');
  }, [hidratado, token, user, router]);

  // No celular a aba escolhida pode estar fora da área visível da barra.
  useEffect(() => {
    barraRef.current?.querySelector<HTMLElement>(`[data-aba="${tab}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  const chamar = useMemo(() => criarChamar(token ?? ''), [token]);

  function avisar(msg: string, kind: 'success' | 'error' = 'success') {
    clearTimeout(relogioDoToast.current);
    setToast({ msg, kind });
    relogioDoToast.current = setTimeout(() => setToast(null), 3500);
  }

  if (!hidratado || !token || user?.role !== 'super_admin') return null;

  const atual = NAV.find((n) => n.id === tab)!;
  const Aba = atual.Aba;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {toast && <Toast msg={toast.msg} kind={toast.kind} />}

      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 flex items-center gap-2 sm:gap-3">
          <Link href="/admin" className="text-base sm:text-lg hover:opacity-80 transition-opacity shrink-0">
            <Logo />
          </Link>
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-600 text-white shrink-0">
            Admin
          </span>

          <div className="ml-auto flex items-center gap-0.5 sm:gap-2 min-w-0">
            <div className="hidden md:block text-right min-w-0 mr-1">
              <p className="text-sm font-medium truncate leading-tight">{user?.fullName}</p>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
            </div>
            <ThemeToggle compacto />
            <button
              onClick={() => { clear(); router.replace('/login'); }}
              aria-label="Sair" title="Sair"
              className="p-2 rounded-lg text-slate-500 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-2 sm:px-4">
          <nav
            ref={barraRef}
            aria-label="Seções do painel"
            className="flex gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mb-px"
          >
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                data-aba={id}
                onClick={() => setTab(id)}
                aria-current={tab === id ? 'page' : undefined}
                className={cn(
                  'shrink-0 flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition',
                  tab === id
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white',
                )}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <div className="flex items-center justify-between gap-3 mb-5 sm:mb-6">
          <h1 className="text-lg sm:text-xl font-bold">{atual.label}</h1>
          <button
            onClick={() => setSinal((n) => n + 1)}
            aria-label="Atualizar" title="Atualizar"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition"
          >
            <RefreshCw size={14} className="text-slate-500" />
          </button>
        </div>

        {/* `key` por aba: trocar de aba monta a nova do zero, com carga própria. */}
        <Aba key={tab} chamar={chamar} avisar={avisar} sinal={sinal} />
      </main>
    </div>
  );
}
