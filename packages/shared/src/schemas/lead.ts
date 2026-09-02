import { z } from 'zod';

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
