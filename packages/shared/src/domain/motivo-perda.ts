/**
 * Por que o lead ou o negócio não fechou.
 *
 * ## Por que código em texto, e não enum do Postgres
 *
 * O campo `leads.lost_reason` já existia como `text` livre, sem tela que o
 * preenchesse — ou seja, a coluna estava vazia e não havia dado a migrar. A
 * escolha aqui foi **acrescentar** `lost_reason_code` (texto, lista fechada
 * validada pelo Zod) e rebaixar `lost_reason` a complemento em texto livre,
 * em vez de converter a coluna existente num enum do banco:
 *
 *  - enum do Postgres exige migration a cada motivo novo, e o motivo de perda
 *    é exatamente o campo que a loja vai querer ajustar depois da primeira
 *    semana de uso;
 *  - enum do Prisma teria de ser espelhado em `paridade-enums.spec.ts`, e o
 *    espelho só se justifica quando o banco precisa mesmo recusar o valor —
 *    aqui quem recusa é o Zod da rota, antes de chegar ao banco;
 *  - manter `lost_reason` como texto preserva o que já estivesse gravado.
 *
 * O preço é o banco aceitar um código fora da lista se alguém escrever direto
 * nele por SQL. O relatório trata código desconhecido como "outro", e o
 * `CHECK` da migration recusa string vazia.
 */

export interface MotivoDePerda {
  readonly codigo: string;
  readonly rotulo: string;
}

/**
 * A lista é curta de propósito. Motivo de perda só vira informação quando o
 * vendedor escolhe em dois segundos; uma lista de vinte itens vira "outro".
 */
export const MOTIVOS_DE_PERDA_DE_LEAD = [
  { codigo: 'preco', rotulo: 'Preço' },
  { codigo: 'comprou_em_outra_loja', rotulo: 'Comprou em outra loja' },
  { codigo: 'nao_respondeu', rotulo: 'Não respondeu' },
  { codigo: 'sem_credito', rotulo: 'Sem crédito' },
  { codigo: 'veiculo_indisponivel', rotulo: 'Veículo indisponível' },
  { codigo: 'fora_de_regiao', rotulo: 'Fora de região' },
  { codigo: 'so_pesquisando', rotulo: 'Só pesquisando' },
  { codigo: 'outro', rotulo: 'Outro' },
] as const satisfies readonly MotivoDePerda[];

export type MotivoDePerdaCodigo =
  (typeof MOTIVOS_DE_PERDA_DE_LEAD)[number]['codigo'];

export const CODIGOS_DE_PERDA_DE_LEAD = MOTIVOS_DE_PERDA_DE_LEAD.map(
  (m) => m.codigo,
) as unknown as [MotivoDePerdaCodigo, ...MotivoDePerdaCodigo[]];

/**
 * Motivos de cancelamento e distrato do negócio.
 *
 * Lista própria porque o negócio morre por razões que o lead não tem —
 * reprovação de crédito já pedida, troca recusada na vistoria, desistência
 * depois da proposta. `deals.cancel_reason` continua sendo o texto livre; o
 * código novo é `cancel_reason_code`.
 */
export const MOTIVOS_DE_CANCELAMENTO_DE_NEGOCIO = [
  { codigo: 'desistencia_do_cliente', rotulo: 'Desistência do cliente' },
  { codigo: 'credito_reprovado', rotulo: 'Crédito reprovado' },
  { codigo: 'troca_recusada', rotulo: 'Troca recusada na avaliação' },
  { codigo: 'preco', rotulo: 'Não fechou no preço' },
  { codigo: 'veiculo_indisponivel', rotulo: 'Veículo indisponível' },
  { codigo: 'comprou_em_outra_loja', rotulo: 'Comprou em outra loja' },
  { codigo: 'erro_de_cadastro', rotulo: 'Erro de cadastro' },
  { codigo: 'outro', rotulo: 'Outro' },
] as const satisfies readonly MotivoDePerda[];

export type MotivoDeCancelamentoCodigo =
  (typeof MOTIVOS_DE_CANCELAMENTO_DE_NEGOCIO)[number]['codigo'];

export const CODIGOS_DE_CANCELAMENTO_DE_NEGOCIO =
  MOTIVOS_DE_CANCELAMENTO_DE_NEGOCIO.map((m) => m.codigo) as unknown as [
    MotivoDeCancelamentoCodigo,
    ...MotivoDeCancelamentoCodigo[],
  ];

/** Rótulo para a tela e o relatório; código desconhecido não vira "undefined". */
export function rotuloDoMotivo(
  codigo: string | null | undefined,
  lista: readonly MotivoDePerda[] = MOTIVOS_DE_PERDA_DE_LEAD,
): string {
  if (!codigo) return 'Sem motivo informado';
  return lista.find((m) => m.codigo === codigo)?.rotulo ?? 'Outro';
}

/** "outro" sem texto não é motivo: é o campo obrigatório preenchido por fora. */
export function exigeDetalhe(codigo: string): boolean {
  return codigo === 'outro';
}
