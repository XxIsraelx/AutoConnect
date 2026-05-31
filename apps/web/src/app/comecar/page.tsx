import Link from 'next/link';
import type { Metadata } from 'next';
import { Building2, Car, ArrowRight, ArrowLeft, Check } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Começar — AutoConnect',
  description: 'Escolha como quer usar o AutoConnect: cadastrar sua concessionária ou buscar veículos.',
};

const options = [
  {
    href: '/signup',
    icon: Building2,
    badge: 'Para lojistas',
    title: 'Tenho uma concessionária',
    desc: 'Gerencie estoque, leads, chat e agendamentos em um só lugar.',
    bullets: ['Estoque ilimitado de veículos', 'Leads e chat em tempo real', '14 dias grátis, sem cartão'],
    cta: 'Cadastrar concessionária',
    accent: 'blue',
  },
  {
    href: '/cadastrar',
    icon: Car,
    badge: 'Para compradores',
    title: 'Quero buscar um veículo',
    desc: 'Encontre carros de concessionárias perto de você e fale direto com elas.',
    bullets: ['Busca por localização', 'Favoritos e alertas de preço', 'Converse com a loja pelo chat'],
    cta: 'Criar conta de cliente',
    accent: 'emerald',
  },
] as const;

export default function ComecarPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Navbar simples */}
      <nav className="border-b border-slate-100 dark:border-slate-800">
        <div className="mx-auto max-w-5xl px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition">
            <ArrowLeft size={16} /> Voltar
          </Link>
          <span className="text-lg font-bold tracking-tight">AutoConnect</span>
          <Link href="/login" className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition">
            Entrar
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-blue-50 dark:bg-blue-950/40 text-brand-accent text-xs font-semibold px-3 py-1.5 rounded-full mb-5">
            Bem-vindo ao AutoConnect
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">
            Como você quer começar?
          </h1>
          <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            Escolha a opção que combina com você. Dá para mudar depois — é rápido nos dois casos.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {options.map((o) => {
            const Icon = o.icon;
            const isBlue = o.accent === 'blue';
            return (
              <Link
                key={o.href}
                href={o.href}
                className={`group relative flex flex-col rounded-2xl border-2 p-7 transition-all
                            hover:-translate-y-0.5 hover:shadow-xl
                  ${isBlue
                    ? 'border-blue-100 dark:border-blue-900/40 hover:border-blue-400 dark:hover:border-blue-600'
                    : 'border-emerald-100 dark:border-emerald-900/40 hover:border-emerald-400 dark:hover:border-emerald-600'}`}
              >
                <span className={`text-[11px] font-bold uppercase tracking-wider mb-4
                  ${isBlue ? 'text-brand-accent' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {o.badge}
                </span>

                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-5 transition-transform group-hover:scale-105
                  ${isBlue
                    ? 'bg-blue-50 dark:bg-blue-500/10 text-brand-accent'
                    : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
                  <Icon size={26} />
                </div>

                <h2 className="text-xl font-bold mb-2">{o.title}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">{o.desc}</p>

                <ul className="space-y-2 mb-7">
                  {o.bullets.map((b) => (
                    <li key={b} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <Check size={15} className={isBlue ? 'text-brand-accent shrink-0' : 'text-emerald-500 shrink-0'} />
                      {b}
                    </li>
                  ))}
                </ul>

                <span className={`mt-auto inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl
                                  text-sm font-semibold text-white transition-colors
                  ${isBlue
                    ? 'bg-brand-accent group-hover:bg-blue-600'
                    : 'bg-emerald-600 group-hover:bg-emerald-700'}`}>
                  {o.cta}
                  <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Link>
            );
          })}
        </div>

        <p className="text-center text-xs text-slate-400 mt-10">
          Já tem conta?{' '}
          <Link href="/login" className="text-brand-accent font-medium hover:underline">
            Entrar
          </Link>
        </p>
      </section>
    </div>
  );
}
