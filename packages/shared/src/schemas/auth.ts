import { z } from 'zod';

/**
 * Papéis que uma concessionária pode convidar. É um subconjunto deliberado de
 * `UserRole`: não se convida um `super_admin` nem um `customer` por aqui.
 */
export const INVITABLE_ROLES = ['tenant_admin', 'manager', 'salesperson'] as const;

// ─── Validadores ──────────────────────────────────────────────────────────────

function validCNPJ(cnpj: string): boolean {
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

function validCPF(cpf: string): boolean {
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

export const signupTenantSchema = z.object({
  /** Token de convite gerado pelo super_admin */
  inviteToken: z.string().min(1, 'Token de convite é obrigatório'),

  tenant: z.object({
    /** CNPJ: aceita formatado (XX.XXX.XXX/XXXX-XX) ou só dígitos */
    cnpj: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .pipe(z.string().length(14, 'CNPJ deve ter 14 dígitos').refine(validCNPJ, 'CNPJ inválido')),
    stateRegistration: z.string().max(30).optional(), // Inscrição Estadual
    legalName:    z.string().min(2).max(200),
    tradeName:    z.string().min(2).max(200),
    slug:         z.string().min(3).max(50).regex(/^[a-z0-9-]+$/, 'apenas minúsculas, números e hífen'),
    primaryEmail: z.string().email(),
    primaryPhone: z.string().optional(),
  }),

  admin: z.object({
    fullName: z.string().min(2).max(200),
    email:    z.string().email(),
    password: z.string().min(8).max(128),
    cpf: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .pipe(z.string().length(11, 'CPF deve ter 11 dígitos').refine(validCPF, 'CPF inválido')),
    jobTitle: z.string().min(2).max(100),
    phone:    z.string().min(10).max(20),
  }),

  branch: z.object({
    phone:         z.string().min(10).max(20),
    postalCode:    z.string().min(8).max(9),
    addressLine:   z.string().min(3).max(200),
    addressNumber: z.string().min(1).max(20),
    complement:    z.string().max(100).optional(),
    neighborhood:  z.string().min(2).max(100),
    city:          z.string().min(2).max(100),
    state:         z.string().length(2),
  }),
});
export type SignupTenantInput = z.infer<typeof signupTenantSchema>;

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
