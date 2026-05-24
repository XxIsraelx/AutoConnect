'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Car,
  Users,
  MessageSquare,
  CalendarDays,
  Settings,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/veiculos', label: 'Veículos', icon: Car, soon: true },
  { href: '/leads', label: 'Leads', icon: Users, soon: true },
  { href: '/chat', label: 'Chat', icon: MessageSquare, soon: true },
  { href: '/agendamentos', label: 'Agendamentos', icon: CalendarDays, soon: true },
  { href: '/configuracoes', label: 'Configurações', icon: Settings, soon: true },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user, clear } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && !token) {
      router.replace('/login');
    }
  }, [hydrated, token, router]);

  if (!hydrated || !token) return null;

  function handleLogout() {
    clear();
    router.replace('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-200 dark:border-slate-800">
          <span className="text-lg font-bold tracking-tight">AutoConnect</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {nav.map(({ href, label, icon: Icon, soon }) => {
            const active = pathname === href;
            return (
              <div key={href}>
                {soon ? (
                  <span className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 cursor-not-allowed select-none">
                    <Icon size={16} />
                    {label}
                    <span className="ml-auto text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                      em breve
                    </span>
                  </span>
                ) : (
                  <Link
                    href={href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition',
                      active
                        ? 'bg-brand-accent text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
                    )}
                  >
                    <Icon size={16} />
                    {label}
                    {active && <ChevronRight size={14} className="ml-auto" />}
                  </Link>
                )}
              </div>
            );
          })}
        </nav>

        {/* User */}
        <div className="px-3 py-4 border-t border-slate-200 dark:border-slate-800">
          <div className="px-3 py-2 mb-1">
            <p className="text-sm font-medium truncate">{user?.fullName}</p>
            <p className="text-xs text-slate-500 truncate">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
