'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, UserPlus, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { AuthUser } from '@/store/auth';

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router     = useRouter();
  const setSession = useAuthStore((s) => s.setSession);

  const [fullName,  setFullName]  = useState('');
  const [password,  setPassword]  = useState('');
  const [phone,     setPhone]     = useState('');
  const [showPass,  setShowPass]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const data = await api<{ accessToken: string; user: AuthUser }>(
        '/public/invitations/accept',
        { method: 'POST', body: { token, fullName, password, phone: phone || undefined } },
      );
      setSession(data.accessToken, data.user);
      router.replace('/dashboard');
    } catch (err: unknown) {
      setError((err as { message?: string }).message ?? 'Link inválido ou expirado');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <UserPlus size={20} className="text-white" />
          </div>
          <h1 className="text-xl font-bold">Bem-vindo à equipe!</h1>
          <p className="text-sm text-slate-500 mt-1">Crie sua senha para acessar o painel</p>
        </div>

        <form onSubmit={submit} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-sm">
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block mb-1">Seu nome</label>
            <input
              type="text" required minLength={2} value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder="Nome completo"
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500 transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block mb-1">Telefone (opcional)</label>
            <input
              type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 99999-9999"
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500 transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block mb-1">Senha</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="w-full px-3 py-2.5 pr-10 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500 transition"
              />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition">
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-rose-500 bg-rose-50 dark:bg-rose-950/20 rounded-lg px-3 py-2">{error}</p>}

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Entrar na equipe
          </button>
        </form>
      </div>
    </div>
  );
}
