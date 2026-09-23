import { z } from 'zod';
import { telefoneBrValido } from '../domain/telefone';

/**
 * Valores espelhados dos enums `AppointmentType` e `AppointmentStatus` do
 * Prisma — pela mesma razão de `LEAD_SOURCES`: importar `@autoconnect/db` aqui
 * arrastaria o Prisma para o bundle do navegador. `paridade-enums.spec.ts`
 * compara as duas listas com o enum real e quebra o CI se divergirem.
 */
export const APPOINTMENT_TYPES = [
  'test_drive',
  'evaluation',
  'in_person',
  'online',
  'delivery',
  'service',
] as const;

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'in_progress',
  'completed',
  'canceled',
  'no_show',
] as const;

/** Duração padrão de um compromisso, quando a tela não informa outra. */
export const DURACAO_PADRAO_MINUTOS = 60;

/** Agendamento pedido pelo próprio cliente, na página pública. */
export const agendamentoDoClienteSchema = z.object({
  tenantId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  type: z.enum(APPOINTMENT_TYPES),
  scheduledStart: z.string().datetime({ offset: true }),
  notes: z.string().trim().max(2000).optional(),
});
export type AgendamentoDoClienteInput = z.infer<typeof agendamentoDoClienteSchema>;

/**
 * Agendamento marcado pela loja.
 *
 * O ponto todo é o cliente **sem conta**: quem ligou, quem apareceu no balcão.
 * Por isso os três caminhos de identificação, e por isso o `superRefine` — sem
 * ele o agendamento nasceria anônimo e ninguém saberia quem esperar.
 *
 *  - `customerUserId`: o cliente já tem conta no AutoConnect;
 *  - `leadId`: já existe um lead com o contato dele (o serviço copia o nome e
 *    o telefone para o agendamento, porque o lembrete precisa deles na mão);
 *  - `contactName` + `contactPhone`: contato avulso, digitado na hora.
 */
export const agendamentoDaLojaSchema = z.object({
  customerUserId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  contactName: z.string().trim().min(2, 'Informe o nome').max(120).optional(),
  contactPhone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v === '' || telefoneBrValido(v), 'Telefone inválido. Use DDD + número')
    .optional(),
  contactEmail: z.string().trim().email('E-mail inválido').max(160).optional().or(z.literal('')),

  type: z.enum(APPOINTMENT_TYPES),
  scheduledStart: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  vehicleId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  /** Padrão no serviço: quem está marcando. */
  salespersonId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
}).superRefine((v, ctx) => {
  const temContatoProprio = !!v.contactName && !!v.contactPhone;
  if (v.customerUserId || v.leadId || temContatoProprio) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['contactName'],
    message:
      'Escolha um cliente, um lead, ou informe nome e telefone de contato — ' +
      'o lembrete e o atendimento precisam saber quem esperar.',
  });
});
export type AgendamentoDaLojaInput = z.infer<typeof agendamentoDaLojaSchema>;

/** Campos que a loja pode alterar depois. */
export const atualizarAgendamentoSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  scheduledStart: z.string().datetime({ offset: true }).optional(),
  salespersonId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type AtualizarAgendamentoInput = z.infer<typeof atualizarAgendamentoSchema>;
