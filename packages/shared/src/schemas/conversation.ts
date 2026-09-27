import { z } from 'zod';

/**
 * Entradas do chat.
 *
 * As duas rotas de criação de conversa passavam o corpo **só anotado** para o
 * serviço (`corpos-do-web.spec.ts` as listava como dívida declarada). Agora que
 * `POST /conversations/from-lead` abre conversa para lead **sem conta** — e
 * portanto cria um token de acesso —, o corpo cru deixou de ser aceitável: um
 * `leadId` que não é uuid chegaria ao Prisma como 500, e o visitante ganharia
 * uma porta que ninguém pediu.
 */

export const iniciarConversaSchema = z
  .object({
    tenantId: z.string().uuid(),
    vehicleId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
  })
  .strict();
export type IniciarConversaInput = z.infer<typeof iniciarConversaSchema>;

export const conversaDoLeadSchema = z
  .object({ leadId: z.string().uuid() })
  .strict();
export type ConversaDoLeadInput = z.infer<typeof conversaDoLeadSchema>;

/**
 * Mensagem do visitante **sem conta**, pela página do link de acesso.
 *
 * O teto de 2000 caracteres é o mesmo da mensagem do lead público. Não há
 * anexo: o visitante não é autenticado, e aceitar arquivo de quem só tem um
 * link é abrir um depósito anônimo.
 */
export const mensagemDeVisitanteSchema = z
  .object({
    body: z.string().trim().min(1, 'Escreva uma mensagem.').max(2000),
  })
  .strict();
export type MensagemDeVisitanteInput = z.infer<typeof mensagemDeVisitanteSchema>;

/**
 * O tamanho do token de acesso do visitante, em bytes de entropia.
 *
 * 32 bytes em base64url dão 43 caracteres — o mesmo do convite de equipe. É um
 * segredo portador: quem tem o link entra na conversa, então ele não pode ser
 * curto o bastante para ser tentado.
 */
export const BYTES_DO_TOKEN_DE_VISITANTE = 32;

/** Mínimo plausível para um token de visitante, usado para recusar cedo. */
export const TAMANHO_MINIMO_DO_TOKEN_DE_VISITANTE = 20;
