import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * Autenticidade do webhook: HMAC-SHA256 do corpo cru com o segredo
 * compartilhado. É o esquema da Clicksign (`Content-Hmac: sha256=<hex>`) e o
 * de boa parte dos provedores; fica aqui, fora de qualquer adaptador, para que
 * o próximo reaproveite a comparação em tempo constante em vez de reescrevê-la.
 */

export const CABECALHO_HMAC = 'content-hmac';

/**
 * Cabeçalho alternativo, aceito só pelo adaptador da Clicksign.
 *
 * A página técnica "Segurança de Webhooks" da Clicksign documenta
 * `Content-Hmac: sha256=<hex>` (https://developers.clicksign.com/docs/seguranca-de-webhooks);
 * o FAQ da página inicial do portal (https://developers.clicksign.com/) diz
 * que "cada aviso inclui o cabeçalho `x-clicksign-signature`", sem dizer o
 * formato. Até uma entrega real tirar a dúvida, os dois são aceitos — com o
 * mesmo segredo e a mesma comparação em tempo constante, então aceitar os dois
 * não enfraquece nada: forjar qualquer um exige o segredo.
 */
export const CABECALHO_HMAC_ALTERNATIVO = 'x-clicksign-signature';

export function hmacSha256Hex(corpo: Uint8Array, segredo: string): string {
  return createHmac('sha256', segredo).update(corpo).digest('hex');
}

export function sha256Hex(conteudo: Uint8Array): string {
  return createHash('sha256').update(conteudo).digest('hex');
}

/** Valor do cabeçalho para um corpo — usado pelo provedor simulado e pelos testes. */
export function cabecalhoHmac(corpo: Uint8Array, segredo: string): string {
  return `sha256=${hmacSha256Hex(corpo, segredo)}`;
}

/**
 * Confere o cabeçalho contra o corpo. Nunca lança: cabeçalho ausente,
 * repetido, malformado ou de outro algoritmo é simplesmente `false`.
 *
 * `timingSafeEqual` e não `===`: a comparação comum para no primeiro byte
 * diferente, e o tempo de resposta vaza quantos bytes do HMAC o atacante já
 * acertou.
 */
export function hmacConfere(
  corpo: Uint8Array,
  cabecalho: string | string[] | undefined,
  segredo: string,
  opcoes: { aceitaHexPuro?: boolean } = {},
): boolean {
  if (!segredo || typeof cabecalho !== 'string') return false;

  // `aceitaHexPuro`: o `x-clicksign-signature` não tem formato documentado, e
  // o hex sem o prefixo `sha256=` é a outra forma comum.
  const padrao = opcoes.aceitaHexPuro ? /^(?:sha256=)?([0-9a-f]{64})$/i : /^sha256=([0-9a-f]{64})$/i;
  const m = padrao.exec(cabecalho.trim());
  if (!m?.[1]) return false;

  const recebido = Buffer.from(m[1].toLowerCase(), 'hex');
  const esperado = Buffer.from(hmacSha256Hex(corpo, segredo), 'hex');

  // Os dois têm 32 bytes pelo regex acima; a checagem fica porque
  // `timingSafeEqual` lança com tamanhos diferentes.
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
