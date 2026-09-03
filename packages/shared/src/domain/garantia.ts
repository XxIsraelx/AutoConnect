/**
 * Garantia do veículo usado.
 *
 * O CDC (art. 26, II) dá 90 dias de garantia legal para bem durável, e ela
 * cobre o **veículo inteiro**. A cláusula "garantia de motor e câmbio" que
 * circula no mercado é nula quando apresentada como se fosse a garantia total
 * (art. 51, I: é abusiva a cláusula que exonera ou atenua a responsabilidade
 * do fornecedor).
 *
 * O modelo separa as duas de propósito — legal e contratual — para que a
 * contratual só possa ser **aditiva**. Este módulo é a validação que impede
 * emitir um contrato que reduza a legal disfarçadamente.
 */

/** CDC art. 26, II. Não é campo de negociação. */
export const GARANTIA_LEGAL_DIAS = 90;

/** Aproximação usada só para comparar prazos; contrato usa datas reais. */
const DIAS_POR_MES = 30;

export interface Garantia {
  legalDays: number;
  contractualMonths?: number | null;
  contractualScope?: string | null;
}

export interface ResultadoGarantia {
  ok: boolean;
  /** Frase pronta para a tela e para o corpo do contrato. */
  motivo?: string;
}

export function validarGarantia(g: Garantia): ResultadoGarantia {
  if (g.legalDays < GARANTIA_LEGAL_DIAS) {
    return {
      ok: false,
      motivo:
        `A garantia legal é de ${GARANTIA_LEGAL_DIAS} dias (CDC art. 26, II) e ` +
        'não pode ser reduzida por contrato.',
    };
  }

  if (g.contractualMonths == null) return { ok: true };

  if (g.contractualMonths <= 0) {
    return { ok: false, motivo: 'A garantia contratual, quando existe, precisa de prazo.' };
  }

  // O caso perigoso: prazo contratual menor que o legal e escopo restrito.
  // Sozinho, o prazo menor não é ilegal — o problema é oferecê-lo como se
  // fosse a garantia toda, que é o que acontece quando há restrição de escopo.
  const dias = g.contractualMonths * DIAS_POR_MES;
  const temEscopoRestrito = Boolean(g.contractualScope?.trim());

  if (dias < g.legalDays && temEscopoRestrito) {
    return {
      ok: false,
      motivo:
        `A garantia contratual (${g.contractualMonths} ${g.contractualMonths === 1 ? 'mês' : 'meses'}, ` +
        `restrita a "${g.contractualScope}") é menor que a legal de ${g.legalDays} dias, que cobre o ` +
        'veículo inteiro. Assim ela aparece como redução da garantia legal, o que é nulo ' +
        '(CDC art. 51, I). Estenda o prazo além da legal ou registre-a sem restrição de escopo.',
    };
  }

  return { ok: true };
}

/**
 * O texto que vai no contrato. A garantia legal é sempre declarada, mesmo
 * quando há contratual — omiti-la é o que transforma a cláusula em abusiva.
 */
export function textoDaGarantia(g: Garantia): string[] {
  const linhas = [
    `Garantia legal de ${g.legalDays} dias a contar da entrega, nos termos do ` +
      'art. 26, II do Código de Defesa do Consumidor, cobrindo o veículo em sua totalidade.',
  ];

  if (g.contractualMonths && g.contractualMonths > 0) {
    linhas.push(
      `Garantia contratual adicional de ${g.contractualMonths} ` +
        `${g.contractualMonths === 1 ? 'mês' : 'meses'}` +
        (g.contractualScope?.trim() ? `, referente a: ${g.contractualScope.trim()}` : '') +
        '. Esta garantia soma-se à legal e não a substitui nem a reduz.',
    );
  }

  return linhas;
}

/** Espelho de `ContractStatus` do Prisma — ver paridade-enums.spec.ts. */
export const CONTRACT_STATUSES = ['draft', 'issued', 'signed', 'voided'] as const;
export type ContractStatusValue = (typeof CONTRACT_STATUSES)[number];

/** Espelho de `SignerRole`. */
export const SIGNER_ROLES = ['customer', 'dealer'] as const;
export type SignerRoleValue = (typeof SIGNER_ROLES)[number];
