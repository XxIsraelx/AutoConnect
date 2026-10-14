/**
 * Emissão da NF-e: o ciclo de vida da nota e o contrato com o emissor.
 *
 * Fase N2 da trilha NF-e (`docs/planos/plano-fiscal-renave-nfe.md`). O emissor
 * entra por `ProvedorDeNotaFiscal` — simulado agora, o terceiro de verdade em
 * N3 —, e tudo o que ele devolve passa por `aplicarRetorno`, que é pura.
 *
 * Por que a máquina de estados mora aqui e não no serviço: o retorno do
 * emissor chega **assíncrono, repetido e fora de ordem** — pelo webhook, pela
 * consulta que a loja dispara, e pela resposta da própria emissão. Três
 * caminhos, uma regra. Foi a mesma razão de `aplicarEventoDeCobranca`.
 */
import { lerChaveNfe } from './chave-nfe';
import { deCentavos, emCentavos } from './dinheiro';
import {
  DEFINICAO_DAS_OPERACOES,
  type AmbienteFiscal, type EnderecoFiscal, type NotaMontada, type OperacaoFiscal, type RegimeTributario,
} from './nota-fiscal';

export const STATUS_DA_NOTA = ['processando', 'autorizada', 'rejeitada', 'denegada', 'cancelada'] as const;
export type StatusDaNota = (typeof STATUS_DA_NOTA)[number];

export const ROTULO_DO_STATUS_DA_NOTA: Record<StatusDaNota, string> = {
  processando: 'Processando na SEFAZ',
  autorizada: 'Autorizada',
  rejeitada: 'Rejeitada',
  denegada: 'Denegada',
  cancelada: 'Cancelada',
};

/**
 * Estados em que a nota "existe" para o negócio. Só pode haver uma assim por
 * negócio — o índice único parcial `fiscal_documents_nota_viva_idx` repete a
 * regra no banco, e é ele que faz o clique duplo não virar duas notas.
 */
export const STATUS_DE_NOTA_VIVA: readonly StatusDaNota[] = ['processando', 'autorizada'];

/** Terminal: nada mais muda. Rejeitada e denegada se resolvem emitindo de novo. */
export const STATUS_DE_NOTA_TERMINAL: readonly StatusDaNota[] = ['rejeitada', 'denegada', 'cancelada'];

/** O que o emissor diz sobre uma nota, no vocabulário do domínio. */
export interface RetornoDoEmissor {
  /** A referência que nós demos à nota ao emitir (o id do documento). */
  referencia: string;
  situacao: StatusDaNota | 'cancelamento_rejeitado';
  chave?: string | null;
  numero?: number | null;
  serie?: number | null;
  protocolo?: string | null;
  /** Motivo da rejeição, da denegação ou da recusa do cancelamento. */
  motivo?: string | null;
  /** ISO 8601 — quando a SEFAZ respondeu, não quando nós recebemos. */
  ocorridoEm: string;
}

export interface EstadoDaNota {
  status: StatusDaNota;
  chave: string | null;
}

export interface ResultadoDoRetorno {
  status: StatusDaNota;
  /** Falso para reentrega, retorno atrasado ou fora de ordem. */
  mudou: boolean;
  /** Por que o retorno não foi aplicado — vai para o log, nunca é exceção. */
  aviso?: string;
}

/**
 * Aplica um retorno do emissor ao estado atual.
 *
 * Nunca lança: retorno estranho vira `aviso` e o estado fica como está. Um
 * webhook que estoura vira reentrega infinita, e o emissor só para de insistir
 * quando ouve 2xx.
 *
 * Duas recusas que importam:
 *  - **autorização sem chave válida** não autoriza — a chave é a identidade da
 *    nota no país, e uma nota "autorizada" sem ela não pode ser cancelada,
 *    consultada nem levada ao RENAVE;
 *  - **estado terminal não volta** — cancelada não "desautoriza" por causa de
 *    um webhook de autorização que chegou atrasado.
 */
