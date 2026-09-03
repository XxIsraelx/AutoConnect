import { z } from 'zod';
import { cpfValido } from './auth';

export const updateTenantSchema = z.object({
  tradeName: z.string().min(2).max(200).optional(),
  logoUrl: z.string().url().optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  websiteUrl: z.string().url().optional(),
  timezone: z.string().optional(),

  /**
   * Representante legal que assina os contratos pela loja. Opcional aqui —
   * quem exige é a emissão do contrato, que recusa sem ele.
   */
  legalRepName: z.string().min(3).max(160).optional(),
  legalRepCpf: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || cpfValido(v), 'CPF inválido — confira os dígitos.')
    .optional(),
  legalRepRole: z.string().max(60).optional(),
});
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const createBranchSchema = z.object({
  name: z.string().min(2).max(200),
  isHeadquarters: z.boolean().default(false),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  addressLine: z.string().optional(),
  addressNumber: z.string().optional(),
  complement: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().default('BR'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

/**
 * Atualização de filial: os mesmos campos da criação, todos opcionais.
 *
 * Existe para que o corpo passe pelo Zod em vez de ir cru para o Prisma —
 * `isHeadquarters` e `isActive` não estão aqui de propósito, porque trocar a
 * matriz ou desativar filial merece rota própria, não um PATCH genérico.
 */
export const updateBranchSchema = createBranchSchema
  .omit({ isHeadquarters: true })
  .partial();

export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
