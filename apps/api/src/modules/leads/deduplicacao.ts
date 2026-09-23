import { Prisma } from '@autoconnect/db';
import {
  corteDaDeduplicacao,
  LEAD_STATUSES_TERMINAIS,
  normalizarTelefoneBr,
} from '@autoconnect/shared';
import type { ScopedClient } from '../../common/prisma/prisma.service';

/**
 * Deduplicação de leads.
 *
 * O problema: o visitante clica em "tenho interesse" três vezes, e a loja abre
 * o funil com três cartões do mesmo cliente. O vendedor liga três vezes, a
 * contagem de leads do relatório infla, e a atribuição pode cair em três
 * pessoas diferentes.
 *
 * A regra de *quais* leads são candidatos vive no shared (`lead-duplicado.ts`),
 * com teste próprio. O que está aqui é o acesso ao banco, e ele é sempre
 * chamado **de dentro de um `withTenant`** — o `tx` recebido já carrega o
 * contexto. Por isso as funções recebem `tx` em vez do `PrismaService`: não há
 * caminho por onde alguém as chame sem contexto.
 */

/** O que o front precisa saber quando o contato caiu num lead que já existia. */
export interface ResultadoDeDeduplicacao<T> {
  lead: T;
  deduplicado: boolean;
}

export interface ContatoDoLead {
  contactPhone?: string | null;
  contactEmail?: string | null;
}

/**
 * Procura, nesta loja, um lead vivo do mesmo contato dentro da janela.
 *
 * Telefone e e-mail são somados com OR de propósito: o cliente que ligou ontem
 * e preencheu o formulário hoje com o mesmo e-mail e outro telefone é a mesma
 * pessoa. O telefone é comparado pela forma canônica (`contactPhoneNormalized`),
 * que é o que faz `(11) 98765-4321` e `1187654321` casarem.
 */
export async function acharLeadDuplicado(
  tx: ScopedClient,
  tenantId: string,
  contato: ContatoDoLead,
  agora = new Date(),
): Promise<{ id: string; vehicleId: string | null; status: string } | null> {
  const telefone = normalizarTelefoneBr(contato.contactPhone);
  const email = contato.contactEmail?.trim() || null;

  const porContato: Prisma.LeadWhereInput[] = [];
  if (telefone) porContato.push({ contactPhoneNormalized: telefone });
  if (email) porContato.push({ contactEmail: email });

  // Sem contato nenhum não há como deduplicar — e um OR vazio no Prisma casaria
  // com tudo, que é exatamente o erro que juntaria leads de pessoas diferentes.
  if (porContato.length === 0) return null;

  const corte = corteDaDeduplicacao(agora);

  const encontrado = await tx.lead.findFirst({
    where: {
      tenantId,
      status: { notIn: [...LEAD_STATUSES_TERMINAIS] },
      OR: porContato,
      // Criado OU tocado dentro da janela: um lead de 40 dias que o vendedor
      // trabalhou ontem continua sendo o mesmo atendimento.
      AND: [{ OR: [{ createdAt: { gte: corte } }, { lastActivityAt: { gte: corte } }] }],
    },
    orderBy: { lastActivityAt: 'desc' },
    select: { id: true, vehicleId: true, status: true },
  });

  return encontrado;
}

export interface ContatoRepetido {
  tenantId: string;
  leadId: string;
  /** Nulo quando veio da rota pública: não há usuário por trás do clique. */
  actorUserId?: string | null;
  /** Veículo do contato novo — pode ser outro, e isso vai para a timeline. */
  vehicleId?: string | null;
  vehicleIdAtual: string | null;
  source: string;
  message?: string | null;
  origem: 'publico' | 'manual' | 'cliente';
}

/**
 * Registra o contato novo no lead que já existia, em vez de criar outro.
 *
 * Três efeitos, e cada um tem um motivo:
 *  - a interação, para o vendedor ver que a pessoa insistiu (é sinal de compra,
 *    não ruído);
 *  - `lastActivityAt`, que é o que tira o lead da lista de "esfriando";
 *  - o veículo, **só quando o lead ainda não tinha nenhum**. Sobrescrever
 *    apagaria o carro pelo qual o vendedor já estava negociando; quando o
 *    veículo é outro, isso fica registrado na interação.
 */
export async function registrarContatoRepetido(
  tx: ScopedClient,
  dados: ContatoRepetido,
): Promise<void> {
  const veiculoNovo = dados.vehicleId ?? null;
  const veiculoDiferente = !!veiculoNovo && !!dados.vehicleIdAtual && veiculoNovo !== dados.vehicleIdAtual;

  const partes = [
    'Mesmo contato registrado de novo',
    veiculoDiferente ? '(por outro veículo)' : null,
    dados.message ? `— “${dados.message}”` : null,
  ].filter(Boolean);

  await tx.leadInteraction.create({
    data: {
      leadId: dados.leadId,
      tenantId: dados.tenantId,
      actorUserId: dados.actorUserId ?? null,
      kind: 'duplicate',
      content: partes.join(' '),
      payload: {
        origem: dados.origem,
        source: dados.source,
        vehicleId: veiculoNovo,
        veiculoDiferente,
        message: dados.message ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  await tx.lead.update({
    where: { id: dados.leadId },
    data: {
      lastActivityAt: new Date(),
      ...(dados.vehicleIdAtual === null && veiculoNovo ? { vehicleId: veiculoNovo } : {}),
    },
  });
}
