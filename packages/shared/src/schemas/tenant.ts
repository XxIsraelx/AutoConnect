import { z } from 'zod';
import { cpfValido } from './auth';
import { telefoneBrValido } from '../domain/telefone';

/**
 * ## Por que estes schemas são `.strict()`
 *
 * O piloto do primeiro dia encontrou uma classe de defeito que o Zod **criou**
 * ao resolver outra: o corpo passa pelo schema, o schema descarta em silêncio o
 * que não conhece, o Prisma nunca vê o campo — e a tela mostra "salvo!".
 *
 * Aconteceu com três campos ao mesmo tempo: `businessHours` (o horário de
 * funcionamento, que alimenta o relógio do SLA), `primaryPhone` e
 * `acceptsTradeIn` (a chave que liga a troca inteira). Nenhum erro, nenhum log,
 * nenhuma pista — o dono não tinha como distinguir "salvou" de "fingiu".
 *
 * `.strict()` transforma o silêncio em 400 com o nome do campo. Continua
 * valendo o que `mass-assignment.e2e-spec.ts` fixa — `isActive` e `slug` não
 * chegam ao banco —, só que agora a recusa é dita em voz alta em vez de
 * escondida. É seguro aqui porque as duas rotas têm **um** cliente cada
 * (`/configuracoes` do `apps/web`), e `corpos-do-web.spec.ts` confere que os
 * corpos que ele envia continuam sendo aceitos.
 */

/* ── Horário de funcionamento ─────────────────────────────── */

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export const expedienteDoDiaSchema = z
  .object({
    closed: z.boolean(),
    open: z.string().regex(HORA, 'Use HH:MM, de 00:00 a 23:59.'),
    close: z.string().regex(HORA, 'Use HH:MM, de 00:00 a 23:59.'),
  })
  .strict()
  .refine(
    (d) => d.closed || d.close > d.open,
    // Comparação de strings basta porque as duas casam `HH:MM` com dois
    // dígitos. Um dia com fechamento antes da abertura é silenciosamente
    // ignorado pelo cálculo do SLA (`domain/sla.ts`), o que significa uma loja
    // que parece configurada e cujo relógio não anda naquele dia.
    { message: 'O fechamento tem que ser depois da abertura.', path: ['close'] },
  );

/**
 * `{ "0": {…}, … "6": {…} }`, com 0 = domingo. Mesma forma que
 * `Expediente` em `domain/sla.ts` — é o valor que vai para
 * `DealershipBranch.businessHours` e de onde o prazo de primeiro contato sai.
 */
export const expedienteSchema = z.record(
  z.string().regex(/^[0-6]$/, 'Dia da semana inválido: use 0 (domingo) a 6.'),
  expedienteDoDiaSchema,
);
export type ExpedienteInput = z.infer<typeof expedienteSchema>;

export const updateTenantSchema = z.object({
  tradeName: z.string().min(2).max(200).optional(),
  /**
   * Telefone da loja — o que aparece na vitrine e no catálogo público.
   *
   * Faltava aqui: a tela mandava, o Zod descartava, e o dono via o campo voltar
   * vazio depois do toast verde.
   */
  primaryPhone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v === '' || telefoneBrValido(v), 'Telefone inválido. Use DDD + número.')
    .optional(),
  /**
   * Liga o botão "Tenho um carro na troca" nas páginas públicas. Também
   * faltava: com a chave travada em `false`, a troca inteira — tabela, rota,
   * origem no relatório e avaliação no drawer do lead — ficava inalcançável em
   * qualquer loja nova.
   */
  acceptsTradeIn: z.boolean().optional(),
  logoUrl: z.string().url().optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  websiteUrl: z.string().url().optional(),
  timezone: z.string().optional(),

  /**
   * Representante legal que assina os contratos pela loja. Opcional aqui —
   * quem exige é a emissão do contrato, que recusa sem ele.
   */
  legalRepName: z.string().min(3).max(160).optional(),
  legalRepCpf: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || cpfValido(v), 'CPF inválido — confira os dígitos.')
    .optional(),
  legalRepRole: z.string().max(60).optional(),
  /** Para onde vai o convite da assinatura eletrônica em nome da loja. */
  legalRepEmail: z.string().email('E-mail inválido.').max(160).optional(),
}).strict();
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const createBranchSchema = z.object({
  name: z.string().min(2).max(200),
  isHeadquarters: z.boolean().default(false),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  addressLine: z.string().optional(),
  addressNumber: z.string().optional(),
  complement: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().default('BR'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  /**
   * Expediente da filial. Faltava aqui, e era o pior dos três: `/configuracoes`
   * enviava o objeto inteiro, `createBranchSchema` não o tinha, o Zod
   * descartava e `business_hours` seguia `{}` no banco. Três consequências, e
   * nenhuma visível — o item do onboarding nunca ficava verde, o horário nunca
   * aparecia para o cliente na busca, e **o relógio do SLA rodava no expediente
   * padrão do shared** em vez do da loja, gerando alarme de prazo fora de hora.
   */
  businessHours: expedienteSchema.optional(),
}).strict();
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

/**
 * Atualização de filial: os mesmos campos da criação, todos opcionais.
 *
 * Existe para que o corpo passe pelo Zod em vez de ir cru para o Prisma —
 * `isHeadquarters` e `isActive` não estão aqui de propósito, porque trocar a
 * matriz ou desativar filial merece rota própria, não um PATCH genérico.
 *
 * `.omit()` e `.partial()` preservam o `.strict()` da base; `tenant.spec.ts`
 * fixa isso, porque é uma garantia do Zod e não do nosso código.
 */
export const updateBranchSchema = createBranchSchema
  .omit({ isHeadquarters: true })
  .partial();

export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

/**
 * Planos de assinatura. Repete o enum `SubscriptionPlan` do Prisma —
 * `paridade-enums.spec.ts` quebra se divergirem. O painel do super admin usa a
 * lista para os botões de plano e a API para recusar plano inexistente (antes
 * o valor ia cru para o Prisma e voltava como 500).
 */
export const SUBSCRIPTION_PLANS = ['trial', 'starter', 'pro', 'enterprise'] as const;
export type SubscriptionPlanValue = (typeof SUBSCRIPTION_PLANS)[number];
