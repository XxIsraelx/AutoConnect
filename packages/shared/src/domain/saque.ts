/**
 * Validação de saque — a decisão, sem o formato do gateway.
 *
 * A Asaas passou a **exigir**, para liberar a chave de API de produção, que a
 * conta ative a "validação de saque via webhook": a cada transferência, boleto
 * pago, Pix ou recarga solicitados na conta, ela chama uma URL nossa
 * perguntando se pode. Quem responde é a nossa aplicação, e a resposta é a
 * última palavra — a operação é cancelada se ela não disser `APPROVED`.
 *
 * Isto é o freio de mão do dinheiro do dono da plataforma: se a chave de API
 * vazar, quem a roubou solicita um saque e é **este** código que diz não.
 * Por isso a regra é a mais chata possível:
 *
 *  1. **Recusa por padrão.** Sem autorização prévia casando, é `REFUSED`.
 *  2. A autorização é criada **antes**, à mão, pelo super admin, com tipo,
 *     valor e prazo curto.
 *  3. **Uso único.** Casou, consumiu — o segundo pedido idêntico não acha mais
 *     nada e é recusado.
 *
 * O formato da Asaas (nomes dos campos do payload, cabeçalho do token e o
 * corpo `{"status":"APPROVED"}`) mora no adaptador, em
 * `apps/api/src/modules/saques/`. Aqui fica só o que decide.
 *
 * `Uint8Array`/`bigint` e nenhum import do Prisma: este pacote também vai para
 * o navegador.
 */

/* ── Tipos de operação ────────────────────────────────────────── */

/**
 * As operações de saída de dinheiro que a Asaas submete à validação.
 * Documentação: https://docs.asaas.com/docs/mecanismo-para-validacao-de-saque-via-webhooks
 *
 * A lista é fechada de propósito: um `type` que não esteja aqui é recusado,
 * porque aprovar o que não se sabe interpretar é o oposto do que este
 * mecanismo existe para fazer.
 */
export const TIPOS_DE_SAQUE = [
  'TRANSFER',
  'BILL',
  'PIX_QR_CODE',
  'MOBILE_PHONE_RECHARGE',
  'PIX_REFUND',
] as const;

export type TipoDeSaque = (typeof TIPOS_DE_SAQUE)[number];

export function ehTipoDeSaque(valor: string): valor is TipoDeSaque {
  return (TIPOS_DE_SAQUE as readonly string[]).includes(valor);
}

export const ROTULO_TIPO_DE_SAQUE: Record<TipoDeSaque, string> = {
  TRANSFER: 'Transferência bancária',
  BILL: 'Pagamento de conta',
  PIX_QR_CODE: 'Pagamento de QR Code Pix',
  MOBILE_PHONE_RECHARGE: 'Recarga de celular',
  PIX_REFUND: 'Estorno de Pix',
};

/* ── A autorização prévia ─────────────────────────────────────── */

/**
 * Como o valor autorizado é comparado com o pedido.
 *
 * - `exato`: o pedido tem de valer exatamente o autorizado. É o padrão, e é o
 *   que se usa para um saque já conhecido ("vou transferir R$ 4.000,00 agora").
 * - `teto`: o pedido vale até o autorizado. Serve para quando o valor final só
 *   se sabe na hora (tarifa, arredondamento da conta a pagar).
 */
export const MODOS_DE_VALOR = ['exato', 'teto'] as const;
export type ModoDeValor = (typeof MODOS_DE_VALOR)[number];

export const ROTULO_MODO_DE_VALOR: Record<ModoDeValor, string> = {
  exato: 'Valor exato',
  teto: 'Até o valor',
};

/**
 * Validade padrão de uma autorização, em minutos.
 *
 * Curta de propósito: a autorização é criada **enquanto** se vai ao painel da
 * Asaas fazer o saque, e a Asaas chama o webhook ~5 s depois do pedido. Uma
 * autorização que sobrevive ao dia vira uma chave debaixo do tapete.
 */
export const VALIDADE_PADRAO_DA_AUTORIZACAO_MIN = 30;

/** Teto da validade que o painel aceita — 24 h, e ainda é muito. */
export const VALIDADE_MAXIMA_DA_AUTORIZACAO_MIN = 1440;

/** A autorização como a decisão a enxerga (só o que é critério). */
export interface AutorizacaoDeSaque {
  id: string;
  tipo: TipoDeSaque;
  modo: ModoDeValor;
  /** Em centavos: dinheiro nunca é `number` de ponto flutuante. */
  valorCentavos: bigint;
  expiraEm: Date;
  /** Preenchido quando já foi consumida — uso único. */
  usadaEm: Date | null;
  /** Preenchido quando o super admin a revogou antes do prazo. */
  revogadaEm: Date | null;
}

/** O pedido da Asaas, já traduzido para o vocabulário daqui. */
export interface PedidoDeSaque {
  tipo: TipoDeSaque;
  /** Id da operação no gateway — é a chave de idempotência da decisão. */
  idOperacao: string;
  valorCentavos: bigint;
}

