import { z } from 'zod';
import {
  FINANCIAL_ACCOUNT_KINDS, FINANCIAL_CATEGORY_GROUPS, FINANCIAL_DIRECTIONS,
} from '../domain/financeiro';
import { valorMonetario } from './deal';

/**
 * Corpos do financeiro.
 *
 * `.strict()` em todos: um campo a mais no corpo é erro do chamador, e aceitá-lo
 * em silêncio foi como `{"isActive": false}` desativou uma loja em setembro.
 *
 * **Dinheiro chega como string canônica** (`"1234.56"`, sem separador de milhar)
 * — o mesmo `valorMonetario` do negócio, e não um segundo formato só do
 * financeiro. Quem formata para o olho humano é a tela, e quem desformata antes
 * de enviar também: duas gramáticas de dinheiro na API é a próxima divergência
 * esperando acontecer.
 */
const dinheiro = (_rotulo: string) => valorMonetario;

/** Data como texto ISO ou `AAAA-MM-DD`: o que a tela manda nos dois casos. */
const data = (rotulo: string) =>
  z.string().trim().refine((v) => !Number.isNaN(Date.parse(v)), `${rotulo} inválida`);

export const contaFinanceiraSchema = z.object({
  kind: z.enum(FINANCIAL_ACCOUNT_KINDS),
  name: z.string().trim().min(2, 'Dê um nome à conta').max(80),
  bankName: z.string().trim().max(80).optional(),
  /** Saldo do dia em que a loja começou a usar o sistema — ela não nasce hoje. */
  openingBalance: dinheiro('Saldo inicial').optional(),
}).strict();
export type ContaFinanceiraInput = z.infer<typeof contaFinanceiraSchema>;

export const atualizarContaFinanceiraSchema = contaFinanceiraSchema.partial().extend({
  active: z.boolean().optional(),
}).strict();

export const categoriaFinanceiraSchema = z.object({
  direction: z.enum(FINANCIAL_DIRECTIONS),
  group: z.enum(FINANCIAL_CATEGORY_GROUPS),
  name: z.string().trim().min(2, 'Dê um nome à categoria').max(80),
}).strict();
export type CategoriaFinanceiraInput = z.infer<typeof categoriaFinanceiraSchema>;

export const atualizarCategoriaFinanceiraSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  group: z.enum(FINANCIAL_CATEGORY_GROUPS).optional(),
  active: z.boolean().optional(),
}).strict();

/**
 * Um lançamento.
 *
 * `direction` não vem do corpo por acaso: ela é a da **categoria**. Deixar o
 * chamador escolher permitiria uma despesa lançada como entrada, que é um saldo
 * errado que ninguém descobre olhando a lista.
 */
export const lancamentoSchema = z.object({
  categoryId: z.string().uuid('Escolha uma categoria'),
  value: dinheiro('Valor'),
  dueDate: data('Data de vencimento'),
  description: z.string().trim().min(2, 'Descreva o lançamento').max(200),

  accountId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  supplierName: z.string().trim().max(120).optional(),
  documentNumber: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(2000).optional(),

  /** Já nasce pago: o lançamento do que acabou de sair do caixa. */
  paidAt: data('Data de pagamento').optional(),

  /**
   * Repetição com fim, nunca infinita: série sem fim é lixo acumulando no banco
   * e um fluxo de caixa que promete 2040.
   */
  repetirMeses: z.number().int().min(2).max(36).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.paidAt && !v.accountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['accountId'],
      message: 'Para dar baixa é preciso dizer de qual conta o dinheiro saiu ou entrou.',
    });
  }
});
export type LancamentoInput = z.infer<typeof lancamentoSchema>;

export const atualizarLancamentoSchema = z.object({
  categoryId: z.string().uuid().optional(),
  value: dinheiro('Valor').optional(),
  dueDate: data('Data de vencimento').optional(),
  description: z.string().trim().min(2).max(200).optional(),
  accountId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  supplierName: z.string().trim().max(120).nullable().optional(),
  documentNumber: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict().refine(
  (v) => Object.keys(v).length > 0,
  'Corpo vazio: um PATCH que não pede nada é bug do chamador.',
);

export const baixaSchema = z.object({
  accountId: z.string().uuid('Escolha a conta'),
  paidAt: data('Data de pagamento').optional(),
}).strict();

export const cancelarLancamentoSchema = z.object({
  motivo: z.string().trim().min(3, 'Diga por que está cancelando').max(300),
}).strict();

export const listarLancamentosSchema = z.object({
  from: data('Data inicial').optional(),
  to: data('Data final').optional(),
  status: z.enum(['previsto', 'pago', 'cancelado']).optional(),
  direction: z.enum(FINANCIAL_DIRECTIONS).optional(),
  categoryId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  /** Só o que venceu e não foi pago — é o filtro que a tela abre primeiro. */
  atrasados: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type ListarLancamentosInput = z.infer<typeof listarLancamentosSchema>;

export const fecharMesSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
}).strict();

export const reabrirMesSchema = fecharMesSchema.extend({
  motivo: z.string().trim().min(3, 'Diga por que está reabrindo').max(300),
}).strict();

/**
 * Janela do fluxo de caixa.
 *
 * Teto de 180 dias porque a soma acontece em memória sobre as linhas da janela:
 * projeção de um ano seria lenta e, pior, mentirosa — ninguém sabe o que vence
 * em agosto do ano que vem.
 */
export const fluxoQuerySchema = z.object({
  dias: z.coerce.number().int().min(7).max(180).default(30),
}).strict();
