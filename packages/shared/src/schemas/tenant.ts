import { z } from 'zod';

export const updateTenantSchema = z.object({
  tradeName: z.string().min(2).max(200).optional(),
  logoUrl: z.string().url().optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  websiteUrl: z.string().url().optional(),
  timezone: z.string().optional(),
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
