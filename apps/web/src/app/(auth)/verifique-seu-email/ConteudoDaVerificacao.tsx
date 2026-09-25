'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MailCheck, Loader2, Check, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * Tela depois do cadastro do consumidor final.
 *
 * **Ganhou o "reenviar" que faltava.** O piloto do primeiro dia registrou o
 * beco: o cliente que não recebia o e-mail não tinha botão nenhum aqui, e o
 * único caminho era se cadastrar de novo — com um endereço que já estava em
 * uso, o que devolvia "email já cadastrado". A conta ficava inacessível para
 * sempre por causa de um e-mail que caiu no spam.
 *
 * O e-mail chega pela URL (`?email=`) quando o cadastro o passa; sem ele, a
 * pessoa digita. A API responde a mesma frase existindo ou não o endereço, de
 * propósito — a tela não pode virar um jeito de descobrir quem tem conta.
 */
export default function ConteudoDaVerificacao() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');

  async function reenviar(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setErro('Informe o e-mail que você usou no cadastro.');
      return;
    }
    setEnviando(true);
    setErro('');
    try {
      await api('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setEnviado(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível reenviar agora.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 sm:p-10 shadow-sm text-center max-w-sm w-full">
      <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center mx-auto mb-5">
        <MailCheck size={32} className="text-brand-accent" />
      </div>

      <h2 className="text-xl font-bold mb-2">Verifique seu e-mail</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
        Enviamos um link de confirmação para o seu e-mail. Clique no link para ativar sua conta e começar a usar o AutoConnect.
      </p>

      <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-xs text-slate-500 dark:text-slate-400 text-left mb-6 space-y-1.5">
        <p>• Verifique também a pasta de spam</p>
        <p>• O link expira em 24 horas</p>
        <p>• Você só consegue entrar após confirmar</p>
      </div>

      {enviado ? (
        <p className="flex items-center justify-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 mb-6">
          <Check size={14} /> Link reenviado. Confira a caixa de entrada e o spam.
        </p>
      ) : (
        <form onSubmit={reenviar} className="text-left mb-6">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Não recebeu?</label>
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErro(''); }}
              placeholder="seu@email.com"
              autoComplete="email"
              className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition"
            />
            <button
              type="submit"
              disabled={enviando}
              className="shrink-0 flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
            >
              {enviando ? <Loader2 size={13} className="animate-spin" /> : 'Reenviar'}
            </button>
          </div>
          {erro && (
            <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400 mt-2">
              <AlertCircle size={12} className="shrink-0 mt-0.5" /> {erro}
            </p>
          )}
        </form>
      )}

      <Link
        href="/entrar"
        className="block w-full text-center text-sm font-medium text-brand-accent hover:underline"
      >
        Já confirmei → Entrar
      </Link>
    </div>
  );
}
