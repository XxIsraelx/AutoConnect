import Link from 'next/link';
import Logo from '@/components/Logo';

/** Contato público para privacidade e suporte — o mesmo de `ErroAoCarregar`. */
export const CONTATO_LEGAL = 'contato@autoconnect.app';

/** Data de vigência exibida nas duas páginas. Mude junto com o texto. */
export const VIGENCIA_LEGAL = '22 de setembro de 2026';

/**
 * Moldura das páginas de Termos e Privacidade. São públicas (o Google exige os
 * links para publicar o login com Google) e ficam fora do layout do dashboard.
 */
export default function PaginaLegal({
  titulo,
  resumo,
  children,
}: {
  titulo: string;
  resumo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300">
      <header className="border-b border-slate-100 dark:border-slate-800">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <Link href="/" aria-label="Início">
            <Logo />
          </Link>
          <nav className="flex items-center gap-4 text-sm text-slate-500">
            <Link href="/termos" className="hover:text-slate-800 dark:hover:text-white">Termos</Link>
            <Link href="/privacidade" className="hover:text-slate-800 dark:hover:text-white">Privacidade</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{titulo}</h1>
        <p className="mt-2 text-sm text-slate-500">Vigente desde {VIGENCIA_LEGAL}</p>
        <p className="mt-6 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 text-sm leading-relaxed">
          {resumo}
        </p>

        <div
          className="mt-8 space-y-4 text-[15px] leading-relaxed
                     [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 dark:[&_h2]:text-white
                     [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-slate-900 dark:[&_h3]:text-white
                     [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5
                     [&_a]:text-blue-600 [&_a]:underline-offset-2 hover:[&_a]:underline
                     [&_strong]:text-slate-900 dark:[&_strong]:text-white"
        >
          {children}
        </div>
      </main>

      <footer className="border-t border-slate-100 dark:border-slate-800">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 text-xs text-slate-400 flex flex-col sm:flex-row justify-between gap-2">
          <p>© 2026 AutoConnect</p>
          <a href={`mailto:${CONTATO_LEGAL}`} className="hover:text-slate-600">{CONTATO_LEGAL}</a>
        </div>
      </footer>
    </div>
  );
}