/* ── Os motivos ───────────────────────────────────────────────── */

/**
 * O texto da recusa vai para a Asaas em `refuseReason` e aparece no painel e
 * no e-mail de erro dela. Precisa dizer o que fazer sem contar nada a quem
 * não deveria estar ali: nenhum motivo cita token, chave, id interno ou
 * quantas autorizações existem.
 */
export const MOTIVO = {
  semToken:
    'Validação de saque sem token configurado nesta instalação: toda operação é recusada.',
  tokenInvalido: 'Origem não autenticada.',
  corpoInvalido: 'Pedido de validação em formato não reconhecido.',
  tipoDesconhecido: 'Tipo de operação não previsto pela política desta conta.',
  valorInvalido: 'Valor da operação ausente ou inválido.',
  semAutorizacao:
    'Nenhuma autorização prévia válida para esta operação. ' +
    'Crie a autorização no painel AutoConnect antes de solicitar o saque.',
  jaConsumida:
    'A autorização para esta operação já havia sido consumida por outro pedido.',
  erroInterno:
    'Não foi possível validar esta operação agora. Nenhum saque é aprovado sem validação.',
} as const;

/* ── A decisão ────────────────────────────────────────────────── */

export interface VeredictoDeSaque {
  aprovado: boolean;
  /** `null` quando aprovado; o texto da recusa quando não. */
  motivo: string | null;
  /** A autorização que casou — é ela que o serviço consome. */
  autorizacaoId: string | null;
}

/**
 * Casa o pedido com as autorizações prévias. **Pura**: nada aqui escreve, e o
 * consumo (uso único) é do serviço, que o faz de forma atômica no banco.
 *
 * Só casa autorização que esteja, ao mesmo tempo: do mesmo tipo, dentro do
 * valor, não usada, não revogada e não expirada. Qualquer coisa fora disso
 * cai no `REFUSED` — não existe caminho que aprove por omissão.
 *
 * **Escolha entre várias que casam: a mais apertada primeiro.** Entre uma
 * autorização de "até R$ 10.000" e uma de "exatamente R$ 500" servindo a um
 * pedido de R$ 500, consome a de R$ 500: gastar a mais larga deixaria a
 * sobra folgada em pé, e o que sobra em pé é o que alguém usa depois. Empate
 * de valor decide pela que expira antes, e depois pelo id — a escolha é
 * determinística, senão dois processos consumiriam autorizações diferentes
 * para o mesmo pedido.
 */
export function decidirSaque(
  pedido: PedidoDeSaque,
  autorizacoes: readonly AutorizacaoDeSaque[],
  agora: Date = new Date(),
): VeredictoDeSaque {
  const candidatas = autorizacoes
    .filter(
      (a) =>
        a.usadaEm === null &&
        a.revogadaEm === null &&
        a.expiraEm.getTime() > agora.getTime() &&
        a.tipo === pedido.tipo &&
        cabeNoValor(pedido.valorCentavos, a),
    )
    .sort(
      (x, y) =>
        compararBigint(x.valorCentavos, y.valorCentavos) ||
        x.expiraEm.getTime() - y.expiraEm.getTime() ||
        x.id.localeCompare(y.id),
    );

  const escolhida = candidatas[0];
  if (!escolhida) return { aprovado: false, motivo: MOTIVO.semAutorizacao, autorizacaoId: null };

  return { aprovado: true, motivo: null, autorizacaoId: escolhida.id };
}

function cabeNoValor(valorCentavos: bigint, a: AutorizacaoDeSaque): boolean {
  // Valor não positivo nunca casa: um pedido de R$ 0,00 aprovado não é saque
  // nenhum, é um payload que não foi entendido.
  if (valorCentavos <= 0n) return false;
  return a.modo === 'exato' ? valorCentavos === a.valorCentavos : valorCentavos <= a.valorCentavos;
}

function compararBigint(a: bigint, b: bigint): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Quando a autorização expira, a partir de agora. */
export function expiraEm(minutos: number, agora: Date = new Date()): Date {
  return new Date(agora.getTime() + minutos * 60_000);
}

/**
 * Situação da autorização para a tela. Derivada, nunca materializada — pelo
 * mesmo motivo do bloqueio por vencimento: estado que vem de uma data não
 * precisa de coluna, e materializá-lo cria a janela em que o banco diz uma
 * coisa e o calendário diz outra.
 */
export type SituacaoDaAutorizacao = 'valida' | 'usada' | 'revogada' | 'expirada';

export function situacaoDaAutorizacao(
  a: Pick<AutorizacaoDeSaque, 'expiraEm' | 'usadaEm' | 'revogadaEm'>,
  agora: Date = new Date(),
): SituacaoDaAutorizacao {
  if (a.usadaEm) return 'usada';
  if (a.revogadaEm) return 'revogada';
  if (a.expiraEm.getTime() <= agora.getTime()) return 'expirada';
  return 'valida';
}
