import Link from 'next/link';
import { Info } from 'lucide-react';

/**
 * Faixa da loja de demonstração (`tenants.is_demo`), no topo da vitrine e da
 * página do carro. Quem chega aqui pela landing é lojista vendo o produto; um
 * comprador que caia por link direto precisa saber, antes de mandar interesse,
 * que a loja e os carros não existem.
 */
export default function AvisoDeDemonstracao() {
  return (
    <div role="note" className="bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200 border-b border-amber-200 dark:border-amber-500/20">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-start sm:items-center gap-2 text-sm">
        <Info size={16} className="shrink-0 mt-0.5 sm:mt-0" />
        <p>
          <strong>Loja de demonstração.</strong> Os carros e os contatos não são reais — esta vitrine
          mostra como o AutoConnect funciona para uma loja.{' '}
          <Link href="/" className="underline font-medium whitespace-nowrap">
            Conhecer o AutoConnect
          </Link>
        </p>
      </div>
    </div>
  );
}
