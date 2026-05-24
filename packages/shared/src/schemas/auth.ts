import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const signupTenantSchema = z.object({
  tenant: z.object({
    legalName: z.string().min(2).max(200),
    tradeName: z.string().min(2).max(200),
    slug: z
      .string()
      .min(3)
      .max(50)
      .regex(/^[a-z0-9-]+$/, 'apenas minúsculas, números e hífen'),
    taxId: z.string().optional(),
    primaryEmail: z.string().email(),
    primaryPhone: z.string().optional(),
  }),
  admin: z.object({
    fullName: z.string().min(2).max(200),
    email: z.string().email(),
    password: z.string().min(8).max(128),
  }),
  branch: z.object({
    city: z.string().min(2).max(100),
    state: z.string().length(2),
    phone: z.string().optional(),
    addressLine: z.string().optional(),
    postalCode: z.string().optional(),
  }).optional(),
});
export type SignupTenantInput = z.infer<typeof signupTenantSchema>;

export const signupCustomerSchema = z.object({
  fullName: z.string().min(2).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  phone: z.string().min(10).max(20).optional(),
  cpf: z
    .string()
    .regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{11}$/, 'CPF inválido')
    .optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD)').optional(),
  postalCode: z.string().min(8).max(9).optional(),
  addressLine: z.string().max(200).optional(),
  addressNumber: z.string().max(20).optional(),
  complement: z.string().max(100).optional(),
  neighborhood: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  state: z.string().length(2).toUpperCase().optional(),
});
export type SignupCustomerInput = z.infer<typeof signupCustomerSchema>;

export const inviteUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['tenant_admin', 'manager', 'salesperson']),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
