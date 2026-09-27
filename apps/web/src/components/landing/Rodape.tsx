import Link from 'next/link';
import Logo from '@/components/Logo';

/** "Buscar veículos" mora aqui: é o caminho do comprador, e o hero é do lojista. */
export default function Rodape() {
  return (
    <footer className="border-t border-slate-100 dark:border-slate-800 pb-20 sm:pb-0">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <Logo />
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
          <Link href="/login" className="hover:text-slate-600">Painel da concessionária</Link>
          <Link href="/entrar" className="hover:text-slate-600">Área do cliente</Link>
          <Link href="/buscar" className="hover:text-slate-600">Buscar veículos</Link>
          <Link href="/termos" className="hover:text-slate-600">Termos</Link>
          <Link href="/privacidade" className="hover:text-slate-600">Privacidade</Link>
        </div>
        <p className="text-xs text-slate-400">© 2026 AutoConnect. Todos os direitos reservados.</p>
      </div>
    </footer>
  );
}
