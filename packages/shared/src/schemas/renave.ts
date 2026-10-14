import { z } from 'zod';
import { RENAVE_OPERACOES, TIPOS_DE_CRV } from '../domain/renave';
import { lerChaveNfe, normalizarChaveNfe } from '../domain/chave-nfe';
import { dataPassada } from './deal';

/**
 * Corpos do registro manual do RENAVE.
 *
 * `.strict()` em todos, como no financeiro: campo a mais é erro do chamador.
 *
 * **Valor não entra pelo corpo.** O de compra vem da aquisição do veículo e o
 * de venda do negócio (regra 4 do plano fiscal: um número, uma fonte). Uma
 * segunda tela pedindo o valor é como a nota, o RENAVE e o negócio passam a
 * contar histórias diferentes.
 */

/**
 * Chave da NF-e na forma canônica. Aceita o que a pessoa cola do DANFE (com
 * espaços) e recusa NFC-e: venda de veículo sai em NF-e modelo 55.
 */
export const chaveNfeDoRenave = z
  .string()
  .transform(normalizarChaveNfe)
  .refine((c) => lerChaveNfe(c) !== null, 'Chave de NF-e inválida: confira os 44 dígitos.')
  .refine((c) => lerChaveNfe(c)?.modelo !== 'nfce', 'Esta é uma chave de NFC-e; o RENAVE pede a NF-e (modelo 55).');

const protocolo = z.string().trim().min(1, 'Informe o protocolo').max(60);
const motivo = z.string().trim().min(3, 'Descreva o motivo').max(500);

export const registrarRenaveSchema = z.object({
  vehicleId: z.string().uuid(),
  tipo: z.enum(RENAVE_OPERACOES),
  /** Só na saída por venda. */
  dealId: z.string().uuid().optional(),
  /** Com protocolo o registro nasce confirmado; sem, fica aguardando. */
  protocolo: protocolo.optional(),
  registradoEm: dataPassada('A data do registro').optional(),
  /** Data do fato. Sem ela, vale a da aquisição (entrada) ou do faturamento (venda). */
  dataOperacao: dataPassada('A data da operação').optional(),
  chaveNfe: chaveNfeDoRenave.optional(),
  observacao: z.string().trim().max(500).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.tipo === 'saida_venda' && !v.dealId) {
    ctx.addIssue({ code: 'custom', path: ['dealId'], message: 'A saída por venda é registrada a partir do negócio.' });
  }
  if (v.tipo !== 'saida_venda' && v.dealId) {
    ctx.addIssue({ code: 'custom', path: ['dealId'], message: 'Só a saída por venda aponta para um negócio.' });
  }
  if (v.registradoEm && !v.protocolo) {
    ctx.addIssue({ code: 'custom', path: ['protocolo'], message: 'Data do registro sem protocolo: informe os dois.' });
  }
});
export type RegistrarRenaveInput = z.infer<typeof registrarRenaveSchema>;

export const confirmarRenaveSchema = z.object({
  protocolo,
  registradoEm: dataPassada('A data do registro').optional(),
}).strict();
export type ConfirmarRenaveInput = z.infer<typeof confirmarRenaveSchema>;

export const recusarRenaveSchema = z.object({ motivo }).strict();

export const cancelarRenaveSchema = z.object({
  motivo,
  /** O protocolo que a integradora devolveu para o cancelamento, se houver. */
  protocoloCancelamento: protocolo.optional(),
}).strict();
export type CancelarRenaveInput = z.infer<typeof cancelarRenaveSchema>;

export const chaveNfeRenaveSchema = z.object({ chaveNfe: chaveNfeDoRenave }).strict();

/**
 * Envio pela integradora (R2). O documento do veículo vem no corpo porque o
 * AutoConnect não o tem — e o **código de segurança do CRV não é gravado**:
 * vai para a integradora e some (decisão de 14/10/2026). Reenviar pede de novo.
 *
 * O RENAVAM só tem o formato conferido (até 11 dígitos, com zeros à esquerda):
 * o dígito verificador não está no manual do RENAVE, e regra sem fonte não
 * vira recusa — quem recusa RENAVAM errado é o RENAVE.
 */
export const enviarRenaveSchema = z.object({
  vehicleId: z.string().uuid(),
  tipo: z.enum(RENAVE_OPERACOES),
  dealId: z.string().uuid().optional(),
  dataOperacao: dataPassada('A data da operação').optional(),
  observacao: z.string().trim().max(500).optional(),
  crv: z.object({
    renavam: z.string().trim()
      .regex(/^\d{9,11}$/, 'RENAVAM tem até 11 dígitos')
      .transform((v) => v.padStart(11, '0')),
    tipoCrv: z.enum(TIPOS_DE_CRV),
    numeroCrv: z.string().trim().regex(/^\d{1,15}$/, 'Número do CRV só com dígitos').optional(),
    codigoSegurancaCrv: z.string().trim().regex(/^\d{8,12}$/, 'O código de segurança do CRV tem só dígitos'),
  }).strict(),
  /** Na entrada. Sem ele, vale a quilometragem do cadastro do veículo. */
  quilometragem: z.number().int().min(0).max(2_000_000).optional(),
  /** Quem consta no CRV, quando a aquisição não tem o documento do fornecedor. */
  documentoDoProprietario: z.string().trim().max(20).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.tipo === 'saida_venda' && !v.dealId) {
    ctx.addIssue({ code: 'custom', path: ['dealId'], message: 'A saída por venda é enviada a partir do negócio.' });
  }
  if (v.tipo !== 'saida_venda' && v.dealId) {
    ctx.addIssue({ code: 'custom', path: ['dealId'], message: 'Só a saída por venda aponta para um negócio.' });
  }
});
export type EnviarRenaveInput = z.infer<typeof enviarRenaveSchema>;

/** Só com a integradora simulada, fora de produção. */
export const simularRenaveSchema = z.object({
  acao: z.enum(['confirmar', 'recusar']),
}).strict();
