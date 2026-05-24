import Link from 'next/link';
import { Car, Search } from 'lucide-react';

export default function BuscarPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      {/* Header */}
      <header className="mb-10">
        <div className="flex items-center justify-between mb-6">
          <span className="text-xl font-bold tracking-tight">AutoConnect</span>
          <div className="flex items-center gap-3">
            <Link href="/entrar" className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
              Entrar
            </Link>
            <Link
              href="/cadastrar"
              className="text-sm bg-brand-accent text-white px-4 py-1.5 rounded-lg hover:bg-blue-600 transition"
            >
              Criar conta
            </Link>
          </div>
        </div>

        <h1 className="text-3xl font-bold tracking-tight">Encontre seu próximo carro</h1>
        <p className="mt-2 text-slate-500">
          Explore o estoque de concessionárias parceiras
        </p>
      </header>

      {/* Search bar (placeholder) */}
      <div className="relative mb-10">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Buscar por marca, modelo, cidade…"
          className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm shadow-sm outline-none focus:ring-2 focus:ring-brand-accent"
          readOnly
        />
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center py-24 gap-4 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
        <Car size={48} className="text-slate-300" />
        <p className="text-slate-500 font-medium text-lg">Catálogo público em breve</p>
        <p className="text-sm text-slate-400 text-center max-w-sm">
          Assim que concessionárias cadastrarem seus veículos, eles aparecerão aqui para busca e comparação.
        </p>
        <div className="flex gap-3 mt-2">
          <Link href="/entrar" className="text-sm text-brand-accent hover:underline font-medium">
            Entrar na minha conta
          </Link>
          <span className="text-slate-300">·</span>
          <Link href="/" className="text-sm text-slate-500 hover:underline">
            Voltar ao início
          </Link>
        </div>
      </div>
    </main>
  );
}
