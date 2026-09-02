import { z } from 'zod';
import {
  DEAL_STATUSES,
  PAYMENT_KINDS,
  PAYMENT_STATUSES,
  ACQUISITION_ORIGINS,
  VEHICLE_COST_KINDS,
} from '../domain/deal';

/**
 * Dinheiro entra como **string**, nunca como número.
 *
 * `z.number()` aceitaria `1234.565` e o valor já chegaria arredondado pelo
 * parser de JSON antes de qualquer validação nossa. Exigir string com no
 * máximo duas casas move a recusa para a borda, que é onde ela é barata.
 */
export const valorMonetario = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use um valor como "12345.67", sem separador de milhar');

export const createDealSchema = z.object({
  vehicleId: z.string().uuid(),
  leadId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  customerUserId: z.string().uuid().optional(),
  salespersonId: z.string().uuid().optional(),
  listPrice: valorMonetario,
  discount: valorMonetario.default('0'),
  saleValue: valorMonetario,
});

export const updateDealSchema = z
  .object({
    listPrice: valorMonetario,
    discount: valorMonetario,
    saleValue: valorMonetario,
    branchId: z.string().uuid().nullable(),
    salespersonId: z.string().uuid().nullable(),
    customerUserId: z.string().uuid().nullable(),
  })
  .partial();

export const transitionDealSchema = z.object({
  to: z.enum(DEAL_STATUSES),
  reason: z.string().max(500).optional(),
});

export const createDealPaymentSchema = z.object({
  kind: z.enum(PAYMENT_KINDS),
  status: z.enum(PAYMENT_STATUSES).default('pending'),
  value: valorMonetario,
  institution: z.string().max(120).optional(),
  installments: z.number().int().min(1).max(120).optional(),
  installmentValue: valorMonetario.optional(),
  notes: z.string().max(500).optional(),
});

export const listDealsSchema = z.object({
  status: z.enum(DEAL_STATUSES).optional(),
  salespersonId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export const createAcquisitionSchema = z.object({
  origin: z.enum(ACQUISITION_ORIGINS),
  supplierName: z.string().max(160).optional(),
  supplierDocument: z.string().max(20).optional(),
  purchaseValue: valorMonetario,
  enteredAt: z.coerce.date(),
  notes: z.string().max(500).optional(),
});

export const createVehicleCostSchema = z.object({
  kind: z.enum(VEHICLE_COST_KINDS),
  value: valorMonetario,
  description: z.string().max(300).optional(),
  supplierName: z.string().max(160).optional(),
  incurredAt: z.coerce.date(),
});

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type TransitionDealInput = z.infer<typeof transitionDealSchema>;
export type CreateDealPaymentInput = z.infer<typeof createDealPaymentSchema>;
export type ListDealsInput = z.infer<typeof listDealsSchema>;
export type CreateAcquisitionInput = z.infer<typeof createAcquisitionSchema>;
export type CreateVehicleCostInput = z.infer<typeof createVehicleCostSchema>;
