import { createHash, timingSafeEqual } from 'crypto';
import type { CabecalhosDeCobranca } from '@autoconnect/shared';

/**
 * Autenticidade do webhook de cobrança.
 *
 * A Asaas não assina o corpo: ela devolve, em **todas** as entregas, o token
 * que a loja cadastrou junto do webhook, no cabeçalho `asaas-access-token`
 * (https://docs.asaas.com/docs/sobre-os-webhooks). Desde a mudança de
 * "obrigatoriedade e auto-geração de tokens para Webhooks" não existe mais
 * webhook sem token, então conferir o cabeçalho é o que separa uma entrega da
 * Asaas de um `curl` de qualquer um que descobriu a URL.
 *
 * Isto vive fora do adaptador, como o `hmac.ts` da assinatura, para que o
 * próximo gateway reaproveite a comparação em tempo constante em vez de
 * reescrevê-la.
 */

export const CABECALHO_TOKEN_ASAAS = 'asaas-access-token';

/**
 * Compara em tempo constante, sem vazar o tamanho.
 *
 * Os dois lados passam por SHA-256 antes da comparação: `timingSafeEqual`
 * **lança** com tamanhos diferentes, e tratar esse lance como "não confere"
 * devolveria a resposta mais rápido — o tempo diria ao atacante que ele errou
 * o comprimento, o que reduz muito o espaço de busca. Com o digest, os dois
 * lados têm sempre 32 bytes.
 */
export function tokenConfere(
  cabecalhos: CabecalhosDeCobranca,
  nome: string,
  esperado: string,
): boolean {
  const recebido = cabecalhos[nome];
  if (!esperado || typeof recebido !== 'string' || recebido.length === 0) return false;

  const a = createHash('sha256').update(recebido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

/** SHA-256 em hex — chave de idempotência quando o gateway não manda id. */
export function sha256Hex(conteudo: Uint8Array): string {
  return createHash('sha256').update(conteudo).digest('hex');
}
