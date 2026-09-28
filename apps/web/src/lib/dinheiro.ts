import { formatarBRL } from '@autoconnect/shared';

/**
 * A ponte entre o dinheiro que a pessoa digita e o que a API aceita.
 *
 * A API troca dinheiro na forma canônica (`"12345.67"`, sem separador de milhar)
 * — uma gramática só, a mesma do negócio e do financeiro. O olho humano lê
 * `12.345,67`. Estas duas funções são a tradução, e moram aqui porque nasceram
 * duplicadas: o cartão de preço do negócio tinha a sua cópia, e o financeiro
 * ia ganhar a segunda. Duas cópias divergem no primeiro ajuste.
 */

/** `"12345.67"` → `12.345,67`, para o campo mostrar o que a tela exibe. */
export function paraCampo(valor: string): string {
  return formatarBRL(valor).replace(/[^\d,.-]/g, '').trim();
}

/**
 * Aceita `12.345,67`, `12345,67` e `12345.67` e devolve o formato que a API
 * exige. `null` quando não dá para ler o número — a tela diz o que esperava em
 * vez de mandar lixo e receber "Validation failed".
 */
export function paraApi(texto: string): string | null {
  const limpo = texto.trim().replace(/\s/g, '');
  if (!limpo) return null;

  // Vírgula presente = separador decimal brasileiro; o ponto é de milhar.
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;

  if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) return null;
  return normalizado;
}
