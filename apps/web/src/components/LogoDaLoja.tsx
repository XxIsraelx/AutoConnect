import { cn } from '@/lib/utils';

/** Azul do produto, quando a loja não escolheu cor. */
export const COR_PADRAO_DA_LOJA = '#2563eb';

/**
 * Logo da loja nas páginas públicas — a vitrine (`/c/[slug]`) e o catálogo
 * (`/catalogo/[id]`). Sem logo, a inicial sobre a cor da loja.
 *
 * Existe porque as duas páginas desenhavam cada uma o seu: a vitrine usava o
 * logo e a cor, o catálogo pintava as iniciais num gradiente azul fixo. Quem
 * clicava num carro da vitrine via a identidade da loja sumir na página
 * seguinte.
 *
 * `<img>` e não `next/image`: o logo pode ser `data:` (upload antigo) ou de
 * qualquer host, e é pequeno demais para valer a otimização.
 */
export default function LogoDaLoja({
  nome,
  logoUrl,
  cor,
  className,
}: {
  nome: string;
  logoUrl: string | null | undefined;
  cor: string | null | undefined;
  /** Tamanho, arredondamento e fonte da inicial — ex.: `w-12 h-12 rounded-xl text-lg`. */
  className: string;
}) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={nome} className={cn('object-contain shrink-0', className)} />;
  }
  return (
    <div
      aria-hidden
      className={cn('flex items-center justify-center shrink-0 text-white font-bold', className)}
      style={{ background: cor ?? COR_PADRAO_DA_LOJA }}
    >
      {nome.charAt(0).toUpperCase()}
    </div>
  );
}

/** Faixa fina com a cor da loja, no topo das páginas públicas dela. */
export function FaixaDaLoja({ cor }: { cor: string | null | undefined }) {
  const c = cor ?? COR_PADRAO_DA_LOJA;
  return <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${c}, ${c}88, transparent)` }} />;
}
