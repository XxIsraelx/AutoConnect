import Link from 'next/link';
import { ApiHealth } from '@/components/ApiHealth';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight">AutoConnect</h1>
        <p className="mt-3 text-lg text-slate-600 dark:text-slate-300">
          Plataforma operacional para concessionárias.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/signup"
          className="rounded-xl border border-slate-200 p-6 transition hover:border-brand-accent dark:border-slate-700"
        >
          <h2 className="text-xl font-semibold">Sou concessionária</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Criar minha conta e começar o trial.
          </p>
        </Link>

        <Link
          href="/buscar"
          className="rounded-xl border border-slate-200 p-6 transition hover:border-brand-accent dark:border-slate-700"
        >
          <h2 className="text-xl font-semibold">Quero comprar um carro</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Buscar veículos por marca, modelo ou cidade.
          </p>
        </Link>
      </section>

      <footer className="mt-16 border-t border-slate-200 pt-6 dark:border-slate-700">
        <ApiHealth />
      </footer>
    </main>
  );
}
