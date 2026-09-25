import { z } from 'zod';
import { telefoneBrSchema } from '@autoconnect/shared';

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

/**
 * Oferta de troca enviada por uma página pública.
 *
 * Desde 25/09/2026 ele pede o mesmo que o formulário de interesse
 * (`leadPublicoSchema`), e pelo mesmo motivo: o lead que nasce daqui é um lead
 * como os outros. Antes entrava sem consentimento LGPD — embora o formulário
 * coletasse nome, e-mail, telefone e **placa** — e com o telefone opcional, o
 * que o deixava sem `contact_phone_normalized` e fora de qualquer comparação
 * por telefone.
 */
export const tradeInSchema = z.object({
  tenantId:         z.string().uuid(),
  desiredVehicleId: z.string().uuid().optional(),
  contactName:      z.string().trim().min(2, 'Informe seu nome').max(120),
  contactEmail:     z.string().trim().email('E-mail inválido').max(160),
  /** Obrigatório: é por ele que a loja liga para dar o valor da avaliação. */
  contactPhone:     telefoneBrSchema,
  expectedValue:    z.number().positive().max(100_000_000).optional(),
  message:          z.string().trim().max(2000).optional(),

  /**
   * Consentimento LGPD. `literal(true)` e não `boolean()`: um `false` tem que
   * ser recusado com erro de campo, não aceito como "não marcou".
   */
  consentimento: z.literal(true, {
    errorMap: () => ({
      message: 'É preciso aceitar o uso dos seus dados para a loja avaliar seu carro.',
    }),
  }),
  /**
   * O texto exibido no aceite, guardado **por cópia** em `leads.consent_text`.
   * Mudar a frase no `TradeInModal` é publicar uma versão nova; os aceites
   * antigos seguem guardando o que a pessoa leu.
   */
  consentText: z.string().trim().min(20, 'Texto de consentimento ausente').max(2000),

  vehicle:          tradeInVehicleSchema,
}).strict();

export type TradeInInput = z.infer<typeof tradeInSchema>;
