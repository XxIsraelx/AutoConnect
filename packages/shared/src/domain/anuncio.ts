/**
 * Estado do anúncio e o mínimo para ir ao ar.
 *
 * A regra mora aqui, e não no service, pelo mesmo motivo de `DEAL_TRANSITIONS`:
 * a tela precisa dizer *antes* o que falta, e a API precisa recusar *depois*.
 * Duas cópias da mesma regra é como se produz um botão "Publicar" que abre um
 * diálogo e termina em 400.
 *
 * Os valores repetem o enum `ListingStatus` do Prisma de propósito — importar
 * `@autoconnect/db` arrastaria o Prisma para o bundle do navegador.
 * `paridade-enums.spec.ts` quebra o CI se as listas divergirem.
 */

export const LISTING_STATUSES = ['draft', 'published', 'unpublished'] as const;

export type ListingStatusValue = (typeof LISTING_STATUSES)[number];

export const LISTING_STATUS_LABELS: Record<ListingStatusValue, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  unpublished: 'Despublicado',
};

/**
 * O que o anúncio precisa ter para não envergonhar a loja.
 *
 * Só o que um comprador procura antes de qualquer outra coisa — foto, preço,
 * e as três características que ele filtra na busca. A lista é curta de
 * propósito: um bloqueio longo demais vira motivo para publicar por fora.
 */
export interface DadosDoAnuncio {
  price: unknown;
  /** Quantidade de fotos já enviadas. */
  totalDeFotos: number;
  color?: string | null;
  fuel?: string | null;
  transmission?: string | null;
}

/** Aceita `Decimal`, string ou número — o preço atravessa o JSON como string. */
function comoNumero(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

/**
 * O que ainda falta para publicar. Lista vazia significa "pode ir ao ar".
 *
 * Devolve frases prontas, e não códigos, porque quem as lê é o lojista — tanto
 * na etiqueta da tela quanto na mensagem de erro da API.
 */
export function pendenciasParaPublicar(v: DadosDoAnuncio): string[] {
  const faltando: string[] = [];

  if (v.totalDeFotos < 1) faltando.push('pelo menos uma foto');

  const preco = comoNumero(v.price);
  if (!Number.isFinite(preco) || preco <= 0) faltando.push('preço de venda');

  if (!v.color?.trim()) faltando.push('cor');
  if (!v.fuel) faltando.push('combustível');
  if (!v.transmission) faltando.push('câmbio');

  return faltando;
}

export function podePublicar(v: DadosDoAnuncio): boolean {
  return pendenciasParaPublicar(v).length === 0;
}

/** "pelo menos uma foto, preço de venda e cor" — para a mensagem ao lojista. */
export function listarPendencias(faltando: readonly string[]): string {
  if (faltando.length === 0) return '';
  if (faltando.length === 1) return faltando[0];
  return `${faltando.slice(0, -1).join(', ')} e ${faltando[faltando.length - 1]}`;
}
