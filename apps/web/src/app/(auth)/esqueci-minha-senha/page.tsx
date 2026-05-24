'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MailCheck, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';

function EsqueciForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center mx-auto mb-5">
          <MailCheck size={28} className="text-brand-accent" />
        </div>
        <h2 className="text-xl font-bold mb-2">Verifique seu e-mail</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
          Se existir uma conta com <strong className="text-slate-700 dark:text-slate-200">{email}</strong>,
          você receberá um link para redefinir sua senha em instantes.
        </p>
        <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 text-xs text-slate-500 space-y-1 text-left mb-6">
          <p>• Verifique também a pasta de spam</p>
          <p>• O link expira em 1 hora</p>
        </div>
        <Link href="/entrar" className="text-sm text-brand-accent hover:underline font-medium">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <>
      <Link href="/entrar" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5">
        <ArrowLeft size={15} /> Voltar para o login
      </Link>

      <h2 className="text-xl font-bold mb-1">Esqueceu sua senha?</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Digite seu e-mail e enviaremos um link para criar uma nova senha.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">E-mail cadastrado</label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-accent text-white font-medium py-2.5 text-sm hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Enviando…' : 'Enviar link de redefinição'}
        </button>
      </form>
    </>
  );
}

export default function EsqueciSenhaPage() {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm max-w-sm w-full">
      <Suspense>
        <EsqueciForm />
      </Suspense>
    </div>
  );
}
