/**
 * Quando um contato novo é *o mesmo cliente de novo*.
 *
 * O caso que motivou isto: o visitante clica em "tenho interesse", não recebe
 * resposta na mesma hora, clica outra vez, e mais uma. A loja abre o funil e vê
 * três pessoas diferentes — três cartões, três atribuições possíveis, e a
 * contagem de leads do relatório inflada.
 *
 * A regra vive aqui, e não no service, porque ela é decisão de produto e
 * precisa de teste próprio: *quais* leads antigos podem receber o contato novo
 * em vez de virar lead.
 */

/** Status em que o lead acabou: contato novo ali é atendimento novo mesmo. */
export const LEAD_STATUSES_TERMINAIS = ['won', 'lost', 'archived'] as const;

/**
 * Janela da deduplicação.
 *
 * Trinta dias é o prazo em que a loja ainda trata o contato como o mesmo
 * atendimento. Depois disso, quem volta é cliente que voltou — merece lead
 * novo, com data nova, e conta como oportunidade nova no relatório.
 */
export const JANELA_DEDUPE_DIAS = 30;

export const JANELA_DEDUPE_MS = JANELA_DEDUPE_DIAS * 24 * 60 * 60 * 1000;

/** O instante a partir do qual um lead ainda é candidato. */
export function corteDaDeduplicacao(agora: Date): Date {
  return new Date(agora.getTime() - JANELA_DEDUPE_MS);
}

export interface LeadCandidato {
  status: string;
  createdAt: Date;
  lastActivityAt: Date;
}

/**
 * Verdadeiro quando o contato novo deve virar interação neste lead, em vez de
 * lead novo.
 *
 * Usa a atividade **mais recente** entre criação e último contato: um lead
 * criado há 40 dias mas tocado ontem é um atendimento vivo, e abrir outro
 * partiria o histórico ao meio.
 */
export function elegivelParaDeduplicacao(lead: LeadCandidato, agora: Date): boolean {
  if ((LEAD_STATUSES_TERMINAIS as readonly string[]).includes(lead.status)) return false;

  const ultimoToque = Math.max(lead.createdAt.getTime(), lead.lastActivityAt.getTime());
  return ultimoToque >= corteDaDeduplicacao(agora).getTime();
}
