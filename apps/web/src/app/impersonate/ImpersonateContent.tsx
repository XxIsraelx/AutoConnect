'use client';


import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore, type AuthUser } from '@/store/auth';
import { Loader2 } from 'lucide-react';

/**
 * Página de impersonação — recebe token + user via query string,
 * seta a sessão e redireciona para /dashboard.
 * Usada exclusivamente pelo painel admin.
 */
export default function ImpersonatePage() {
  const router     = useRouter();
  const params     = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    const token = params.get('token');
    const raw   = params.get('user');
    if (!token || !raw) { router.replace('/login'); return; }

    try {
      const user = JSON.parse(decodeURIComponent(raw)) as AuthUser;
      setSession(token, user);
      router.replace('/dashboard');
    } catch {
      router.replace('/login');
    }
  }, [params, router, setSession]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="flex items-center gap-3 text-slate-500">
        <Loader2 size={20} className="animate-spin" />
        <span className="text-sm">Entrando como concessionária…</span>
      </div>
    </div>
  );
}
