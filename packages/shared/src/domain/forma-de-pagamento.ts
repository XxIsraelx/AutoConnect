import type { PaymentKindValue } from './deal';

/**
 * Forma de pagamento em português, para o que o dono da loja lê — a descrição
 * da conta a receber gerada pela venda, o extrato, a exportação para o
 * contador. O `kind` cru ("financing", "down_payment") vazava para essas linhas.
 *
 * A tela de negócios tem a mesma tabela em `negocios/rotulos.ts`; esta é a do
 * que sai da API.
 */
export const ROTULO_DA_FORMA_DE_PAGAMENTO: Record<PaymentKindValue, string> = {
  cash: 'à vista',
  down_payment: 'entrada',
  trade_in: 'troca',
  financing: 'financiamento',
  consortium: 'consórcio',
  other: 'outra forma',
};
