import { z } from 'zod';

/**
 * Papéis que uma concessionária pode convidar. É um subconjunto deliberado de
 * `UserRole`: não se convida um `super_admin` nem um `customer` por aqui.
 */
export const INVITABLE_ROLES = ['tenant_admin', 'manager', 'salesperson'] as const;

// ─── Validadores ──────────────────────────────────────────────────────────────

/**
 * Dígitos verificadores do CNPJ.
 *
 * Exportado desde que o cadastro deixou de exigir convite: com a porta pública,
 * **esta** é a regra dura do CNPJ, e a consulta à Receita (BrasilAPI) virou
 * enriquecimento. A tela precisa da mesma conta que a API para poder recusar
 * antes de enviar — e para não recusar quando quem falhou foi a BrasilAPI.
 */
export function cnpjValido(cnpj: string): boolean {
  const c = cnpj.replace(/\D/g, '');
  if (c.length !== 14) return false;
  if (/^(\d)\1+$/.test(c)) return false; // todos dígitos iguais
  const calc = (digits: string, n: number): number => {
    let s = 0, p = n - 7;
    for (let i = 0; i < n; i++) { s += +digits[i] * p--; if (p < 2) p = 9; }
    return s % 11 < 2 ? 0 : 11 - (s % 11);
  };
  return calc(c, 12) === +c[12] && calc(c, 13) === +c[13];
}

