import { z } from 'zod';

/**
 * Linha de importação em lote — o frontend já valida célula a célula,
 * mas o backend revalida tudo (nunca confiar no cliente).
 */
export const importRowSchema = z.object({
  brandName: z.string().trim().min(2).max(60)
    .refine((v) => !/^\d+$/.test(v), 'Nome de marca não pode ser numérico'),
  // modelos numéricos reais existem (208, 911, 147…) — bloqueia apenas zeros
  modelName: z.string().trim().min(1).max(80)
    .refine((v) => !/^0+$/.test(v), 'Nome de modelo inválido'),
  versionName: z.string().trim().max(120).optional(),
  condition: z.enum(['new', 'used', 'semi_new', 'demo']),
  yearModel: z.number().int().min(1950).max(new Date().getFullYear() + 1),
  yearMake: z.number().int().min(1950).max(new Date().getFullYear() + 1),
  mileageKm: z.number().int().min(0).max(2_000_000),
  color: z.string().trim().max(40).optional(),
  fuel: z.enum(['gasoline', 'ethanol', 'flex', 'diesel', 'hybrid', 'electric', 'gnv']).optional(),
  transmission: z.enum(['manual', 'automatic', 'cvt', 'automated_manual']).optional(),
  engine: z.string().trim().max(40).optional(),
  doors: z.number().int().min(2).max(6).optional(),
  price: z.number().positive().max(100_000_000),
  promoPrice: z.number().positive().max(100_000_000).optional(),
  description: z.string().trim().max(5000).optional(),
});

export const importVehiclesSchema = z.object({
  rows: z.array(importRowSchema).min(1, 'Nenhuma linha para importar').max(300, 'Máximo de 300 veículos por importação'),
});

export type ImportRow = z.infer<typeof importRowSchema>;
