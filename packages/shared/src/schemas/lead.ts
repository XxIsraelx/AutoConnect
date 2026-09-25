import { z } from 'zod';
import { telefoneBrValido } from '../domain/telefone';
import { CODIGOS_DE_PERDA_DE_LEAD, exigeDetalhe } from '../domain/motivo-perda';

/**
 * Valores espelhados do enum `LeadSource` do Prisma.
 *
 * Não são importados de `@autoconnect/db` de propósito: aquele pacote é
 * `export * from '@prisma/client'`, e o `@autoconnect/shared` é dependência do
 * `apps/web` — importar o Prisma aqui o arrastaria para o bundle do navegador,
 * junto dos binários nativos do engine.
 *
 * A cópia é segura porque `lead.spec.ts` compara as duas listas contra o enum
 * real do Prisma e quebra o CI se divergirem. Foi assim que `trade_in` ficou
 * de fora e fez a rota pública de troca recusar o próprio lead que criava.
 */
export const LEAD_SOURCES = [
  'website',
  'app',
  'whatsapp',
  'phone',
  'walk_in',
  'referral',
  'social',
  'ad',
  'other',
  'trade_in',
] as const;

/**
 * Rótulo de cada origem, em um lugar só.
 *
 * Cada tela mantinha o seu mapa, e o de `/relatorios` não cobria `app`,
 * `walk_in`, `social`, `ad` nem `trade_in` — o gráfico de origem mostrava o
 * nome cru do enum para justamente as origens que a Onda 0 passou a gravar.
 */
export const ROTULO_DA_ORIGEM_DE_LEAD: Record<(typeof LEAD_SOURCES)[number], string> = {
  website: 'Site',
  app: 'Aplicativo',
  whatsapp: 'WhatsApp',
  phone: 'Telefone',
  walk_in: 'Balcão',
  referral: 'Indicação',
  social: 'Rede social',
  ad: 'Anúncio',
  other: 'Outro',
  trade_in: 'Troca',
};

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'negotiating',
  'won',
  'lost',
  'archived',
] as const;

export const createLeadSchema = z.object({
  // Para qual concessionária é o lead. Vinha do corpo cru, sem validação
  // nenhuma — sem checar sequer se era um uuid.
  tenantId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  customerUserId: z.string().uuid().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  source: z.enum(LEAD_SOURCES).default('website'),
  message: z.string().optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

/**
 * Alteração de um lead pelo painel: status e/ou veículo de interesse.
 *
 * Mover para `lost` exige motivo: a lista de perda é a única fonte que diz por
 * que a loja não vende, e "perdido" sem motivo é a linha que o relatório não
 * consegue usar. Quando o motivo é `outro`, o texto livre passa a ser
 * obrigatório — senão "outro" vira o depósito de tudo e a lista não informa
 * nada.
 *
 * `vehicleId` entrou em 25/09/2026. Até então a rota só movia status, e o lead
 * de balcão — que nasce sem veículo, porque quem chega no balcão ainda está
 * escolhendo — não tinha como ganhar um depois. Sem veículo não há botão de
 * negócio, então ele morria no card: "completar depois" era uma promessa que o
 * produto não cumpria. `null` desfaz o vínculo (o cliente mudou de carro), e
 * por isso é `nullable` e não apenas `optional`: ausente significa "não mexe",
 * e as duas coisas precisam ser distinguíveis.
 *
 * `status` virou opcional para que a tela possa só vincular o veículo, mas o
 * corpo vazio é recusado — um PATCH que não pede nada é bug do chamador, e
 * aceitá-lo em silêncio esconde o bug.
 */
export const updateLeadSchema = z
  .object({
    status: z.enum(LEAD_STATUSES).optional(),
    /** Obrigatório em `lost`; ignorado nos demais. */
    lostReasonCode: z.enum(CODIGOS_DE_PERDA_DE_LEAD).optional(),
    /** Complemento em texto livre. Obrigatório quando o código é `outro`. */
    lostReason: z.string().trim().max(500).optional(),
    /** Anotação opcional que entra na timeline junto da mudança. */
    reason: z.string().trim().max(500).optional(),
    /** Veículo de interesse. `null` remove o vínculo. */
    vehicleId: z.string().uuid().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === undefined && v.vehicleId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'Informe o novo status ou o veículo de interesse.',
      });
      return;
    }

    if (v.status !== 'lost') return;

    if (!v.lostReasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lostReasonCode'],
        message: 'Escolha o motivo da perda.',
      });
      return;
    }
    if (exigeDetalhe(v.lostReasonCode) && !(v.lostReason ?? '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lostReason'],
        message: 'Descreva o motivo em "Outro".',
      });
    }
  });
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

/* ── Filtros da lista ────────────────────────────────────── */

/**
 * Quem responde pelo lead, como filtro da lista.
 *
 * `sem_responsavel` é a fila — o que sobra quando ninguém estava de plantão no
 * momento em que o lead chegou. Sem esse filtro a fila seria invisível, e um
 * lead sem dono some no meio dos outros.
 */
export const FILTROS_DE_RESPONSAVEL = ['todos', 'meus', 'sem_responsavel'] as const;
export type FiltroDeResponsavel = (typeof FILTROS_DE_RESPONSAVEL)[number];

export const FILTROS_DE_SLA = ['todos', 'no_prazo', 'vencendo', 'estourado'] as const;
export type FiltroDeSla = (typeof FILTROS_DE_SLA)[number];

