/**
 * Regras do negócio (`Deal`) que front e back precisam conhecer igualmente.
 *
 * A máquina de estados mora aqui, e não no service, porque a tela só deve
 * oferecer as transições que a API aceita. Duas cópias da regra é como se
 * produz um botão que abre um diálogo e termina em 409.
 *
 * Os valores repetem o enum `DealStatus` do Prisma pelo mesmo motivo dos
 * demais schemas deste pacote — importar `@autoconnect/db` arrastaria o Prisma
 * para o bundle do navegador. `paridade-enums.spec.ts` compara as listas com o
 * enum real e quebra o CI se divergirem.
 */

export const DEAL_STATUSES = [
  'draft',
  'proposal',
  'negotiating',
  'awaiting_credit',
  'contract_issued',
  'signed',
  'invoiced',
  'documentation',
  'delivered',
  'canceled',
  'rescinded',
] as const;

export type DealStatusValue = (typeof DEAL_STATUSES)[number];

export const PAYMENT_KINDS = [
  'cash',
  'down_payment',
  'trade_in',
  'financing',
  'consortium',
  'other',
] as const;

export type PaymentKindValue = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_STATUSES = ['pending', 'confirmed', 'failed', 'refunded'] as const;

export type PaymentStatusValue = (typeof PAYMENT_STATUSES)[number];

export const ACQUISITION_ORIGINS = [
  'direct_purchase',
  'trade_in',
  'consignment',
  'dealer_transfer',
  'auction',
  'factory',
] as const;

export type AcquisitionOriginValue = (typeof ACQUISITION_ORIGINS)[number];

export const VEHICLE_COST_KINDS = [
  'preparation',
  'mechanical',
  'bodywork',
  'documentation',
  'transport',
  'commission',
  'other',
] as const;

export type VehicleCostKindValue = (typeof VEHICLE_COST_KINDS)[number];

/**
 * Transições permitidas.
 *
 * Note a assimetria deliberada em torno de `signed`: antes da assinatura o
 * negócio é **cancelado**; depois dela é **distratado**. São eventos jurídicos
 * distintos — o distrato pressupõe contrato válido e costuma ter multa — e o
 * sistema não deve fingir que são a mesma coisa.
 */
export const DEAL_TRANSITIONS: Record<DealStatusValue, readonly DealStatusValue[]> = {
  draft: ['proposal', 'canceled'],
  proposal: ['negotiating', 'awaiting_credit', 'contract_issued', 'canceled'],
  negotiating: ['awaiting_credit', 'contract_issued', 'canceled'],
  awaiting_credit: ['contract_issued', 'negotiating', 'canceled'],
  contract_issued: ['signed', 'canceled'],
  signed: ['invoiced', 'rescinded'],
  invoiced: ['documentation', 'rescinded'],
  documentation: ['delivered', 'rescinded'],
  delivered: ['rescinded'],
  canceled: [],
  rescinded: [],
} as const;

export function canTransition(from: DealStatusValue, to: DealStatusValue): boolean {
  return DEAL_TRANSITIONS[from].includes(to);
}

/**
 * Estados sem saída. É a mesma dupla usada pelo índice único parcial
 * `deals_veiculo_negocio_vivo_idx`, que impede dois negócios vivos para o
 * mesmo veículo — se esta lista mudar, aquele índice precisa mudar junto.
 */
export const DEAL_TERMINAL_STATUSES = ['canceled', 'rescinded'] as const;

export function isDealTerminal(status: DealStatusValue): boolean {
  return (DEAL_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * A partir de `signed` existe contrato assinado, e mexer em valor deixa de ser
 * correção de digitação para virar alteração de documento firmado.
 */
export function isDealEditable(status: DealStatusValue): boolean {
  const travados: readonly DealStatusValue[] = [
    'signed',
    'invoiced',
    'documentation',
    'delivered',
    'canceled',
    'rescinded',
  ];
  return !travados.includes(status);
}

/** Só o que já foi confirmado abate o valor da venda. */
export function isPaymentCounted(status: PaymentStatusValue): boolean {
  return status === 'pending' || status === 'confirmed';
}
