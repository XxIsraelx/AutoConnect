'use client';


import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useAuthStore, type AuthUser } from '@/store/auth';
import { api } from '@/lib/api';

export default function VerificarEmailPage() {
  const router = useRouter();
  const params = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setErrorMsg('Link inválido — nenhum token encontrado.');
      return;
    }

    api<{ accessToken: string; user: AuthUser }>(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then((data) => {
        setSession(data.accessToken, data.user);
        setStatus('success');
        setTimeout(() => router.replace('/buscar'), 2500);
      })
      .catch((err) => {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Link inválido ou expirado.');
      });
  }, [params, router, setSession]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 shadow-sm text-center max-w-sm w-full">
        {status === 'loading' && (
          <>
            <Loader2 size={40} className="text-brand-accent animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Verificando seu e-mail…</h2>
            <p className="text-sm text-slate-500">Aguarde um momento.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 size={48} className="text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">E-mail confirmado!</h2>
            <p className="text-sm text-slate-500 mb-4">
              Sua conta está ativa. Redirecionando…
            </p>
            <Link href="/buscar" className="text-sm text-brand-accent hover:underline font-medium">
              Ir agora para a busca →
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle size={48} className="text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Link inválido</h2>
            <p className="text-sm text-slate-500 mb-6">{errorMsg}</p>
            <div className="space-y-2">
              <Link
                href="/cadastrar"
                className="block w-full text-center bg-brand-accent text-white text-sm font-medium py-2.5 rounded-xl hover:bg-blue-600 transition"
              >
                Criar uma nova conta
              </Link>
              <Link href="/entrar" className="block text-sm text-slate-400 hover:underline">
                Voltar para o login
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
