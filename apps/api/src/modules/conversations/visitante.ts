import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { BYTES_DO_TOKEN_DE_VISITANTE } from '@autoconnect/shared';

/**
 * O link por onde entra quem **não tem conta**.
 *
 * B11 do piloto do primeiro dia: o lead da Onda 0 nasce sem conta por
 * definição, `conversations.customer_user_id` era NOT NULL e o botão
 * "Conversar" só aparecia para lead com conta. O produto anuncia chat em tempo
 * real e não oferecia conversa justamente para o lead que ele mesmo captura.
 *
 * O token é guardado **em hash**, como o convite de equipe: o valor cru existe
 * uma vez, no momento em que a conversa é aberta, e é devolvido para a loja
 * mandar por WhatsApp (o canal que a revenda usa) ou por e-mail. Pedir o link
 * de novo gera um novo e **invalida o anterior** — é o preço de não guardar o
 * segredo, e é o mesmo comportamento do "reenviar convite".
 */

export function novoTokenDeVisitante(): { token: string; hash: string } {
  const token = randomBytes(BYTES_DO_TOKEN_DE_VISITANTE).toString('base64url');
  return { token, hash: hashDoToken(token) };
}

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Comparação em tempo constante entre dois hashes hexadecimais.
 *
 * A busca no banco é por igualdade de hash (índice único), então isto cobre a
 * conferência que o serviço faz depois de achar a linha — mesma disciplina dos
 * webhooks de cobrança e de saque.
 */
export function hashesIguais(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `<WEB_URL>/conversa/<token>` — a página pública da conversa. */
export function linkDoVisitante(token: string): string {
  const base = process.env.WEB_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/conversa/${token}`;
}
