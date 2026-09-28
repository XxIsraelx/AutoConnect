import {
  PORTAIS,
  codigoDeConfirmacaoDoGmail,
  interpretarEmailDeLead,
  leadDePortalSchema,
  leadDePortalUtilizavel,
  resumoDaConfirmacaoDoGmail,
  type ChaveDoPortal,
  type EmailDeEntrada,
  type LeadDePortal,
} from '@autoconnect/shared';

/**
 * O que uma entrega significa. Os leitores são funções puras: recebem o que
 * está guardado em `portal_deliveries.raw_body` e devolvem isto — é o que
 * permite reprocessar uma entrega antiga com um leitor novo.
 */
export type Leitura =
  | { tipo: 'leads'; leads: LeadDePortal[]; resumo: string }
  | { tipo: 'ignorado'; resumo: string }
  | { tipo: 'nao_entendido'; resumo: string };

/**
 * Leitor específico por portal, quando o genérico não bastar. Vazio de
 * propósito: um leitor da OLX escrito sem um e-mail real da OLX seria
 * adivinhação com cara de integração. Quando a amostra chegar, ela vira caso de
 * teste e o leitor entra aqui — e as entregas guardadas como "não entendidas"
 * são reprocessadas com ele.
 */
const LEITORES_DE_EMAIL: Partial<Record<ChaveDoPortal, (e: EmailDeEntrada) => LeadDePortal | null>> = {};

function resumoDosLeads(leads: LeadDePortal[]): string {
  const nomes = leads.map((l) => l.nome ?? l.telefone ?? l.email).filter(Boolean);
  return nomes.length ? nomes.join(', ') : `${leads.length} lead(s)`;
}

export function lerEmail(portal: ChaveDoPortal, email: EmailDeEntrada): Leitura {
  const codigo = codigoDeConfirmacaoDoGmail(email);
  if (codigo) {
    return { tipo: 'ignorado', resumo: resumoDaConfirmacaoDoGmail(codigo) };
  }
  const leitor = LEITORES_DE_EMAIL[portal] ?? interpretarEmailDeLead;
  const lead = leitor(email);
  if (!lead) {
    return { tipo: 'nao_entendido', resumo: email.assunto?.slice(0, 200) || '(e-mail sem assunto)' };
  }
  return { tipo: 'leads', leads: [lead], resumo: resumoDosLeads([lead]) };
}

/**
 * O webhook aceita o formato AutoConnect (`leadDePortalSchema`) de qualquer
 * portal ou integração. Corpo que não é JSON, ou JSON fora do formato, fica
 * guardado como "não entendido" — e não vira erro para quem enviou: o portal
 * reenviaria para sempre algo que só um leitor novo vai entender.
 */
export function lerWebhook(portal: ChaveDoPortal, corpo: string): Leitura {
  let json: unknown;
  try {
    json = JSON.parse(corpo);
  } catch {
    return { tipo: 'nao_entendido', resumo: `Corpo que não é JSON (${PORTAIS[portal].nome})` };
  }
  const r = leadDePortalSchema.safeParse(json);
  if (!r.success) {
    return { tipo: 'nao_entendido', resumo: `JSON fora do formato AutoConnect (${PORTAIS[portal].nome})` };
  }
  const leads = (Array.isArray(r.data) ? r.data : [r.data]).filter(leadDePortalUtilizavel);
  if (leads.length === 0) {
    return { tipo: 'nao_entendido', resumo: 'Lead sem telefone nem e-mail' };
  }
  return { tipo: 'leads', leads, resumo: resumoDosLeads(leads) };
}
