'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

function RedefinirForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('A senha deve ter no mínimo 8 caracteres.'); return; }
    if (password !== confirm) { setError('As senhas não coincidem.'); return; }

    setError('');
    setLoading(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
      setTimeout(() => router.replace('/entrar'), 3000);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Algo deu errado. Tente novamente.',
      );
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-sm text-slate-500 mb-4">Link inválido ou expirado.</p>
        <Link href="/esqueci-minha-senha" className="text-sm text-brand-accent hover:underline font-medium">
          Solicitar novo link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle2 size={48} className="text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">Senha redefinida!</h2>
        <p className="text-sm text-slate-500 mb-4">
          Sua senha foi atualizada com sucesso. Redirecionando para o login…
        </p>
        <Link href="/entrar" className="text-sm text-brand-accent hover:underline font-medium">
          Ir para o login →
        </Link>
      </div>
    );
  }

  return (
    <>
      <h2 className="text-xl font-bold mb-1">Criar nova senha</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Escolha uma senha segura com pelo menos 8 caracteres.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">Nova senha</label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {/* Indicador de força */}
          {password.length > 0 && (
            <div className="mt-2 flex gap-1">
              {[1, 2, 3, 4].map((level) => {
                const strength = Math.min(4, Math.floor(password.length / 3) + (password.length >= 8 ? 1 : 0));
                return (
                  <div
                    key={level}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      level <= strength
                        ? strength <= 1 ? 'bg-red-400' : strength <= 2 ? 'bg-orange-400' : strength <= 3 ? 'bg-yellow-400' : 'bg-green-400'
                        : 'bg-slate-100 dark:bg-slate-700'
                    }`}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">Confirmar nova senha</label>
          <input
            type={showPass ? 'text' : 'password'}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repita a senha"
            autoComplete="new-password"
            className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent bg-white dark:bg-slate-800 transition ${
              confirm && confirm !== password
                ? 'border-red-400 focus:ring-red-300'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          />
          {confirm && confirm !== password && (
            <p className="text-xs text-red-500 mt-1">As senhas não coincidem</p>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            {error.includes('expirado') && (
              <Link href="/esqueci-minha-senha" className="text-xs text-red-600 dark:text-red-400 underline mt-1 block">
                Solicitar novo link
              </Link>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !password || password !== confirm}
          className="w-full rounded-lg bg-brand-accent text-white font-medium py-2.5 text-sm hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Salvando…' : 'Salvar nova senha'}
        </button>
      </form>
    </>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm max-w-sm w-full">
      <Suspense>
        <RedefinirForm />
      </Suspense>
    </div>
  );
}
