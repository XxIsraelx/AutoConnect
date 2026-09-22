/**
 * Assinatura eletrônica externa — o contrato que o provedor tem de cumprir,
 * não o formato dele.
 *
 * Mesmo desenho da consulta veicular: o resto do sistema fala este
 * vocabulário e nunca vê o payload do provedor. O formato é inspirado no da
 * Clicksign (envelope, signatários com id próprio, webhook assinado por HMAC),
 * que é o provedor mais provável, mas nada aqui é específico dela — trocar de
 * provedor é escrever outro adaptador.
 *
 * `Uint8Array` e não `Buffer` nas assinaturas de tipo: este pacote também vai
 * para o navegador, e o `Buffer` do Node é subclasse de `Uint8Array`.
 */

import type { SignerRoleValue } from './garantia';

/**
 * Espelho de `SignatureRequestStatus` do Prisma.
 *
 * - `pending`: reservado no banco, provedor ainda não respondeu. Existe para
 *   que o clique duplo não crie dois envelopes (e dois e-mails ao cliente).
 * - `sent`: envelope criado, aguardando os signatários.
 * - `failed`: o provedor recusou a criação. Terminal, libera novo envio.
 */
export const ASSINATURA_EXTERNA_STATUSES = [
  'pending',
  'sent',
  'completed',
  'refused',
  'expired',
  'canceled',
  'failed',
] as const;
export type AssinaturaExternaStatus = (typeof ASSINATURA_EXTERNA_STATUSES)[number];

/**
 * Estados em que a solicitação ainda está viva. É a mesma lista do índice
 * único parcial `contract_signature_requests_viva_idx` — se mudar aqui, muda lá.
 */
export const ASSINATURA_EXTERNA_VIVAS = ['pending', 'sent'] as const;

export function assinaturaExternaViva(s: AssinaturaExternaStatus): boolean {
  return (ASSINATURA_EXTERNA_VIVAS as readonly string[]).includes(s);
}

export const SIGNATARIO_STATUSES = ['enviado', 'assinou', 'recusou'] as const;
export type SignatarioStatus = (typeof SIGNATARIO_STATUSES)[number];

/** Eventos normalizados. `ignorado` cobre tudo que não muda estado aqui. */
export const EVENTOS_ASSINATURA = [
  'assinou',
  'recusou',
  'concluido',
  'expirou',
  'cancelado',
  'ignorado',
] as const;
export type TipoEventoAssinatura = (typeof EVENTOS_ASSINATURA)[number];

export interface SignatarioDoEnvelope {
  papel: SignerRoleValue;
  nome: string;
  email: string;
  /** CPF, só dígitos. O provedor pode exigir na autenticação do signatário. */
  documento?: string;
}

export interface NovoEnvelope {
  documento: Uint8Array;
  nomeArquivo: string;
  /** SHA-256 do documento enviado — o `contentHash` do contrato. */
  hash: string;
  signatarios: SignatarioDoEnvelope[];
  prazo: Date;
}

export interface EnvelopeCriado {
  idExterno: string;
  signatarios: { papel: SignerRoleValue; idExterno: string; urlAssinatura?: string }[];
}

/** O que o webhook disse, já traduzido. */
export interface EventoDeAssinatura {
  idExterno: string;
  tipo: TipoEventoAssinatura;
  papel?: SignerRoleValue;
  idSignatarioExterno?: string;
  /**
   * Id do evento no provedor, quando ele fornece. Sem ele, quem chama usa o
   * hash do corpo cru — a mesma entrega repetida tem o mesmo corpo.
   */
  idEvento?: string;
  ocorridoEm: Date;
}

export type CabecalhosHttp = Record<string, string | string[] | undefined>;

/**
 * O que um provedor de assinatura precisa implementar.
 *
 * `interpretarWebhook` confere a autenticidade (HMAC, no caso da Clicksign) e
 * **lança** quando ela não confere. O payload do provedor não sai daqui.
 */
export interface ProvedorDeAssinatura {
  readonly nome: string;
  /** Falso quando nenhum provedor está configurado: a tela esconde a opção. */
  readonly disponivel: boolean;
  criarEnvelope(envelope: NovoEnvelope): Promise<EnvelopeCriado>;
  cancelar(idExterno: string): Promise<void>;
  baixarAssinado(idExterno: string): Promise<Uint8Array>;
  interpretarWebhook(cabecalhos: CabecalhosHttp, corpoCru: Uint8Array): EventoDeAssinatura;
}

