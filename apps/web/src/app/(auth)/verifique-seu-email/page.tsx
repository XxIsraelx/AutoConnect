import Link from 'next/link';
import { MailCheck } from 'lucide-react';

export default function VerifiqueEmailPage() {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 shadow-sm text-center max-w-sm">
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

      <Link
        href="/entrar"
        className="block w-full text-center text-sm font-medium text-brand-accent hover:underline"
      >
        Já confirmei → Entrar
      </Link>
    </div>
  );
}
