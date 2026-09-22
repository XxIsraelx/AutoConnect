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

    // Só caminho interno: `redirect` vem da URL, e `//site` ou `https://…`
    // levariam a pessoa, já logada, para fora do AutoConnect.
    const pedido = params.get('redirect');
    const redirect = pedido?.startsWith('/') && !pedido.startsWith('//') ? pedido : '/dashboard';

    api<{ id: string; email: string; fullName: string; role: string; tenantId: string | null }>(
      '/users/me',
      { token },
    )
      .then((user) => {
        setSession(token, user);
        router.replace(redirect);
      })
      // Token do Google sem usuário válido: a sessão não é gravada e a pessoa
      // volta ao login, onde pode tentar de novo — não há o que exibir aqui.
      .catch(() => router.replace('/login'));
  }, [params, router, setSession]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-slate-500 text-sm">Autenticando…</p>
    </div>
  );
}
