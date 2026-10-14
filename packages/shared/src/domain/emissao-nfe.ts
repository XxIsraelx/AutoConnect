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
import type { NotaMontada } from './nota-fiscal';

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

/* ── O emissor ───────────────────────────────────────────────── */

export interface PedidoDeEmissao {
  /** Nossa referência da nota (o id do documento). O emissor a devolve em tudo. */
  referencia: string;
  nota: NotaMontada;
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
  /** Ambiente de homologação: a nota não tem valor fiscal. A tela diz isso. */
  readonly homologacao: boolean;
  emitir(pedido: PedidoDeEmissao): Promise<RetornoDoEmissor>;
  consultar(referencia: string): Promise<RetornoDoEmissor>;
  cancelar(referencia: string, justificativa: string): Promise<RetornoDoEmissor>;
  baixarXml(referencia: string): Promise<Uint8Array>;
  baixarDanfe(referencia: string): Promise<Uint8Array>;
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
