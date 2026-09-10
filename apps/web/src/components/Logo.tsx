import { cn } from '@/lib/utils';
import { LOGO_PATH, LOGO_VIEWBOX } from './logo-path';

/** Azul da marca, o mesmo do arquivo vetorizado. */
export const COR_DA_MARCA = '#3977DA';

/**
 * Só o símbolo. A cor vem de `currentColor`, então quem usa decide pelo
 * `text-*` — branco sobre fundo azul, azul sobre fundo neutro.
 *
 * Sem `titulo`, é decorativo (aria-hidden): quase sempre o nome
 * "AutoConnect" está escrito ao lado, e o leitor de tela não precisa ouvir
 * a marca duas vezes.
 */
export function LogoMarca({ className, titulo }: { className?: string; titulo?: string }) {
  return (
    <svg
      viewBox={LOGO_VIEWBOX}
      fill="currentColor"
      className={cn('text-[#3977DA]', className)}
      role={titulo ? 'img' : undefined}
      aria-label={titulo}
      aria-hidden={titulo ? undefined : true}
    >
      <path d={LOGO_PATH} fillRule="evenodd" />
    </svg>
  );
}

/**
 * Símbolo + nome. O símbolo é medido em `em`, então acompanha o tamanho de
 * fonte de quem envolve: `text-lg` no cabeçalho, `text-2xl` no login — sem
 * uma prop de tamanho para cada lugar.
 */
export default function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-[0.45em] font-bold tracking-tight', className)}>
      <LogoMarca className="h-[1.15em] w-auto shrink-0" />
      <span>AutoConnect</span>
    </span>
  );
}
