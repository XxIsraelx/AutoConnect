import { z } from 'zod';
import { telefoneBrValido } from '../domain/telefone';

/**
 * Valores espelhados do enum `LeadSource` do Prisma.
 *
 * Não são importados de `@autoconnect/db` de propósito: aquele pacote é
 * `export * from '@prisma/client'`, e o `@autoconnect/shared` é dependência do
 * `apps/web` — importar o Prisma aqui o arrastaria para o bundle do navegador,
 * junto dos binários nativos do engine.
 *
 * A cópia é segura porque `lead.spec.ts` compara as duas listas contra o enum
 * real do Prisma e quebra o CI se divergirem. Foi assim que `trade_in` ficou
 * de fora e fez a rota pública de troca recusar o próprio lead que criava.
 */
export const LEAD_SOURCES = [
  'website',
  'app',
  'whatsapp',
  'phone',
  'walk_in',
  'referral',
  'social',
  'ad',
  'other',
  'trade_in',
] as const;

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'negotiating',
  'won',
  'lost',
  'archived',
] as const;

export const createLeadSchema = z.object({
  // Para qual concessionária é o lead. Vinha do corpo cru, sem validação
  // nenhuma — sem checar sequer se era um uuid.
  tenantId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  customerUserId: z.string().uuid().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  source: z.enum(LEAD_SOURCES).default('website'),
  message: z.string().optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadStatusSchema = z.object({
  status: z.enum(LEAD_STATUSES),
  reason: z.string().optional(),
});
export type UpdateLeadStatusInput = z.infer<typeof updateLeadStatusSchema>;

/* ── Interações da timeline ──────────────────────────────── */

/**
 * Tipos de interação registrados na timeline do lead.
 *
 * `LeadInteraction.kind` é `String` no Prisma, **não** um enum — por isso não
 * há caso em `paridade-enums.spec.ts` para comparar. A lista fechada vive aqui
 * e é o schema Zod da rota que a faz valer: antes o corpo era
 * `{ kind: string }` anotado e qualquer palavra entrava na timeline, o que faz
 * o rótulo da tela cair no fallback e o filtro por tipo nunca casar.
 *
 * `whatsapp` e `call` existiam só como rótulo no front, sem nada que os
 * gravasse. São o que o clique no `wa.me` e no `tel:` passou a registrar.
 */
export const LEAD_INTERACTION_KINDS = [
  'created',
  'status_change',
  'assignment',
  'note',
  'call',
  'email',
  'whatsapp',
  'visit',
  'duplicate',
  'trade_in_appraisal',
  'other',
] as const;
export type LeadInteractionKind = (typeof LEAD_INTERACTION_KINDS)[number];

/** Os tipos que uma tela pode gravar à mão. Os demais são escritos pelo serviço. */
export const LEAD_INTERACTION_KINDS_MANUAIS = [
  'note',
  'call',
  'email',
  'whatsapp',
  'visit',
  'other',
] as const;

export const createLeadInteractionSchema = z.object({
  kind: z.enum(LEAD_INTERACTION_KINDS_MANUAIS),
  content: z.string().trim().max(2000).optional(),
});
export type CreateLeadInteractionInput = z.infer<typeof createLeadInteractionSchema>;

/* ── Lead anônimo (formulário público) ───────────────────── */

const telefoneBr = z
  .string()
  .trim()
  .min(8, 'Informe seu telefone')
  .max(30)
  .refine(telefoneBrValido, 'Telefone inválido. Use DDD + número, ex.: (11) 98765-4321');

/**
 * Formulário público de interesse — sem conta, sem token.
 *
 * O `tenantId` é opcional de propósito: quando há `vehicleId`, quem manda é a
 * loja **dona do veículo**, lida do banco. Um `tenantId` no corpo que não bata
 * com o do veículo é recusado, e nunca é usado sozinho para escolher a loja
 * quando o veículo está presente.
 */
export const leadPublicoSchema = z.object({
  tenantId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  contactName: z.string().trim().min(2, 'Informe seu nome').max(120),
  contactPhone: telefoneBr,
  contactEmail: z.string().trim().email('E-mail inválido').max(160).optional().or(z.literal('')),
  message: z.string().trim().max(2000).optional(),

  /**
   * Consentimento LGPD. `literal(true)` e não `boolean()`: um `false` tem que
   * ser recusado com erro de campo, não aceito como "não marcou".
   */
  consentimento: z.literal(true, {
    errorMap: () => ({ message: 'É preciso aceitar o uso dos seus dados para a loja entrar em contato.' }),
  }),
  /**
   * O texto exibido no momento do aceite, versionado pela própria cópia: o
   * termo muda com o tempo e a prova de consentimento tem que ser do termo que
   * a pessoa leu, não do termo de hoje.
   */
  consentText: z.string().trim().min(20, 'Texto de consentimento ausente').max(2000),

  /**
   * Armadilha para robô: campo invisível no formulário. Gente não preenche.
   * Não é validação — o preenchimento faz a requisição ser descartada em
   * silêncio, com a mesma resposta de sucesso, para não ensinar o robô.
   */
  website: z.string().max(200).optional(),
})
  .refine((v) => !!v.vehicleId || !!v.tenantId, {
    message: 'Informe o veículo ou a concessionária',
    path: ['vehicleId'],
  });
export type LeadPublicoInput = z.infer<typeof leadPublicoSchema>;

/* ── Lead manual (vendedor cadastrando quem ligou) ───────── */

/**
 * Origens que um vendedor pode escolher ao cadastrar à mão.
 *
 * `website`, `app` e `trade_in` ficam de fora: são registradas pelo próprio
 * sistema, e deixá-las na lista faria o relatório de origem mentir — um lead
 * de balcão marcado como "site" some do custo de aquisição.
 */
export const LEAD_SOURCES_MANUAIS = [
  'phone',
  'whatsapp',
  'walk_in',
  'referral',
  'social',
  'ad',
  'other',
] as const;

export const leadManualSchema = z.object({
  contactName: z.string().trim().min(2, 'Informe o nome').max(120),
  contactPhone: telefoneBr,
  contactEmail: z.string().trim().email('E-mail inválido').max(160).optional().or(z.literal('')),
  source: z.enum(LEAD_SOURCES_MANUAIS),
  vehicleId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  /** Padrão no serviço: quem está cadastrando. */
  assignedTo: z.string().uuid().optional(),
  message: z.string().trim().max(2000).optional(),
});
export type LeadManualInput = z.infer<typeof leadManualSchema>;