export function aplicarRetorno(atual: EstadoDaNota, r: RetornoDoEmissor): ResultadoDoRetorno {
  const manter = (aviso?: string): ResultadoDoRetorno => ({ status: atual.status, mudou: false, aviso });

  if (STATUS_DE_NOTA_TERMINAL.includes(atual.status)) {
    return r.situacao === atual.status
      ? manter()
      : manter(`Retorno "${r.situacao}" ignorado: a nota já está ${atual.status}.`);
  }

  if (atual.status === 'processando') {
    switch (r.situacao) {
      case 'processando':
        return manter();
      case 'autorizada':
        if (!lerChaveNfe(r.chave)) {
          return manter('Autorização sem chave de acesso válida: a nota segue processando.');
        }
        if (!r.protocolo) {
          return manter('Autorização sem protocolo: a nota segue processando.');
        }
        return { status: 'autorizada', mudou: true };
      case 'rejeitada':
      case 'denegada':
        return { status: r.situacao, mudou: true };
      default:
        return manter(`Retorno "${r.situacao}" para nota que ainda não foi autorizada.`);
    }
  }

  // autorizada
  switch (r.situacao) {
    case 'autorizada':
      return r.chave && r.chave !== atual.chave
        ? manter('Autorização repetida com outra chave: mantida a primeira.')
        : manter();
    case 'cancelada':
      return { status: 'cancelada', mudou: true };
    case 'cancelamento_rejeitado':
      return manter(`A SEFAZ recusou o cancelamento: ${r.motivo ?? 'sem motivo informado'}.`);
    default:
      return manter(`Retorno "${r.situacao}" ignorado: a nota já está autorizada.`);
  }
}

/* ── Cancelamento ────────────────────────────────────────────── */

/**
 * Prazo de cancelamento comum da SEFAZ: 24 horas da autorização. Alguns
 * estados aceitam cancelamento extemporâneo, com outro rito — isso é conversa
 * com o contador, não botão.
 */
export const PRAZO_DE_CANCELAMENTO_HORAS = 24;

/** Justificativa (`xJust`) do evento de cancelamento: de 15 a 255 caracteres. */
export const JUSTIFICATIVA_MINIMA = 15;
export const JUSTIFICATIVA_MAXIMA = 255;

export function podeCancelar(
  nota: { status: StatusDaNota; autorizadaEm: string | null },
  agora: Date,
): { pode: true } | { pode: false; motivo: string } {
  if (nota.status !== 'autorizada' || !nota.autorizadaEm) {
    return { pode: false, motivo: 'Só nota autorizada pode ser cancelada.' };
  }
  const horas = (agora.getTime() - new Date(nota.autorizadaEm).getTime()) / 3_600_000;
  if (horas > PRAZO_DE_CANCELAMENTO_HORAS) {
    return {
      pode: false,
      motivo:
        `Passaram mais de ${PRAZO_DE_CANCELAMENTO_HORAS} horas da autorização. ` +
        'Fale com o contador: alguns estados aceitam o cancelamento fora do prazo, com outro procedimento.',
    };
  }
  return { pode: true };
}

/* ── Carta de correção (N3) ──────────────────────────────────── */

/** Texto da CC-e (`xCorrecao`): de 15 a 1.000 caracteres. */
export const CORRECAO_MINIMA = 15;
export const CORRECAO_MAXIMA = 1000;
/** A SEFAZ aceita até 20 cartas por nota; vale sempre a última. */
export const CARTAS_DE_CORRECAO_POR_NOTA = 20;

/**
 * A carta de correção não corrige qualquer coisa: valor, imposto, data,
 * CFOP e a identificação de quem emite ou recebe ficam fora (Ajuste SINIEF
 * 01/07). Não dá para conferir isso no código — é texto livre —, então a tela
 * diz, e a SEFAZ recusa o que passar.
 */
export const O_QUE_A_CARTA_NAO_CORRIGE =
  'A carta de correção não muda valor, imposto, data, CFOP, nem quem emite ou recebe a nota.';

