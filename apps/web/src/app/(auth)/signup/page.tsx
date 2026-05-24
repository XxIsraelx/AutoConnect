'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore, type AuthUser } from '@/store/auth';

export default function SignupPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);

  const [form, setForm] = useState({
    legalName: '',
    tradeName: '',
    slug: '',
    primaryEmail: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toSlug(value: string) {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api<{ accessToken: string; user: AuthUser }>(
        '/auth/signup-tenant',
        {
          method: 'POST',
          body: JSON.stringify({
            tenant: {
              legalName: form.legalName,
              tradeName: form.tradeName,
              slug: form.slug,
              primaryEmail: form.primaryEmail,
            },
            admin: {
              fullName: form.adminName,
              email: form.adminEmail,
              password: form.adminPassword,
            },
          }),
        },
      );
      setSession(data.accessToken, data.user);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
      <h2 className="text-xl font-semibold mb-1">Cadastrar concessionária</h2>
      <p className="text-sm text-slate-500 mb-6">14 dias grátis, sem cartão de crédito.</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Dados da concessionária
          </legend>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">Razão social</label>
              <input
                required
                value={form.legalName}
                onChange={(e) => {
                  set('legalName', e.target.value);
                  if (!form.tradeName) set('tradeName', e.target.value);
                  if (!form.slug) set('slug', toSlug(e.target.value));
                }}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
                placeholder="Minha Auto Ltda"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Nome fantasia</label>
              <input
                required
                value={form.tradeName}
                onChange={(e) => set('tradeName', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
                placeholder="Minha Auto"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Identificador único (slug)
              </label>
              <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden focus-within:ring-2 focus-within:ring-brand-accent">
                <span className="px-3 py-2 text-sm text-slate-400 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 select-none">
                  autoconnect.app/
                </span>
                <input
                  required
                  pattern="[a-z0-9\-]+"
                  value={form.slug}
                  onChange={(e) => set('slug', e.target.value)}
                  className="flex-1 px-3 py-2 text-sm outline-none bg-transparent"
                  placeholder="minha-auto"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">E-mail da concessionária</label>
              <input
                type="email"
                required
                value={form.primaryEmail}
                onChange={(e) => set('primaryEmail', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
                placeholder="contato@minhauto.com"
              />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Seu acesso de administrador
          </legend>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">Seu nome completo</label>
              <input
                required
                value={form.adminName}
                onChange={(e) => set('adminName', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
                placeholder="Israel Aureliano"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Seu e-mail</label>
              <input
                type="email"
                required
                value={form.adminEmail}
                onChange={(e) => set('adminEmail', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
                placeholder="voce@minhauto.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Senha (mín. 8 caracteres)</label>
              <input
                type="password"
                required
                minLength={8}
                value={form.adminPassword}
                onChange={(e) => set('adminPassword', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
                placeholder="••••••••"
              />
            </div>
          </div>
        </fieldset>

        {error && (
          <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-accent text-white font-medium py-2 text-sm hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Criando conta…' : 'Criar conta grátis'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Já tem conta?{' '}
        <Link href="/login" className="text-brand-accent hover:underline font-medium">
          Entrar
        </Link>
      </p>
    </div>
  );
}
