import { z } from 'zod';
import { SLA_MINUTOS_MAX, SLA_MINUTOS_MIN } from '../domain/sla';

/**
 * Ajustes de CRM da concessionária: rodízio, prazo de primeiro contato e
 * carteira do vendedor.
 *
 * Vivem numa tabela própria (`tenant_crm_settings`) e numa rota própria
 * (`/crm/settings`), e não em `PATCH /tenant/me`, por três motivos:
 *
 *  1. a mesma linha guarda o **estado do rodízio** (quem foi o último
 *     atribuído), que é escrito pelo sistema a cada lead e travado com
 *     `SELECT … FOR UPDATE`. Travar a linha do `tenants` a cada lead que chega
 *     bloquearia o cadastro da loja inteira;
 *  2. `updateTenantSchema` é deliberadamente estreito — `settings`, `slug` e
 *     `isActive` ficam de fora dele desde o conserto de mass assignment;
 *  3. quem pode mexer é gerente ou administrador, não quem edita a vitrine.
 */
export const crmSettingsSchema = z.object({
  /** Distribui sozinho o lead que chega sem responsável. */
  rodizioAtivo: z.boolean(),
  /** Gerentes e administradores entram na fila junto dos vendedores. */
  rodizioIncluiGerentes: z.boolean(),
  /** Minutos de **expediente** até o primeiro contato. */
  slaPrimeiroContatoMinutos: z
    .number()
    .int('Informe um número inteiro de minutos.')
    .min(SLA_MINUTOS_MIN, `O prazo não pode ser menor que ${SLA_MINUTOS_MIN} minuto.`)
    .max(SLA_MINUTOS_MAX, `O prazo não pode passar de ${SLA_MINUTOS_MAX} minutos.`),
  /**
   * Devolver o lead estourado à fila. Padrão desligado: tirar o lead de um
   * vendedor é decisão de gestão, não efeito colateral de um alarme.
   */
  slaDevolveParaFila: z.boolean(),
  /**
   * Padrão **ligado** para não mudar o que a loja já vê hoje. Desligado, o
   * vendedor passa a enxergar só os próprios leads e os da fila.
   */
  vendedorVeTodosOsLeads: z.boolean(),
});

export type CrmSettingsInput = z.infer<typeof crmSettingsSchema>;

/** PATCH aceita um subconjunto — a tela salva um interruptor por vez. */
export const updateCrmSettingsSchema = crmSettingsSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Nada para alterar.' },
);

export type UpdateCrmSettingsInput = z.infer<typeof updateCrmSettingsSchema>;

/**
 * Plantão de um membro da equipe.
 *
 * `emPlantao` é o interruptor (a coluna `is_accepting_leads`, que já existia em
 * `salesperson_profiles` sem nenhuma tela). `ausenteAte` é a pausa temporária:
 * enquanto estiver no futuro, o membro sai do rodízio sem que ninguém precise
 * lembrar de religar o interruptor na volta.
 */
export const plantaoSchema = z.object({
  emPlantao: z.boolean().optional(),
  ausenteAte: z
    .string()
    .datetime({ offset: true, message: 'Data inválida.' })
    .nullable()
    .optional(),
}).refine((v) => v.emPlantao !== undefined || v.ausenteAte !== undefined, {
  message: 'Nada para alterar.',
});

export type PlantaoInput = z.infer<typeof plantaoSchema>;

/** Está apto a receber lead do rodízio agora? */
export function emPlantaoAgora(
  membro: { emPlantao: boolean; ausenteAte: Date | string | null },
  agora: Date = new Date(),
): boolean {
  if (!membro.emPlantao) return false;
  if (!membro.ausenteAte) return true;
  return new Date(membro.ausenteAte) <= agora;
}
