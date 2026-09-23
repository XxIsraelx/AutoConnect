/**
 * Telefone brasileiro: uma forma canônica só.
 *
 * Existe porque a deduplicação de leads compara telefone, e o mesmo cliente
 * escreve o próprio número de meia dúzia de formas: `(11) 98765-4321`,
 * `11987654321`, `+55 11 98765 4321`, e o fixo antigo `1187654321` que a
 * operadora já migrou para nove dígitos. Comparar a string crua faria o funil
 * criar um lead por grafia.
 *
 * A forma canônica é **DDD + número, sem DDI e sem pontuação**, com o nono
 * dígito sempre presente quando o número é de celular. Dez ou onze dígitos.
 *
 * Fica no `shared` porque o front valida o campo antes de enviar e o back o
 * revalida — e porque a coluna `leads.contact_phone_normalized` guarda
 * exatamente este valor (a migration que a criou repete estas regras em SQL
 * para preencher as linhas antigas).
 */

/** DDDs que existem no Brasil. Não é a lista fechada da Anatel de propósito:
 *  basta recusar o que não pode ser DDD nenhum (começa com 0, ou 10..19 fora
 *  da faixa válida). O erro que importa é o dedo trocado, não o DDD exótico. */
const DDD_MINIMO = 11;
const DDD_MAXIMO = 99;

/** Primeiro dígito do número de um celular brasileiro. */
const PRIMEIRO_DIGITO_DE_CELULAR = new Set(['6', '7', '8', '9']);

/**
 * Devolve a forma canônica, ou `null` quando o texto não é um telefone
 * brasileiro plausível.
 *
 * `null` é um resultado esperado, não uma exceção: o formulário público
 * transforma isso em erro de campo, e a deduplicação simplesmente deixa de
 * comparar por telefone.
 */
export function normalizarTelefoneBr(bruto: string | null | undefined): string | null {
  if (!bruto) return null;

  const digitos = bruto.replace(/\D/g, '');
  if (digitos.length === 0) return null;

  // DDI do Brasil. Só é removido quando sobra um número de tamanho plausível —
  // senão `5511` (um DDD 55 seguido de número) viraria `11`.
  const semDdi =
    digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)
      ? digitos.slice(2)
      : digitos;

  if (semDdi.length !== 10 && semDdi.length !== 11) return null;

  const ddd = Number(semDdi.slice(0, 2));
  if (!Number.isInteger(ddd) || ddd < DDD_MINIMO || ddd > DDD_MAXIMO) return null;

  const assinante = semDdi.slice(2);

  // Onze dígitos: celular. O nono dígito tem que ser mesmo um 9 — `11` seguido
  // de nove dígitos começando por 3 é lixo, não um fixo com um dígito a mais.
  if (assinante.length === 9) {
    return assinante.startsWith('9') ? semDdi : null;
  }

  // Dez dígitos: fixo (2 a 5) ou celular antigo, de antes do nono dígito.
  // O celular antigo é completado, que é o que faz `1187654321` e
  // `11987654321` caírem no mesmo lead.
  if (PRIMEIRO_DIGITO_DE_CELULAR.has(assinante[0])) {
    return `${semDdi.slice(0, 2)}9${assinante}`;
  }
  if (assinante[0] >= '2' && assinante[0] <= '5') return semDdi;

  return null;
}

/** Atalho para validação de formulário. */
export function telefoneBrValido(bruto: string | null | undefined): boolean {
  return normalizarTelefoneBr(bruto) !== null;
}

/** `11987654321` → `(11) 98765-4321`. Só para exibição. */
export function formatarTelefoneBr(bruto: string | null | undefined): string {
  const canonico = normalizarTelefoneBr(bruto);
  if (!canonico) return bruto ?? '';
  const ddd = canonico.slice(0, 2);
  const resto = canonico.slice(2);
  const meio = resto.length === 9 ? resto.slice(0, 5) : resto.slice(0, 4);
  const fim = resto.length === 9 ? resto.slice(5) : resto.slice(4);
  return `(${ddd}) ${meio}-${fim}`;
}

/**
 * Número no formato que o `wa.me` espera: DDI grudado, só dígitos.
 * Devolve `null` quando o telefone não é válido — o link não deve ser montado
 * com um número que não existe.
 */
export function paraWhatsApp(bruto: string | null | undefined): string | null {
  const canonico = normalizarTelefoneBr(bruto);
  return canonico ? `55${canonico}` : null;
}
