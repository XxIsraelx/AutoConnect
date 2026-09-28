/**
 * Financeiro da loja — as regras que não dependem de banco nem de tela.
 *
 * Elas moram aqui por dois motivos. O primeiro é o de sempre no projeto: a mesma
 * conta usada pelo painel e pela API não pode ter duas implementações. O segundo
 * é específico deste módulo: **é dinheiro**. Uma regra de atraso ou de saldo que
 * só existe dentro de um `service` é uma regra que ninguém testa com cinco casos
 * de borda, e o erro aparece no caixa do lojista, não no log.
 *
 * Decisões que este arquivo materializa (porquê em
 * `docs/decisoes/2026-09-27 modulo financeiro.md`):
 *
 *  - **`value` é sempre positivo.** O sinal está em `direction`. Valor negativo
 *    para representar saída é o caminho mais curto para uma soma que engana.
 *  - **Saldo é derivado.** Nunca gravado em coluna: saldo em coluna vira saldo
 *    errado no primeiro lançamento editado.
 *  - **Regime de caixa.** `dueDate` é a promessa, `paidAt` é o fato. O caixa soma
 *    o fato; o fluxo previsto soma a promessa.
 */

import { emCentavos, deCentavos } from './dinheiro';

/* ── Enums (espelham o `schema.prisma`; `paridade-enums.spec` vigia) ── */

export const FINANCIAL_ACCOUNT_KINDS = ['caixa', 'banco', 'adquirente', 'outro'] as const;
export type FinancialAccountKindValue = (typeof FINANCIAL_ACCOUNT_KINDS)[number];

export const FINANCIAL_DIRECTIONS = ['entrada', 'saida'] as const;
export type FinancialDirectionValue = (typeof FINANCIAL_DIRECTIONS)[number];

/** `previsto` é promessa, `pago` é fato, `cancelado` é erro assumido — nada apaga. */
export const FINANCIAL_ENTRY_STATUSES = ['previsto', 'pago', 'cancelado'] as const;
export type FinancialEntryStatusValue = (typeof FINANCIAL_ENTRY_STATUSES)[number];

export const FINANCIAL_CATEGORY_GROUPS = [
  'veiculos', 'operacao', 'pessoal', 'impostos', 'financeiro', 'outros',
] as const;
export type FinancialCategoryGroupValue = (typeof FINANCIAL_CATEGORY_GROUPS)[number];

export const ROTULO_DO_GRUPO: Record<FinancialCategoryGroupValue, string> = {
  veiculos: 'Veículos',
  operacao: 'Operação',
  pessoal: 'Pessoal',
  impostos: 'Impostos e taxas',
  financeiro: 'Financeiro',
  outros: 'Outros',
};

/* ── Plano de contas mínimo ─────────────────────────────────── */

/**
 * As categorias que o **sistema** precisa encontrar para gerar lançamento
 * sozinho: a venda que virou conta a receber, a compra do carro, a preparação e
 * a comissão do vendedor.
 *
 * A busca é por esta chave, nunca pelo nome: a loja renomeia "Compra de veículo"
 * para "Aquisição" no primeiro dia, e uma geração que procura por nome pararia de
 * achar em silêncio — o pior dos dois mundos, porque o dinheiro simplesmente não
 * apareceria no caixa.
 */
export const CHAVES_DE_ORIGEM = [
  'venda_de_veiculo', 'compra_de_veiculo', 'preparacao', 'comissao',
] as const;
export type ChaveDeOrigem = (typeof CHAVES_DE_ORIGEM)[number];

/**
 * O plano de contas com que a loja começa.
 *
 * Existe porque a alternativa é pior: uma tela de financeiro que abre vazia e
 * exige cadastrar categoria antes do primeiro lançamento é uma tela que o
 * lojista fecha. São categorias de revenda de seminovos, não de contabilidade
 * geral — "compra de veículo" e "preparação" são as duas linhas que mais pesam
 * no caixa dele.
 *
 * A loja renomeia, desativa e cria as suas: isto é ponto de partida, não
 * catálogo fechado.
 */
export const CATEGORIAS_PADRAO: readonly {
  direction: FinancialDirectionValue;
  group: FinancialCategoryGroupValue;
  name: string;
  /** Presente nas quatro que a geração automática procura. */
  origemKey?: ChaveDeOrigem;
}[] = [
  { direction: 'entrada', group: 'veiculos', name: 'Venda de veículo', origemKey: 'venda_de_veiculo' },
  { direction: 'entrada', group: 'veiculos', name: 'Entrada de troca' },
  { direction: 'entrada', group: 'financeiro', name: 'Comissão de financiamento' },
  { direction: 'entrada', group: 'outros', name: 'Outras receitas' },

  { direction: 'saida', group: 'veiculos', name: 'Compra de veículo', origemKey: 'compra_de_veiculo' },
  { direction: 'saida', group: 'veiculos', name: 'Preparação e funilaria', origemKey: 'preparacao' },
  { direction: 'saida', group: 'veiculos', name: 'Documentação e transferência' },
  { direction: 'saida', group: 'operacao', name: 'Aluguel' },
  { direction: 'saida', group: 'operacao', name: 'Energia, água e internet' },
  { direction: 'saida', group: 'operacao', name: 'Marketing e anúncios' },
  { direction: 'saida', group: 'pessoal', name: 'Salários' },
  { direction: 'saida', group: 'pessoal', name: 'Comissão de vendedor', origemKey: 'comissao' },
  { direction: 'saida', group: 'impostos', name: 'Impostos e taxas' },
  { direction: 'saida', group: 'financeiro', name: 'Tarifas bancárias e maquininha' },
  { direction: 'saida', group: 'outros', name: 'Outras despesas' },
];

