import { z } from 'zod';
import { telefoneBrValido } from '../domain/telefone';
import { MODELOS_MANUAIS, STATUS_DE_ENTREGA } from '../domain/whatsapp';

/**
 * Entradas das rotas do WhatsApp. Todo corpo passa por aqui (armadilha nº 3 do
 * CLAUDE.md): o que não está no schema é descartado antes de chegar ao serviço.
 */

/**
 * Conectar o número da loja.
 *
 * `numero` é o que aparece para o cliente (e na tela). `idExterno` é o id do
 * número no provedor — na Meta, o `phone_number_id` —, obrigatório com o
 * provedor real e gerado pelo simulado. A conferência "obrigatório com a Meta"
 * fica no serviço, que é quem sabe qual provedor está ligado.
 */
export const conectarWhatsAppSchema = z
  .object({
    numero: z
      .string()
      .trim()
      .refine(telefoneBrValido, 'Informe o número do WhatsApp com DDD.'),
    idExterno: z
      .string()
      .trim()
      .regex(/^\d{5,30}$/, 'O id do número são só dígitos, como aparece no painel da Meta.')
      .optional(),
  })
  .strict();
export type ConectarWhatsAppInput = z.infer<typeof conectarWhatsAppSchema>;

export const abrirConversaDeWhatsAppSchema = z
  .object({ leadId: z.string().uuid() })
  .strict();
export type AbrirConversaDeWhatsAppInput = z.infer<typeof abrirConversaDeWhatsAppSchema>;

/** Os parâmetros saem do lead, da loja e do vendedor — a tela só escolhe o modelo. */
export const enviarModeloDeWhatsAppSchema = z
  .object({ modelo: z.enum(MODELOS_MANUAIS as [string, ...string[]]) })
  .strict();
export type EnviarModeloDeWhatsAppInput = z.infer<typeof enviarModeloDeWhatsAppSchema>;

/**
 * Só com o provedor simulado, fora de produção: o que o cliente mandaria, ou o
 * aviso de entrega que o provedor mandaria, entregue pelo caminho real do
 * webhook.
 */
export const simularWhatsAppSchema = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('mensagem'),
      telefone: z.string().trim().refine(telefoneBrValido, 'Telefone inválido.'),
      nome: z.string().trim().min(1).max(80),
      texto: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      acao: z.literal('status'),
      mensagemId: z.string().uuid(),
      status: z.enum(STATUS_DE_ENTREGA.filter((s) => s !== 'enviando') as [string, ...string[]]),
    })
    .strict(),
]);
export type SimularWhatsAppInput = z.infer<typeof simularWhatsAppSchema>;