/* ── Máquina de estados ───────────────────────────────────────── */

export interface SignatarioRegistrado {
  papel: SignerRoleValue;
  nome: string;
  email: string;
  documento?: string | null;
  idExterno: string | null;
  urlAssinatura?: string | null;
  status: SignatarioStatus;
  /** ISO 8601. */
  ocorridoEm?: string | null;
}

export interface EstadoDaSolicitacao {
  status: AssinaturaExternaStatus;
  signatarios: SignatarioRegistrado[];
}

export interface ResultadoDoEvento {
  estado: EstadoDaSolicitacao;
  /** Falso quando o evento não muda nada: repetido, atrasado ou irrelevante. */
  mudou: boolean;
  /** Verdadeiro só na transição para `completed`: hora de fechar o contrato. */
  concluir: boolean;
}

/**
 * Aplica um evento ao estado da solicitação.
 *
 * Pura e idempotente de propósito: webhooks chegam repetidos e fora de ordem,
 * e aplicar o mesmo evento duas vezes tem de dar o mesmo estado. As regras:
 *
 * - Estado terminal não muda mais. `assinou` depois de `concluido`, ou
 *   qualquer coisa depois de `cancelado`, é ignorado — inclusive um
 *   `concluido` que chegue depois de o contrato ter sido anulado aqui.
 * - `concluido` marca todos os signatários como assinados: se ele chegar antes
 *   do último `assinou` (fora de ordem), o estado final é o mesmo.
 * - `recusou` de qualquer signatário encerra a solicitação — o documento não
 *   se fecha com uma das partes recusando.
 * - Só se conclui a partir de `sent`: `pending` ainda não tem envelope.
 */
export function aplicarEventoDeAssinatura(
  atual: EstadoDaSolicitacao,
  evento: Pick<EventoDeAssinatura, 'tipo' | 'papel' | 'idSignatarioExterno' | 'ocorridoEm'>,
): ResultadoDoEvento {
  const igual: ResultadoDoEvento = { estado: atual, mudou: false, concluir: false };

  if (atual.status !== 'sent' || evento.tipo === 'ignorado') return igual;

  const quando = evento.ocorridoEm.toISOString();
  const alvo = (s: SignatarioRegistrado) =>
    (evento.idSignatarioExterno && s.idExterno === evento.idSignatarioExterno) ||
    (!evento.idSignatarioExterno && evento.papel !== undefined && s.papel === evento.papel);

  switch (evento.tipo) {
    case 'assinou': {
      let mudou = false;
      const signatarios = atual.signatarios.map((s) => {
        if (!alvo(s) || s.status !== 'enviado') return s;
        mudou = true;
        return { ...s, status: 'assinou' as const, ocorridoEm: quando };
      });
      return mudou ? { estado: { ...atual, signatarios }, mudou, concluir: false } : igual;
    }

    case 'recusou': {
      const signatarios = atual.signatarios.map((s) =>
        alvo(s) && s.status === 'enviado'
          ? { ...s, status: 'recusou' as const, ocorridoEm: quando }
          : s,
      );
      return { estado: { status: 'refused', signatarios }, mudou: true, concluir: false };
    }

    case 'concluido': {
      const signatarios = atual.signatarios.map((s) =>
        s.status === 'assinou' ? s : { ...s, status: 'assinou' as const, ocorridoEm: s.ocorridoEm ?? quando },
      );
      return { estado: { status: 'completed', signatarios }, mudou: true, concluir: true };
    }

    case 'expirou':
      return { estado: { ...atual, status: 'expired' }, mudou: true, concluir: false };

    case 'cancelado':
      return { estado: { ...atual, status: 'canceled' }, mudou: true, concluir: false };
  }
}

export const ROTULO_ASSINATURA_EXTERNA: Record<AssinaturaExternaStatus, string> = {
  pending: 'Enviando',
  sent: 'Aguardando assinaturas',
  completed: 'Assinado eletronicamente',
  refused: 'Recusado',
  expired: 'Prazo expirado',
  canceled: 'Cancelado',
  failed: 'Falha no envio',
};

export const ROTULO_SIGNATARIO: Record<SignatarioStatus, string> = {
  enviado: 'enviado',
  assinou: 'assinou',
  recusou: 'recusou',
};