export function podeCorrigir(
  nota: { status: StatusDaNota },
  cartasAutorizadas: number,
): { pode: true } | { pode: false; motivo: string } {
  if (nota.status !== 'autorizada') {
    return { pode: false, motivo: 'Só nota autorizada (e não cancelada) recebe carta de correção.' };
  }
  if (cartasAutorizadas >= CARTAS_DE_CORRECAO_POR_NOTA) {
    return { pode: false, motivo: `A nota já tem ${CARTAS_DE_CORRECAO_POR_NOTA} cartas de correção — o limite da SEFAZ.` };
  }
  return { pode: true };
}

export interface RetornoDaCartaDeCorrecao {
  situacao: 'autorizada' | 'rejeitada';
  /** O número da carta na nota, atribuído pelo emissor. */
  sequencia: number | null;
  protocolo?: string | null;
  motivo?: string | null;
  ocorridoEm: string;
}

/* ── O emissor ───────────────────────────────────────────────── */

/**
 * Exigência da SEFAZ em homologação (rejeição 598): o nome do destinatário é
 * este texto, e não o da pessoa. Quem monta o pedido em homologação troca.
 */
export const NOME_DO_DESTINATARIO_EM_HOMOLOGACAO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export interface PedidoDeEmissao {
  /** Nossa referência da nota (o id do documento). O emissor a devolve em tudo. */
  referencia: string;
  nota: NotaMontada;
}

/**
 * De qual loja, em qual ambiente. O emissor real usa uma conta (e um token)
 * por empresa e um endereço por ambiente; o simulado ignora.
 */
export interface EmitenteNoEmissor {
  /** O id da empresa no emissor — `null` enquanto a loja não enviou o certificado. */
  contaExterna: string | null;
  ambiente: AmbienteFiscal;
}

/** O que o emissor precisa saber da loja para habilitá-la a emitir. */
export interface DadosDoEmitente {
  contaExterna: string | null;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  inscricaoEstadual: string;
  regime: RegimeTributario;
  endereco: EnderecoFiscal;
  email: string;
}

export interface CertificadoA1 {
  /** O arquivo PFX/P12, em base64. Passa pela API e vai ao emissor; nunca é gravado. */
  arquivoBase64: string;
  senha: string;
}

export interface EmitenteRegistrado {
  contaExterna: string;
  certificadoValidoAte: string | null;
  certificadoCnpj: string | null;
}

export type CabecalhosDoEmissor = Record<string, string | string[] | undefined>;

/**
 * O contrato com o emissor terceiro. Tudo assíncrono e tudo no vocabulário do
 * domínio: o formato do emissor não sai do adaptador.
 *
 * `emitir` e `cancelar` podem responder já com o resultado final ou com
 * `processando` — o resultado chega depois pelo webhook ou por `consultar`, e
 * os três caminhos passam por `aplicarRetorno`.
 */
export interface ProvedorDeNotaFiscal {
  readonly nome: string;
  /** Falso sem emissor configurado: a tela esconde o botão de emitir. */
  readonly disponivel: boolean;
  /**
   * Esta instalação só emite em homologação (sem valor fiscal). A tela diz
   * isso, e perfil em produção é recusado na emissão.
   */
  readonly homologacao: boolean;
  /** A loja precisa ter enviado o certificado A1 antes de emitir. */
  readonly exigeCertificado: boolean;
  registrarEmitente(dados: DadosDoEmitente, certificado: CertificadoA1): Promise<EmitenteRegistrado>;
  emitir(emitente: EmitenteNoEmissor, pedido: PedidoDeEmissao): Promise<RetornoDoEmissor>;
  consultar(emitente: EmitenteNoEmissor, referencia: string): Promise<RetornoDoEmissor>;
  cancelar(emitente: EmitenteNoEmissor, referencia: string, justificativa: string): Promise<RetornoDoEmissor>;
  cartaDeCorrecao(emitente: EmitenteNoEmissor, referencia: string, correcao: string): Promise<RetornoDaCartaDeCorrecao>;
  baixarXml(emitente: EmitenteNoEmissor, referencia: string): Promise<Uint8Array>;
  baixarDanfe(emitente: EmitenteNoEmissor, referencia: string): Promise<Uint8Array>;
  /**
   * Autentica e traduz o webhook. Lança 401 quando a entrega não é do emissor,
   * **antes** de qualquer acesso ao banco. `idDaEntrega` é a chave de
   * idempotência: o id do evento, ou o hash do corpo quando o emissor não manda.
   */
  interpretarWebhook(
    cabecalhos: CabecalhosDoEmissor,
    corpoCru: Uint8Array,
  ): { idDaEntrega: string; retorno: RetornoDoEmissor | null };
}

