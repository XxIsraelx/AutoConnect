/**
 * Consulta veicular — o contrato que o fornecedor tem de cumprir, não o
 * formato dele.
 *
 * Toda integração externa entra por aqui. O resto do sistema fala neste
 * vocabulário e nunca vê o payload do fornecedor; quando ele mudar o JSON, ou
 * quando trocarmos de fornecedor, muda o adaptador e mais nada.
 */

export const TIPOS_CONSULTA = [
  'ownership',
  'debts',
  'auction',
  'theft',
  'fines',
  'history',
] as const;

export type TipoConsulta = (typeof TIPOS_CONSULTA)[number];

export const CONSULTA_STATUSES = ['pending', 'success', 'failed'] as const;
export type ConsultaStatus = (typeof CONSULTA_STATUSES)[number];

export const ROTULO_CONSULTA: Record<TipoConsulta, string> = {
  ownership: 'Situação e proprietário',
  debts: 'Débitos e restrições',
  auction: 'Passagem por leilão',
  theft: 'Registro de roubo ou furto',
  fines: 'Multas',
  history: 'Histórico completo',
};

/**
 * Validade do cache por tipo.
 *
 * Não é um número só porque os dados não envelhecem no mesmo ritmo: passagem
 * por leilão é fato histórico e praticamente não muda; multa e débito mudam
 * toda semana. Consulta custa por chamada, então TTL curto demais é dinheiro
 * jogado fora e TTL longo demais é informação errada na tela.
 */
export const TTL_CONSULTA_HORAS: Record<TipoConsulta, number> = {
  ownership: 24 * 7,
  debts: 24,
  auction: 24 * 90,
  theft: 24,
  fines: 24,
  history: 24 * 30,
};

/** Resultado normalizado. `alerta` é o que a tela precisa destacar. */
export interface ResultadoConsulta {
  tipo: TipoConsulta;
  /** true quando a consulta encontrou algo que impede ou dificulta a venda. */
  alerta: boolean;
  /** Frase curta para a tela. */
  resumo: string;
  /** Itens detalhados, quando houver (débitos, multas, ocorrências). */
  itens?: { descricao: string; valor?: string; data?: string }[];
}

export interface EntradaConsulta {
  placa?: string;
  chassi?: string;
}

/**
 * O que um fornecedor precisa implementar.
 *
 * `custoCentavos` faz parte da interface de propósito: o custo é característica
 * do fornecedor, e quem chama precisa poder registrá-lo sem perguntar a ele.
 */
export interface FornecedorDeConsulta {
  readonly nome: string;
  readonly custoCentavos: number;
  readonly tiposSuportados: readonly TipoConsulta[];
  consultar(entrada: EntradaConsulta, tipo: TipoConsulta): Promise<{
    /** Exatamente o que veio do fornecedor, para auditoria e reprocessamento. */
    cru: unknown;
    resultado: ResultadoConsulta;
  }>;
}

const PLACA_ANTIGA = /^[A-Z]{3}\d{4}$/;
const PLACA_MERCOSUL = /^[A-Z]{3}\d[A-Z]\d{2}$/;

/** Normaliza para maiúsculas sem separador — `abc-1d23` vira `ABC1D23`. */
export function normalizarPlaca(placa: string): string {
  return placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function placaValida(placa: string): boolean {
  const p = normalizarPlaca(placa);
  return PLACA_ANTIGA.test(p) || PLACA_MERCOSUL.test(p);
}

/** Chassi: 17 caracteres, sem I, O e Q — que a norma exclui para não confundir
 *  com 1 e 0. */
export function chassiValido(chassi: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(chassi.toUpperCase());
}

/**
 * Chave de idempotência: `tenant:alvo:tipo:AAAA-MM-DD`.
 *
 * O dia entra na chave porque é o compromisso entre não pagar duas vezes pelo
 * mesmo clique e não impedir a loja de reconsultar amanhã. Sem ele, ou se paga
 * a cada duplo clique, ou a consulta fica presa para sempre.
 */
export function chaveIdempotencia(
  tenantId: string,
  alvo: EntradaConsulta,
  tipo: TipoConsulta,
  quando: Date,
): string {
  const alvoTexto = alvo.placa
    ? `placa:${normalizarPlaca(alvo.placa)}`
    : `chassi:${(alvo.chassi ?? '').toUpperCase()}`;
  const dia = quando.toISOString().slice(0, 10);

  return `${tenantId}:${alvoTexto}:${tipo}:${dia}`;
}

/** Quando a consulta deixa de valer. */
export function validadeDaConsulta(tipo: TipoConsulta, desde: Date): Date {
  return new Date(desde.getTime() + TTL_CONSULTA_HORAS[tipo] * 3_600_000);
}

/**
 * Selo de procedência para a página pública.
 *
 * Só entra o que é bom para o comprador saber e seguro para a loja afirmar:
 * ausência de alerta em consultas que a loja realmente fez. Nunca se afirma
 * "sem débitos" a partir de consulta que não aconteceu.
 */
export function seloDeProcedencia(
  consultas: { tipo: TipoConsulta; alerta: boolean; status: ConsultaStatus }[],
): { tipo: TipoConsulta; rotulo: string }[] {
  return consultas
    .filter((c) => c.status === 'success' && !c.alerta)
    .map((c) => ({ tipo: c.tipo, rotulo: ROTULO_CONSULTA[c.tipo] }));
}
