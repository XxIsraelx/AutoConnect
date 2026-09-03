import { z } from 'zod';
import { cpfValido } from './auth';
import {
  DEAL_STATUSES,
  PAYMENT_KINDS,
  PAYMENT_STATUSES,
  ACQUISITION_ORIGINS,
  VEHICLE_COST_KINDS,
} from '../domain/deal';

/**
 * Dinheiro entra como **string**, nunca como número.
 *
 * `z.number()` aceitaria `1234.565` e o valor já chegaria arredondado pelo
 * parser de JSON antes de qualquer validação nossa. Exigir string com no
 * máximo duas casas move a recusa para a borda, que é onde ela é barata.
 */
export const valorMonetario = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use um valor como "12345.67", sem separador de milhar');


/**
 * Data de fato consumado não pode estar no futuro.
 *
 * Sem isto dá para registrar que o carro entrou no estoque daqui a três dias —
 * e o sistema passa a exibir "0 dias em estoque" para um veículo que ainda nem
 * foi comprado. O `Math.max(0, …)` do cálculo de dias escondia o absurdo em
 * vez de acusá-lo.
 *
 * A tolerância de 24h existe porque o navegador manda a data escolhida no
 * fuso local, que pode estar até 14h à frente do relógio do servidor. Ela
 * absorve o fuso sem deixar passar "semana que vem".
 */
const TOLERANCIA_FUSO_MS = 24 * 60 * 60 * 1000;

export const dataPassada = (rotulo: string) =>
  z.coerce.date().refine((d) => d.getTime() <= Date.now() + TOLERANCIA_FUSO_MS, {
    message: `${rotulo} não pode estar no futuro.`,
  });

export const createDealSchema = z.object({
  vehicleId: z.string().uuid(),
  leadId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  customerUserId: z.string().uuid().optional(),
  salespersonId: z.string().uuid().optional(),
  listPrice: valorMonetario,
  discount: valorMonetario.default('0'),
  saleValue: valorMonetario,
});

export const updateDealSchema = z
  .object({
    listPrice: valorMonetario,
    discount: valorMonetario,
    saleValue: valorMonetario,
    branchId: z.string().uuid().nullable(),
    salespersonId: z.string().uuid().nullable(),
    customerUserId: z.string().uuid().nullable(),
  })
  .partial();

export const transitionDealSchema = z.object({
  to: z.enum(DEAL_STATUSES),
  reason: z.string().max(500).optional(),
});

export const createDealPaymentSchema = z.object({
  kind: z.enum(PAYMENT_KINDS),
  status: z.enum(PAYMENT_STATUSES).default('pending'),
  value: valorMonetario,
  institution: z.string().max(120).optional(),
  installments: z.number().int().min(1).max(120).optional(),
  installmentValue: valorMonetario.optional(),
  notes: z.string().max(500).optional(),
});

export const listDealsSchema = z.object({
  status: z.enum(DEAL_STATUSES).optional(),
  /** Filtra os negócios de um veículo — a tela dele precisa saber se há um. */
  vehicleId: z.string().uuid().optional(),
  salespersonId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export const createAcquisitionSchema = z.object({
  origin: z.enum(ACQUISITION_ORIGINS),
  supplierName: z.string().max(160).optional(),
  supplierDocument: z.string().max(20).optional(),
  purchaseValue: valorMonetario,
  enteredAt: dataPassada('A data de entrada no estoque'),
  notes: z.string().max(500).optional(),
});

export const createVehicleCostSchema = z.object({
  kind: z.enum(VEHICLE_COST_KINDS),
  value: valorMonetario,
  description: z.string().max(300).optional(),
  supplierName: z.string().max(160).optional(),
  incurredAt: dataPassada('A data do custo'),
});

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type TransitionDealInput = z.infer<typeof transitionDealSchema>;
export type CreateDealPaymentInput = z.infer<typeof createDealPaymentSchema>;
export type ListDealsInput = z.infer<typeof listDealsSchema>;
export type CreateAcquisitionInput = z.infer<typeof createAcquisitionSchema>;
export type CreateVehicleCostInput = z.infer<typeof createVehicleCostSchema>;

/**
 * Identificação do comprador para o contrato.
 *
 * CPF é obrigatório e validado pelos dígitos verificadores. Um contrato de
 * compra e venda que diz "portador(a) do documento ____" não identifica a
 * parte — é pior que não emitir, porque parece um documento e não serve como
 * um. Os demais campos são opcionais porque a praxe varia entre lojas, mas o
 * endereço entra na qualificação sempre que existir.
 */
export const dadosDoCompradorSchema = z.object({
  fullName: z.string().min(3).max(160),
  cpf: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine(cpfValido, 'CPF inválido — confira os dígitos.'),
  rg: z.string().max(20).optional(),
  rgIssuer: z.string().max(20).optional(),
  nationality: z.string().max(40).optional(),
  maritalStatus: z.string().max(40).optional(),
  occupation: z.string().max(60).optional(),
  addressLine: z.string().max(160).optional(),
  addressNumber: z.string().max(20).optional(),
  neighborhood: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  state: z.string().length(2).optional(),
  postalCode: z.string().max(9).optional(),
});

export type DadosDoCompradorInput = z.infer<typeof dadosDoCompradorSchema>;

/** CPF formatado para o contrato: `123.456.789-00`. */
export function formatarCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '');
  return d.length === 11
    ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
    : cpf;
}

