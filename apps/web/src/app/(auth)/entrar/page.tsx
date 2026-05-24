'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, MailWarning, CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore, type AuthUser } from '@/store/auth';

type ErrorKind = 'invalid_credentials' | 'email_not_verified' | 'generic';

export default function CustomerLoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone, setResendDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKind(null);
    setResendDone(false);
    setLoading(true);
    try {
      const data = await api<{ accessToken: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setSession(data.accessToken, data.user);
      router.replace('/buscar');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.message.includes('Confirme seu e-mail')) {
          setErrorKind('email_not_verified');
        } else if (err.status === 401) {
          setErrorKind('invalid_credentials');
        } else {
          setErrorKind('generic');
        }
      } else {
        setErrorKind('generic');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResendLoading(true);
    try {
      await api('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setResendDone(true);
    } finally {
      setResendLoading(false);
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
      <div className="mb-6">
        <div className="text-2xl font-bold tracking-tight mb-1">AutoConnect</div>
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Bem-vindo de volta</h2>
        <p className="text-sm text-slate-500 mt-1">Entre para ver seus veículos favoritos e conversas</p>
      </div>

      <a
        href={`${apiUrl}/api/v1/auth/google`}
        className="flex items-center justify-center gap-3 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2.5 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition mb-5"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
          <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 2.9l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.9z"/>
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.1 7.9 2.9l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8H6.2C9.5 35.6 16.3 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41.1 36.2 44 30.6 44 24c0-1.3-.1-2.7-.4-3.9z"/>
        </svg>
        Continuar com Google
      </a>

      <div className="relative flex items-center mb-5">
        <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
        <span className="px-3 text-xs text-slate-400">ou entre com e-mail</span>
        <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">E-mail</label>
          <input
            type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
            placeholder="seu@email.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium">Senha</label>
            <Link href="/esqueci-minha-senha" className="text-xs text-brand-accent hover:underline">
              Esqueci minha senha
            </Link>
          </div>
          <input
            type="password" required autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
            placeholder="••••••••"
          />
        </div>

        {/* Erro: credenciais inválidas */}
        {errorKind === 'invalid_credentials' && (
          <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-700 dark:text-red-400">E-mail ou senha incorretos</p>
                <p className="text-xs text-red-500 mt-0.5">
                  Verifique seus dados ou{' '}
                  <Link href="/esqueci-minha-senha" className="underline font-medium">
                    redefina sua senha
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Erro: e-mail não verificado */}
        {errorKind === 'email_not_verified' && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4">
            <div className="flex items-start gap-3">
              <MailWarning size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">E-mail não confirmado</p>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5 mb-3">
                  Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada ou reenvie o link.
                </p>
                {resendDone ? (
                  <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
                    <CheckCircle2 size={13} /> Novo link enviado! Verifique sua caixa de entrada.
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendLoading}
                    className="text-xs font-semibold text-amber-700 dark:text-amber-400 underline disabled:opacity-50"
                  >
                    {resendLoading ? 'Enviando…' : 'Reenviar link de confirmação'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Erro genérico */}
        {errorKind === 'generic' && (
          <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
            Algo deu errado. Tente novamente em instantes.
          </p>
        )}

        <button
          type="submit" disabled={loading}
          className="w-full rounded-lg bg-brand-accent text-white font-medium py-2.5 text-sm hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">
        Ainda não tem conta?{' '}
        <Link href="/cadastrar" className="text-brand-accent hover:underline font-medium">Criar conta grátis</Link>
      </p>
      <p className="mt-2 text-center text-xs text-slate-400">
        É uma concessionária?{' '}
        <Link href="/login" className="hover:underline">Acesse o painel</Link>
      </p>
    </div>
  );
}
