'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';

export default function AuthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      router.replace('/login');
      return;
    }

    const redirect = params.get('redirect') ?? '/dashboard';

    api<{ id: string; email: string; fullName: string; role: string; tenantId: string | null }>(
      '/users/me',
      { token },
    )
      .then((user) => {
        setSession(token, user);
        router.replace(redirect);
      })
      .catch(() => router.replace('/login'));
  }, [params, router, setSession]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-slate-500 text-sm">Autenticando…</p>
    </div>
  );
}