/**
 * Qualificação da parte, na ordem em que aparece no contrato.
 * Campos ausentes somem em vez de virar vírgula solta.
 */
export function qualificarComprador(c: {
  fullName: string; cpf: string; rg?: string | null; rgIssuer?: string | null;
  nationality?: string | null; maritalStatus?: string | null; occupation?: string | null;
  addressLine?: string | null; addressNumber?: string | null; neighborhood?: string | null;
  city?: string | null; state?: string | null; postalCode?: string | null;
}): string {
  const endereco = [
    [c.addressLine, c.addressNumber].filter(Boolean).join(', '),
    c.neighborhood,
    [c.city, c.state].filter(Boolean).join('/'),
    c.postalCode ? `CEP ${c.postalCode}` : null,
  ].filter(Boolean).join(' — ');

  return [
    c.fullName,
    c.nationality,
    c.maritalStatus,
    c.occupation,
    `inscrito(a) no CPF sob o nº ${formatarCpf(c.cpf)}`,
    c.rg ? `portador(a) do RG nº ${c.rg}${c.rgIssuer ? ` ${c.rgIssuer}` : ''}` : null,
    endereco ? `residente e domiciliado(a) em ${endereco}` : null,
  ].filter(Boolean).join(', ');
}

/**
 * Qualificação da vendedora no contrato.
 *
 * A pessoa jurídica é identificada por razão social e CNPJ; o representante
 * legal é quem de fato assina. Um contrato em que ninguém é nomeado como
 * signatário pela loja tem o mesmo defeito de um sem CPF do comprador: parece
 * documento e não diz quem se obrigou.
 */
export function qualificarVendedor(v: {
  legalName: string; tradeName: string; taxId?: string | null;
  stateRegistration?: string | null; endereco?: string | null;
  legalRepName?: string | null; legalRepCpf?: string | null; legalRepRole?: string | null;
}): string {
  const empresa = [
    v.legalName,
    v.tradeName && v.tradeName !== v.legalName ? `nome fantasia ${v.tradeName}` : null,
    v.taxId ? `inscrita no CNPJ sob o nº ${formatarCnpj(v.taxId)}` : null,
    v.stateRegistration ? `Inscrição Estadual nº ${v.stateRegistration}` : null,
    v.endereco ? `com sede em ${v.endereco}` : null,
  ].filter(Boolean).join(', ');

  if (!v.legalRepName) return empresa;

  const rep = [
    v.legalRepName,
    v.legalRepRole,
    v.legalRepCpf ? `inscrito(a) no CPF sob o nº ${formatarCpf(v.legalRepCpf)}` : null,
  ].filter(Boolean).join(', ');

  return `${empresa}, neste ato representada por ${rep}`;
}

/** CNPJ formatado: `00.000.000/0001-91`. */
export function formatarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  return d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : cnpj;
}

/** Campos do representante legal, editáveis nas configurações da loja. */
export const representanteLegalSchema = z.object({
  legalRepName: z.string().min(3).max(160),
  legalRepCpf: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine(cpfValido, 'CPF inválido — confira os dígitos.'),
  legalRepRole: z.string().max(60).optional(),
});

export type RepresentanteLegalInput = z.infer<typeof representanteLegalSchema>;
