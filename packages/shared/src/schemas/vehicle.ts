import { z } from 'zod';

export const createVehicleSchema = z.object({
  branchId: z.string().uuid().optional(),
  brandId: z.string().uuid(),
  modelId: z.string().uuid(),
  versionName: z.string().optional(),
  yearModel: z.number().int().min(1900).max(2100),
  yearMake: z.number().int().min(1900).max(2100),
  color: z.string().optional(),
  mileageKm: z.number().int().min(0).default(0),
  fuel: z
    .enum(['gasoline', 'ethanol', 'flex', 'diesel', 'hybrid', 'electric', 'gnv'])
    .optional(),
  transmission: z
    .enum(['manual', 'automatic', 'cvt', 'automated_manual'])
    .optional(),
  engine: z.string().optional(),
  doors: z.number().int().min(2).max(6).optional(),
  vin: z.string().optional(),
  licensePlate: z.string().optional(),
  condition: z.enum(['new', 'used', 'semi_new', 'demo']).default('used'),
  price: z.number().positive(),
  promoPrice: z.number().positive().optional(),
  description: z.string().optional(),
  featureIds: z.array(z.string().uuid()).default([]),
  // Histórico de uso (armazenado em metadata) — relevante p/ usados
  previousOwners: z.number().int().min(0).max(50).optional(),
  firstRegistration: z.string().optional(), // "YYYY-MM"
  singleOwner: z.boolean().optional(),
});
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = createVehicleSchema.partial();
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

export const vehicleQuerySchema = z.object({
  q: z.string().optional(),
  brandId: z.string().uuid().optional(),
  modelId: z.string().uuid().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  minYear: z.coerce.number().optional(),
  condition: z.enum(['new', 'used', 'semi_new', 'demo']).optional(),
  status: z
    .enum(['available', 'reserved', 'sold', 'in_maintenance', 'archived'])
    .default('available'),
  page: z.coerce.number().min(1).default(1),
  perPage: z.coerce.number().min(1).max(100).default(20),
});
export type VehicleQuery = z.infer<typeof vehicleQuerySchema>;
