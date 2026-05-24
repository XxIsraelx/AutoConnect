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
});
export type SignupTenantInput = z.infer<typeof signupTenantSchema>;

export const inviteUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['tenant_admin', 'manager', 'salesperson']),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