/* ── Regras ─────────────────────────────────────────────────── */

/** O lançamento como as regras precisam vê-lo — o resto da linha não importa aqui. */
export interface LancamentoParaRegra {
  direction: FinancialDirectionValue;
  status: FinancialEntryStatusValue;
  /** String de propósito: dinheiro atravessa a fronteira como texto. */
  value: string;
  dueDate: Date;
  paidAt?: Date | null;
}

/**
 * Atrasado é o que venceu e não foi pago. Cancelado nunca atrasa — ninguém
 * cobra o que a loja desistiu de cobrar.
 *
 * A comparação é por **dia**, não por instante: um boleto que vence hoje às 23h
 * não está atrasado às 9h da manhã, e `dueDate < agora` diria que está.
 */
export function estaAtrasado(l: LancamentoParaRegra, hoje: Date): boolean {
  if (l.status !== 'previsto') return false;
  return diaDe(l.dueDate) < diaDe(hoje);
}

export function diasDeAtraso(l: LancamentoParaRegra, hoje: Date): number {
  if (!estaAtrasado(l, hoje)) return 0;
  return Math.round((diaDe(hoje).getTime() - diaDe(l.dueDate).getTime()) / 86_400_000);
}

/** Meia-noite em UTC do dia da data — o mesmo corte para as duas pontas. */
function diaDe(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Saldo de uma conta: saldo inicial mais o que entrou, menos o que saiu — **só o
 * que foi pago**.
 *
 * Previsto não é saldo. Misturar os dois é a forma mais rápida de o lojista achar
 * que tem dinheiro que ainda não entrou, e a razão de `saldoPrevisto` existir
 * separado.
 */
export function saldoDaConta(
  saldoInicial: string,
  lancamentos: readonly LancamentoParaRegra[],
): string {
  let centavos = emCentavos(saldoInicial);
  for (const l of lancamentos) {
    if (l.status !== 'pago') continue;
    centavos += l.direction === 'entrada' ? emCentavos(l.value) : -emCentavos(l.value);
  }
  return deCentavos(centavos);
}

/**
 * Saldo projetado: o de hoje mais tudo o que está previsto até a data limite.
 *
 * É o número que responde "em que dia o caixa fica negativo" — e por isso conta
 * o previsto **vencido** também: quem não pagou ainda deve.
 */
export function saldoPrevisto(
  saldoInicial: string,
  lancamentos: readonly LancamentoParaRegra[],
  ate: Date,
): string {
  let centavos = emCentavos(saldoDaConta(saldoInicial, lancamentos));
  for (const l of lancamentos) {
    if (l.status !== 'previsto') continue;
    if (diaDe(l.dueDate) > diaDe(ate)) continue;
    centavos += l.direction === 'entrada' ? emCentavos(l.value) : -emCentavos(l.value);
  }
  return deCentavos(centavos);
}

/** Soma de um conjunto, em `Decimal` de texto — sem passar por `number`. */
export function somarLancamentos(lancamentos: readonly LancamentoParaRegra[]): string {
  let centavos = 0n;
  for (const l of lancamentos) centavos += emCentavos(l.value);
  return deCentavos(centavos);
}

/**
 * Mês fechado tranca o que é dele.
 *
 * A trava é pelo **vencimento**, não pela data em que alguém digitou: o
 * fechamento diz "março está conferido", e um lançamento novo com vencimento em
 * março mudaria o resultado de março depois de ele ter sido dado como fechado.
 * O banco repete esta regra num trigger — aqui é para a tela poder avisar antes.
 */
export function mesEstaFechado(
  dueDate: Date,
  fechados: readonly { year: number; month: number }[],
): boolean {
  const ano = dueDate.getUTCFullYear();
  const mes = dueDate.getUTCMonth() + 1;
  return fechados.some((f) => f.year === ano && f.month === mes);
}

/**
 * Pode editar ou dar baixa?
 *
 * Cancelado é definitivo: reabrir um cancelamento reescreveria história que a
 * auditoria já registrou. Para voltar atrás, cria-se outro lançamento.
 */
export function podeAlterar(
  l: LancamentoParaRegra,
  fechados: readonly { year: number; month: number }[],
): { pode: boolean; motivo?: string } {
  if (l.status === 'cancelado') {
    return { pode: false, motivo: 'Lançamento cancelado não volta atrás. Crie outro no lugar.' };
  }
  if (mesEstaFechado(l.dueDate, fechados)) {
    const d = l.dueDate;
    return {
      pode: false,
      motivo:
        `O mês ${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()} está fechado. ` +
        'Reabra o mês para mexer em lançamento com vencimento nele.',
    };
  }
  return { pode: true };
}