/* ── Relatório do período (N4) ───────────────────────────────── */

export interface NotaParaRelatorio {
  id: string;
  status: StatusDaNota;
  operacao: OperacaoFiscal;
  /** Negócio ou aquisição de onde a nota saiu. */
  origemId: string;
  valorTotal: string;
  /** ISO. */
  emitidaEm: string;
}

export interface TotalDoRelatorio {
  quantidade: number;
  valor: string;
}

export interface ResumoDasNotas {
  porStatus: Record<StatusDaNota, TotalDoRelatorio>;
  /** Só autorizadas: é o que vale para o contador. Cancelada não soma. */
  entradas: TotalDoRelatorio;
  saidas: TotalDoRelatorio;
  /** Ids das notas que pedem ação da loja — ver `notaEstaPendente`. */
  pendentes: string[];
}

/**
 * A nota pede ação da loja?
 *
 * - **processando** — a SEFAZ ainda não respondeu: consultar;
 * - **rejeitada ou denegada sem substituta** — a venda (ou a compra) segue sem
 *   nota. Se a mesma origem já tem outra nota depois dela, viva ou cancelada,
 *   a rejeição foi resolvida e sai da lista.
 *
 * `daMesmaOrigem` são **todas** as notas da origem, não só as do período: a
 * substituta da rejeição de dia 31 pode ter saído no dia 1º.
 */
export function notaEstaPendente(nota: NotaParaRelatorio, daMesmaOrigem: readonly NotaParaRelatorio[]): boolean {
  if (nota.status === 'processando') return true;
  if (nota.status !== 'rejeitada' && nota.status !== 'denegada') return false;
  return !daMesmaOrigem.some((n) =>
    n.id !== nota.id
    && n.emitidaEm >= nota.emitidaEm
    && (n.status === 'processando' || n.status === 'autorizada' || n.status === 'cancelada'));
}

export function resumoDasNotas(
  notas: readonly NotaParaRelatorio[],
  todasDasOrigens: readonly NotaParaRelatorio[] = notas,
): ResumoDasNotas {
  const zero = (): { quantidade: number; centavos: bigint } => ({ quantidade: 0, centavos: 0n });
  const porStatus = Object.fromEntries(STATUS_DA_NOTA.map((s) => [s, zero()])) as Record<StatusDaNota, ReturnType<typeof zero>>;
  const entradas = zero();
  const saidas = zero();

  for (const n of notas) {
    const centavos = emCentavos(n.valorTotal);
    porStatus[n.status].quantidade += 1;
    porStatus[n.status].centavos += centavos;
    if (n.status === 'autorizada') {
      const alvo = DEFINICAO_DAS_OPERACOES[n.operacao].direcao === 'entrada' ? entradas : saidas;
      alvo.quantidade += 1;
      alvo.centavos += centavos;
    }
  }

  const fechar = (t: ReturnType<typeof zero>): TotalDoRelatorio => ({ quantidade: t.quantidade, valor: deCentavos(t.centavos) });
  return {
    porStatus: Object.fromEntries(STATUS_DA_NOTA.map((s) => [s, fechar(porStatus[s])])) as Record<StatusDaNota, TotalDoRelatorio>,
    entradas: fechar(entradas),
    saidas: fechar(saidas),
    pendentes: notas
      .filter((n) => notaEstaPendente(n, todasDasOrigens.filter((o) => o.origemId === n.origemId)))
      .map((n) => n.id),
  };
}
