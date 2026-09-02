import type { DealStatusValue, PaymentKindValue } from '@autoconnect/shared';

export const ROTULO_STATUS: Record<DealStatusValue, string> = {
  draft: 'Rascunho',
  proposal: 'Proposta',
  negotiating: 'Em negociação',
  awaiting_credit: 'Aguardando crédito',
  contract_issued: 'Contrato emitido',
  signed: 'Assinado',
  invoiced: 'Faturado',
  documentation: 'Documentação',
  delivered: 'Entregue',
  canceled: 'Cancelado',
  rescinded: 'Distratado',
};

/** Cor por etapa: o funil anda do cinza ao verde; as saídas ficam em vermelho. */
export const COR_STATUS: Record<DealStatusValue, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  proposal: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  negotiating: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
  awaiting_credit: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  contract_issued: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
  signed: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  invoiced: 'bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300',
  documentation: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300',
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  canceled: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
  rescinded: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
};

export const ROTULO_PAGAMENTO: Record<PaymentKindValue, string> = {
  cash: 'À vista',
  down_payment: 'Entrada',
  trade_in: 'Troca',
  financing: 'Financiamento',
  consortium: 'Consórcio',
  other: 'Outro',
};

/** As etapas do funil, na ordem. Cancelado e distratado ficam de fora. */
export const ETAPAS_FUNIL: DealStatusValue[] = [
  'draft', 'proposal', 'negotiating', 'awaiting_credit',
  'contract_issued', 'signed', 'invoiced', 'documentation', 'delivered',
];
