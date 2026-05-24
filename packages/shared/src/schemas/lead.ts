import { z } from 'zod';

export const createLeadSchema = z.object({
  vehicleId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  customerUserId: z.string().uuid().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  source: z
    .enum([
      'website',
      'app',
      'whatsapp',
      'phone',
      'walk_in',
      'referral',
      'social',
      'ad',
      'other',
    ])
    .default('website'),
  message: z.string().optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadStatusSchema = z.object({
  status: z.enum([
    'new',
    'contacted',
    'qualified',
    'negotiating',
    'won',
    'lost',
    'archived',
  ]),
  reason: z.string().optional(),
});
export type UpdateLeadStatusInput = z.infer<typeof updateLeadStatusSchema>;