export const listLeadsSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  vehicleId: z.string().uuid().optional(),
  responsavel: z.enum(FILTROS_DE_RESPONSAVEL).default('todos'),
  sla: z.enum(FILTROS_DE_SLA).default('todos'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListLeadsInput = z.infer<typeof listLeadsSchema>;

export const exportLeadsSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  responsavel: z.enum(FILTROS_DE_RESPONSAVEL).default('todos'),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
export type ExportLeadsInput = z.infer<typeof exportLeadsSchema>;

export const slaStatsSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type SlaStatsInput = z.infer<typeof slaStatsSchema>;

/** Atribuição manual. `null` devolve o lead à fila. */
export const assignLeadSchema = z.object({
  salesPersonId: z.string().uuid().nullable(),
});
export type AssignLeadInput = z.infer<typeof assignLeadSchema>;

/* ── Interações da timeline ──────────────────────────────── */

/**
 * Tipos de interação registrados na timeline do lead.
 *
 * `LeadInteraction.kind` é `String` no Prisma, **não** um enum — por isso não
 * há caso em `paridade-enums.spec.ts` para comparar. A lista fechada vive aqui
 * e é o schema Zod da rota que a faz valer: antes o corpo era
 * `{ kind: string }` anotado e qualquer palavra entrava na timeline, o que faz
 * o rótulo da tela cair no fallback e o filtro por tipo nunca casar.
 *
 * `whatsapp` e `call` existiam só como rótulo no front, sem nada que os
 * gravasse. São o que o clique no `wa.me` e no `tel:` passou a registrar.
 */
export const LEAD_INTERACTION_KINDS = [
  'created',
  'status_change',
  'assignment',
  'note',
  'call',
  'email',
  'whatsapp',
  'chat',
  'visit',
  'duplicate',
  'trade_in_appraisal',
  /** Escrita pelo rodízio e pela devolução automática à fila. */
  'rotation',
  /** Escrita quando o prazo de primeiro contato estoura. */
  'sla_breach',
  'other',
] as const;
export type LeadInteractionKind = (typeof LEAD_INTERACTION_KINDS)[number];

/** Os tipos que uma tela pode gravar à mão. Os demais são escritos pelo serviço. */
export const LEAD_INTERACTION_KINDS_MANUAIS = [
  'note',
  'call',
  'email',
  'whatsapp',
  'visit',
  'other',
] as const;

export const createLeadInteractionSchema = z.object({
  kind: z.enum(LEAD_INTERACTION_KINDS_MANUAIS),
  content: z.string().trim().max(2000).optional(),
});
export type CreateLeadInteractionInput = z.infer<typeof createLeadInteractionSchema>;

/* ── Lead anônimo (formulário público) ───────────────────── */

const telefoneBr = z
  .string()
  .trim()
  .min(8, 'Informe seu telefone')
  .max(30)
  .refine(telefoneBrValido, 'Telefone inválido. Use DDD + número, ex.: (11) 98765-4321');

/**
 * Formulário público de interesse — sem conta, sem token.
 *
 * O `tenantId` é opcional de propósito: quando há `vehicleId`, quem manda é a
 * loja **dona do veículo**, lida do banco. Um `tenantId` no corpo que não bata
 * com o do veículo é recusado, e nunca é usado sozinho para escolher a loja
 * quando o veículo está presente.
 */
export const leadPublicoSchema = z.object({
  tenantId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  contactName: z.string().trim().min(2, 'Informe seu nome').max(120),
  contactPhone: telefoneBr,
  contactEmail: z.string().trim().email('E-mail inválido').max(160).optional().or(z.literal('')),
  message: z.string().trim().max(2000).optional(),

  /**
   * Consentimento LGPD. `literal(true)` e não `boolean()`: um `false` tem que
   * ser recusado com erro de campo, não aceito como "não marcou".
   */
  consentimento: z.literal(true, {
    errorMap: () => ({ message: 'É preciso aceitar o uso dos seus dados para a loja entrar em contato.' }),
  }),
  /**
   * O texto exibido no momento do aceite, versionado pela própria cópia: o
   * termo muda com o tempo e a prova de consentimento tem que ser do termo que
   * a pessoa leu, não do termo de hoje.
   */
  consentText: z.string().trim().min(20, 'Texto de consentimento ausente').max(2000),

  /**
   * Armadilha para robô: campo invisível no formulário. Gente não preenche.
   * Não é validação — o preenchimento faz a requisição ser descartada em
   * silêncio, com a mesma resposta de sucesso, para não ensinar o robô.
   */
  website: z.string().max(200).optional(),
})
  .refine((v) => !!v.vehicleId || !!v.tenantId, {
    message: 'Informe o veículo ou a concessionária',
    path: ['vehicleId'],
  });
export type LeadPublicoInput = z.infer<typeof leadPublicoSchema>;

/* ── Lead manual (vendedor cadastrando quem ligou) ───────── */

/**
 * Origens que um vendedor pode escolher ao cadastrar à mão.
 *
 * `website`, `app` e `trade_in` ficam de fora: são registradas pelo próprio
 * sistema, e deixá-las na lista faria o relatório de origem mentir — um lead
 * de balcão marcado como "site" some do custo de aquisição.
 */
export const LEAD_SOURCES_MANUAIS = [
  'phone',
  'whatsapp',
  'walk_in',
  'referral',
  'social',
  'ad',
  'other',
] as const;

export const leadManualSchema = z.object({
  contactName: z.string().trim().min(2, 'Informe o nome').max(120),
  contactPhone: telefoneBr,
  contactEmail: z.string().trim().email('E-mail inválido').max(160).optional().or(z.literal('')),
  source: z.enum(LEAD_SOURCES_MANUAIS),
  vehicleId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  /** Padrão no serviço: quem está cadastrando. */
  assignedTo: z.string().uuid().optional(),
  message: z.string().trim().max(2000).optional(),
});
export type LeadManualInput = z.infer<typeof leadManualSchema>;