/** Dígitos verificadores do CPF. Exportado para o contrato reaproveitar. */
export function cpfValido(cpf: string): boolean {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  const calc = (digits: string, n: number): number => {
    let s = 0;
    for (let i = 0; i < n; i++) s += +digits[i] * (n + 1 - i);
    const r = (s * 10) % 11;
    return r >= 10 ? 0 : r;
  };
  return calc(c, 9) === +c[9] && calc(c, 10) === +c[10];
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Duração do período de teste de uma loja nova, em dias.
 *
 * 14 porque é o que a home anuncia em três lugares ("Sem cartão de crédito ·
 * 14 dias grátis") e o que o plano Trial promete — a decisão de abrir o
 * cadastro em autosserviço nasceu justamente de o produto não cumprir o que o
 * site vende, e um trial de outra duração recriaria a mesma contradição.
 *
 * É uma constante só, consumida pela API (que grava `trialEndsAt`) e pelas
 * telas que citam o prazo. Antes o trial nascia com `trial_ends_at` **nulo**:
 * o "14 dias" existia no HTML e em lugar nenhum no banco.
 */
export const DURACAO_DO_TRIAL_DIAS = 14;

/**
 * Cadastro de concessionária.
 *
 * ## Sem convite, de propósito
 *
 * `inviteToken` é **opcional** desde 25/09/2026. A home prometia "Criar conta
 * grátis" em cinco botões e todos caíam numa tela que exigia convite — e num
 * banco recém-migrado não havia como criar o primeiro super admin, logo não
 * havia como emitir o primeiro convite, logo não havia como existir a primeira
 * loja. O token continua aceito (convite de super admin ainda funciona e ainda
 * é consumido), mas não é mais a porta.
 *
 * ## O que é pedido, e o que deixou de ser
 *
 * Cinco campos obrigatórios: CNPJ, nome da loja, nome do responsável, e-mail e
 * senha. O resto vem depois, dentro do produto, no momento em que importa:
 *
 * | Deixou de ser pedido | Onde é pedido agora |
 * |---|---|
 * | Razão social | Autopreenchida pela Receita; confirmada em `/configuracoes`, na mesma tela que o contrato já exige antes de emitir |
 * | Slug da URL pública | Derivado do nome da loja, com sufixo quando colide |
 * | E-mail da concessionária | Nasce igual ao e-mail de acesso; editável em `/configuracoes` |
 * | Inscrição estadual | `/configuracoes` |
 * | CPF e cargo do responsável | `/perfil`; o CPF que o **contrato** usa é o do representante legal, que já mora em `/configuracoes` |
 * | Endereço completo da filial | `/configuracoes`, com item próprio no checklist de primeiros passos |
 *
 * Os campos continuam **aceitos** (o convite e os testes antigos mandam o corpo
 * inteiro) — só deixaram de ser exigidos.
 */
export const signupTenantSchema = z.object({
  /**
   * Convite de super admin. Opcional: quando vem, é validado e consumido, e a
   * conta nasce com o e-mail já verificado (o convite provou o endereço).
   */
  inviteToken: z.string().min(1).optional(),

  tenant: z.object({
    /** CNPJ: aceita formatado (XX.XXX.XXX/XXXX-XX) ou só dígitos */
    cnpj: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .pipe(z.string().length(14, 'CNPJ deve ter 14 dígitos').refine(cnpjValido, 'CNPJ inválido')),
    stateRegistration: z.string().max(30).optional(), // Inscrição Estadual
    legalName:    z.string().min(2).max(200).optional(),
    tradeName:    z.string().min(2, 'Informe o nome da loja').max(200),
    slug:         z.string().min(3).max(50).regex(/^[a-z0-9-]+$/, 'apenas minúsculas, números e hífen').optional(),
    primaryEmail: z.string().email().optional(),
    primaryPhone: z.string().optional(),
  }).strict(),

  admin: z.object({
    fullName: z.string().min(2, 'Informe seu nome').max(200),
    email:    z.string().email(),
    password: z.string().min(8).max(128),
    cpf: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .pipe(z.string().length(11, 'CPF deve ter 11 dígitos').refine(cpfValido, 'CPF inválido'))
      .optional(),
    jobTitle: z.string().min(2).max(100).optional(),
    phone:    z.string().min(10).max(20).optional(),
  }).strict(),

  /**
   * Filial matriz. Toda opcional: a loja existe e funciona sem endereço, e o
   * checklist de primeiros passos cobra o endereço quando ele passa a importar
   * (vitrine, mapa e agenda pública).
   */
  branch: z.object({
    phone:         z.string().min(10).max(20).optional(),
    postalCode:    z.string().min(8).max(9).optional(),
    addressLine:   z.string().min(3).max(200).optional(),
    addressNumber: z.string().min(1).max(20).optional(),
    complement:    z.string().max(100).optional(),
    neighborhood:  z.string().min(2).max(100).optional(),
    city:          z.string().min(2).max(100).optional(),
    state:         z.string().length(2).optional(),
  }).strict().optional(),
}).strict();
export type SignupTenantInput = z.infer<typeof signupTenantSchema>;

/**
 * URL pública derivada do nome da loja.
 *
 * "Slug" não é palavra de revendedor, e o campo era obrigatório num formulário
 * em que a pessoa ainda não viu nenhuma tela. Agora ele é derivado; a API
 * resolve colisão acrescentando sufixo, e o valor final aparece em
 * `/configuracoes`.
 *
 * Devolve `''` quando o nome não tem nenhum caractere aproveitável (uma loja
 * chamada só com emoji, por exemplo) — quem chama decide o que fazer.
 */
export function slugDeLoja(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
}

/** Corpo de `POST /auth/resend-verification`. */
export const reenviarVerificacaoSchema = z.object({
  email: z.string().email('E-mail inválido'),
}).strict();
export type ReenviarVerificacaoInput = z.infer<typeof reenviarVerificacaoSchema>;

export const signupCustomerSchema = z.object({
  fullName:      z.string().min(2).max(200),
  email:         z.string().email(),
  password:      z.string().min(8).max(128),
  phone:         z.string().min(10).max(20).optional(),
  cpf:           z.string().regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{11}$/, 'CPF inválido').optional(),
  birthDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD)').optional(),
  postalCode:    z.string().min(8).max(9).optional(),
  addressLine:   z.string().max(200).optional(),
  addressNumber: z.string().max(20).optional(),
  complement:    z.string().max(100).optional(),
  neighborhood:  z.string().max(100).optional(),
  city:          z.string().max(100).optional(),
  state:         z.string().length(2).toUpperCase().optional(),
});
export type SignupCustomerInput = z.infer<typeof signupCustomerSchema>;

export const inviteUserSchema = z.object({
  email: z.string().email(),
  role:  z.enum(INVITABLE_ROLES),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
