import { z } from 'zod';
import {
  AMBIENTES_FISCAIS, normalizarNcm, normalizarRenavam, REGIMES_TRIBUTARIOS,
} from '../domain/nota-fiscal';

/**
 * Corpos do perfil fiscal (trilha N1 do plano fiscal).
 *
 * `.strict()` em todos, pela mesma razão do financeiro: campo a mais é erro do
 * chamador, e aqui o campo a mais mudaria o imposto de uma nota.
 *
 * A coerência do CFOP com a operação (entrada começa com 1 ou 2, saída com 5
 * ou 6) **não** está aqui: o schema não sabe qual operação está sendo editada
 * — ela vem da rota. Quem confere é o serviço, com `cfopValido`.
 */

/**
 * Série da NF-e. De 890 a 999 são reservadas (avulsa e contingência), então a
 * loja usa de 0 a 889 — e quase todas usam a 1.
 */
export const perfilFiscalSchema = z.object({
  regime: z.enum(REGIMES_TRIBUTARIOS),
  serie: z.number().int().min(0).max(889, 'Séries de 890 a 999 são reservadas'),
  ambiente: z.enum(AMBIENTES_FISCAIS),
}).strict();
export type PerfilFiscalInput = z.infer<typeof perfilFiscalSchema>;

const cfop = z.string().trim().regex(/^\d{4}$/, 'CFOP tem quatro dígitos, sem ponto');

export const perfilDeOperacaoSchema = z.object({
  /** `natOp` da NF-e: até 60 caracteres. */
  natureza: z.string().trim().min(3, 'Descreva a natureza da operação').max(60),
  cfopInterno: cfop,
  cfopInterestadual: cfop,
  /** CST (2 dígitos) ou CSOSN (3). Qual dos dois, depende do regime — o serviço confere. */
  situacaoTributaria: z.string().trim().regex(/^\d{2,3}$/, 'CST tem 2 dígitos; CSOSN tem 3').nullable(),
  informacoesComplementares: z.string().trim().max(2000).nullable(),
}).strict();
export type PerfilDeOperacaoInput = z.infer<typeof perfilDeOperacaoSchema>;

/**
 * Quem da loja registra, e de qual contador. Não é assinatura do contador — é
 * a loja dizendo, com nome e data, que levou o perfil a ele. Fica registrado
 * porque a primeira nota em produção sai com base nisso.
 */
export const confirmacaoDoContadorSchema = z.object({
  nomeDoContador: z.string().trim().min(3, 'Informe o nome do contador').max(120),
  crc: z.string().trim().max(30).optional(),
}).strict();
export type ConfirmacaoDoContadorInput = z.infer<typeof confirmacaoDoContadorSchema>;

export const dadosFiscaisDoVeiculoSchema = z.object({
  ncm: z.string().nullable()
    .transform((v, ctx) => {
      if (v === null || v.trim() === '') return null;
      const ncm = normalizarNcm(v);
      if (!ncm) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'NCM tem 8 dígitos' });
      return ncm;
    }),
  renavam: z.string().nullable()
    .transform((v, ctx) => {
      if (v === null || v.trim() === '') return null;
      const renavam = normalizarRenavam(v);
      if (!renavam) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'RENAVAM tem de 9 a 11 dígitos' });
      return renavam;
    }),
  /** 0 = nacional; 1 e 2 = importado. Vai junto da situação tributária na nota. */
  origem: z.number().int().min(0).max(8),
}).strict();
export type DadosFiscaisDoVeiculoInput = z.infer<typeof dadosFiscaisDoVeiculoSchema>;
