import { z } from 'zod';

const THIS_YEAR = new Date().getFullYear();

/** Dados do veículo que o cliente oferece na troca */
export const tradeInVehicleSchema = z.object({
  brandName:   z.string().trim().min(2, 'Informe a marca').max(60),
  modelName:   z.string().trim().min(1, 'Informe o modelo').max(80),
  versionName: z.string().trim().max(120).optional(),
  yearMake:    z.number().int().min(1950).max(THIS_YEAR + 1),
  yearModel:   z.number().int().min(1950).max(THIS_YEAR + 1),
  mileageKm:   z.number().int().min(0).max(2_000_000),
  color:       z.string().trim().max(40).optional(),
  fuel:        z.enum(['gasoline', 'ethanol', 'flex', 'diesel', 'hybrid', 'electric', 'gnv']).optional(),
  transmission: z.enum(['manual', 'automatic', 'cvt', 'automated_manual']).optional(),
  plate:       z.string().trim().max(10).optional(),
  hasDebts:    z.boolean().optional(),
  isFinanced:  z.boolean().optional(),
  notes:       z.string().trim().max(2000).optional(),
});

/** Oferta de troca enviada por uma página pública */
export const tradeInSchema = z.object({
  tenantId:         z.string().uuid(),
  desiredVehicleId: z.string().uuid().optional(),
  contactName:      z.string().trim().min(2, 'Informe seu nome').max(120),
  contactEmail:     z.string().trim().email('E-mail inválido').max(160),
  contactPhone:     z.string().trim().max(30).optional(),
  expectedValue:    z.number().positive().max(100_000_000).optional(),
  message:          z.string().trim().max(2000).optional(),
  vehicle:          tradeInVehicleSchema,
});

export type TradeInInput = z.infer<typeof tradeInSchema>;
