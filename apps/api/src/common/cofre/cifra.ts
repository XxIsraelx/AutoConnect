import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * A criptografia do cofre: AES-256-GCM, do `crypto` do Node.
 *
 * Decisão: `docs/decisoes/2026-10-14 cofre de credenciais por loja.md`.
 *
 * Três cuidados, cada um contra um ataque concreto:
 *
 *  - **vetor aleatório por cifra** — a mesma chave cifrada duas vezes não dá o
 *    mesmo resultado, e não dá para saber que duas lojas usam a mesma;
 *  - **dado autenticado** (`aad`) com a loja e o fornecedor — a cifra copiada
 *    para a linha de outra loja **não abre**, mesmo com a chave-mestra certa;
 *  - **etiqueta do GCM** — cifra adulterada falha alto em vez de abrir lixo.
 */

const ALGORITMO = 'aes-256-gcm';
const TAMANHO_DO_VETOR = 12;

export interface Cifrado {
  cifra: Buffer;
  vetor: Buffer;
  etiqueta: Buffer;
}

export function cifrar(texto: string, chave: Buffer, aad: string): Cifrado {
  const vetor = randomBytes(TAMANHO_DO_VETOR);
  const c = createCipheriv(ALGORITMO, chave, vetor);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const cifra = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return { cifra, vetor, etiqueta: c.getAuthTag() };
}

/** Lança se a chave, o `aad` ou a etiqueta não conferirem. Nunca devolve lixo. */
export function decifrar(c: Cifrado, chave: Buffer, aad: string): string {
  const d = createDecipheriv(ALGORITMO, chave, c.vetor);
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(c.etiqueta);
  return Buffer.concat([d.update(c.cifra), d.final()]).toString('utf8');
}

export interface ChavesMestras {
  /** A versão mais alta: é com ela que se cifra. */
  atual: number;
  porVersao: ReadonlyMap<number, Buffer>;
}

/**
 * Lê `COFRE_CHAVES_MESTRAS`: `1:<base64>` ou, na troca, `1:<antiga>,2:<nova>`.
 * Cada chave tem 32 bytes. Devolve `null` com o motivo quando a variável falta
 * ou está malformada — quem chama loga e desliga o cofre, sem derrubar o boot.
 */
export function lerChavesMestras(bruta: string | undefined): ChavesMestras | { erro: string } {
  if (!bruta?.trim()) return { erro: 'COFRE_CHAVES_MESTRAS ausente' };

  const porVersao = new Map<number, Buffer>();
  for (const parte of bruta.split(',')) {
    const m = /^\s*(\d+):([A-Za-z0-9+/=]+)\s*$/.exec(parte);
    if (!m) return { erro: 'COFRE_CHAVES_MESTRAS fora do formato "1:<base64>[,2:<base64>]"' };
    const versao = Number(m[1]);
    const chave = Buffer.from(m[2]!, 'base64');
    if (versao < 1) return { erro: 'versão da chave-mestra começa em 1' };
    if (chave.length !== 32) return { erro: `a chave-mestra v${versao} não tem 32 bytes` };
    if (porVersao.has(versao)) return { erro: `versão ${versao} repetida em COFRE_CHAVES_MESTRAS` };
    porVersao.set(versao, chave);
  }
  return { atual: Math.max(...porVersao.keys()), porVersao };
}

/** Os 4 últimos caracteres, para a tela reconhecer a chave sem mostrá-la. */
export function ultimos4(segredo: string): string {
  return segredo.slice(-4);
}
