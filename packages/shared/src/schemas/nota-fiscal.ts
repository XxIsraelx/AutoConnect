import { z } from 'zod';
import {
  AMBIENTES_FISCAIS, normalizarDocumento, normalizarNcm, normalizarRenavam, REGIMES_TRIBUTARIOS,
} from '../domain/nota-fiscal';
import { cnpjValido, cpfValido } from './auth';
import {
  CORRECAO_MAXIMA, CORRECAO_MINIMA, JUSTIFICATIVA_MAXIMA, JUSTIFICATIVA_MINIMA,
} from '../domain/emissao-nfe';

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
  /** CST de PIS e de COFINS (2 dígitos). Opcional no corpo para não quebrar quem já salvava sem ele. */
  pisCofinsSituacaoTributaria: z.string().trim().regex(/^\d{2}$/, 'CST de PIS/COFINS tem 2 dígitos').nullable().default(null),
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

/* ── Emissão (N2) ─────────────────────────────────────────── */

/** `?presencial=false` quando o carro é entregue em outro estado. */
export const emitirNotaDoNegocioSchema = z.object({
  presencial: z.boolean().default(true),
}).strict();
export type EmitirNotaDoNegocioInput = z.infer<typeof emitirNotaDoNegocioSchema>;

/** A justificativa vai para a SEFAZ no evento de cancelamento (`xJust`). */
export const cancelarNotaSchema = z.object({
  justificativa: z.string().trim()
    .min(JUSTIFICATIVA_MINIMA, `A SEFAZ exige ao menos ${JUSTIFICATIVA_MINIMA} caracteres na justificativa`)
    .max(JUSTIFICATIVA_MAXIMA),
}).strict();
export type CancelarNotaInput = z.infer<typeof cancelarNotaSchema>;

/** Só com o emissor simulado, fora de produção: o que a SEFAZ "responde". */
export const simularRetornoDaNotaSchema = z.object({
  acao: z.enum(['autorizar', 'rejeitar', 'denegar']),
}).strict();

/* ── Quem entregou o veículo (N2b) ─────────────────────────── */

const textoOpcional = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

/**
 * Qualificação de quem entregou o veículo à loja — o remetente da nota de
 * entrada, e o vendedor que o RENAVE pede na entrada do estoque.
 *
 * O documento é a regra dura (CPF ou CNPJ válido, inclusive alfanumérico); o
 * endereço pode ser salvo pela metade — a prévia da nota diz o que falta.
 */
export const quemEntregouSchema = z.object({
  fullName: z.string().trim().min(3, 'Informe o nome como está no documento').max(160),
  documento: z.string().transform(normalizarDocumento).refine(
    (d) => (/^\d{11}$/.test(d) && cpfValido(d)) || (d.length === 14 && cnpjValido(d)),
    'CPF ou CNPJ inválido — confira os dígitos',
  ),
  rg: textoOpcional(20),
  addressLine: textoOpcional(160),
  addressNumber: textoOpcional(20),
  complement: textoOpcional(80),
  neighborhood: textoOpcional(80),
  city: textoOpcional(80),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF com duas letras').nullable().optional()
    .transform((v) => v ?? null),
  postalCode: z.string().nullable().optional()
    .transform((v) => (v ? v.replace(/\D/g, '') : null))
    .refine((v) => v === null || /^\d{8}$/.test(v), 'CEP tem 8 dígitos'),
  email: z.string().trim().email('E-mail inválido').nullable().optional().transform((v) => v ?? null),
}).strict();
export type QuemEntregouInput = z.infer<typeof quemEntregouSchema>;

/* ── Emissor real (N3) ─────────────────────────────────────── */

/** O texto vai para a SEFAZ no evento de carta de correção (`xCorrecao`). */
export const cartaDeCorrecaoSchema = z.object({
  correcao: z.string().trim()
    .min(CORRECAO_MINIMA, `A SEFAZ exige ao menos ${CORRECAO_MINIMA} caracteres na correção`)
    .max(CORRECAO_MAXIMA),
}).strict();

/**
 * O certificado A1 da loja. Passa pela API e vai direto ao emissor: não é
 * gravado, e a senha não é logada. Um PFX tem poucos KB; 200 KB em base64 é
 * folga, não convite.
 */
export const certificadoA1Schema = z.object({
  arquivoBase64: z.string().min(100, 'Envie o arquivo do certificado (.pfx ou .p12)').max(280_000, 'Arquivo grande demais para um certificado A1')
    .regex(/^[A-Za-z0-9+/]+=*$/, 'O arquivo não chegou em base64'),
  senha: z.string().min(1, 'Informe a senha do certificado').max(200),
}).strict();
export type CertificadoA1Input = z.infer<typeof certificadoA1Schema>;
