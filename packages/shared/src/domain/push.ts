/**
 * Notificação push do vendedor — o aviso que chega com a aba fechada.
 *
 * O rodízio e o prazo de primeiro contato só funcionam se o vendedor da vez
 * **vê** o lead a tempo. Até aqui o aviso era a contagem no menu, que só existe
 * com o painel aberto; no pátio, o lead esperava. O push chega no celular (e no
 * computador) mesmo com o navegador fechado, pelo service worker.
 *
 * Mesmo desenho dos outros canais: o sistema fala `ProvedorDePush`, o
 * simulado roda em memória, e o adaptador real (Web Push com chaves VAPID)
 * fica atrás de configuração.
 */

import { z } from 'zod';

export interface NotificacaoPush {
  titulo: string;
  corpo: string;
  /** Para onde o toque leva, relativo ao site: `/leads`, `/chat?c=…`. */
  url: string;
  /**
   * Agrupa: uma notificação nova com a mesma etiqueta **substitui** a anterior.
   * É o que impede dez mensagens do mesmo cliente de virarem dez avisos.
   */
  etiqueta: string;
}

export interface InscricaoDePush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type ResultadoDoPush =
  | { ok: true }
  /** `expirada`: o navegador desinscreveu (404/410) — a inscrição sai do banco. */
  | { ok: false; expirada: boolean; motivo: string };

export interface ProvedorDePush {
  readonly nome: string;
  readonly disponivel: boolean;
  /** A chave pública VAPID, que o navegador precisa para se inscrever. */
  readonly chavePublica: string | null;
  enviar(inscricao: InscricaoDePush, notificacao: NotificacaoPush): Promise<ResultadoDoPush>;
}

/* ── O texto ──────────────────────────────────────────────── */

/**
 * O serviço de push dos navegadores aceita cerca de 4 KB, e a tela de bloqueio
 * corta bem antes disso. O corte é na palavra, com reticências.
 */
export function encurtar(texto: string, maximo: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  if (limpo.length <= maximo) return limpo;
  const corte = limpo.slice(0, maximo - 1);
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > maximo * 0.6 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

/** Lead novo para o vendedor da vez — ou para a gerência, quando ficou sem responsável. */
export function notificacaoDeLeadNovo(dados: {
  leadId: string;
  nome: string | null;
  veiculo: string | null;
  origem: string;
  semResponsavel?: boolean;
}): NotificacaoPush {
  const quem = dados.nome?.trim() || 'Cliente sem nome';
  const sobre = dados.veiculo && dados.veiculo !== 'veículo' ? ` — ${dados.veiculo}` : '';
  return {
    titulo: dados.semResponsavel ? `Lead sem responsável (${dados.origem})` : `Lead novo (${dados.origem})`,
    corpo: encurtar(`${quem}${sobre}`, 140),
    url: '/leads',
    etiqueta: `lead-${dados.leadId}`,
  };
}

/** O cliente escreveu numa conversa do vendedor. */
export function notificacaoDeMensagem(dados: {
  conversationId: string;
  nome: string | null;
  canal: string;
  texto: string;
}): NotificacaoPush {
  return {
    titulo: `${dados.nome?.trim() || 'Cliente'} (${dados.canal})`,
    corpo: encurtar(dados.texto || 'Nova mensagem', 180),
    url: `/chat?c=${dados.conversationId}`,
    etiqueta: `conversa-${dados.conversationId}`,
  };
}

/* ── A inscrição que o navegador manda ────────────────────── */

/**
 * `PushSubscription.toJSON()` do navegador: `{ endpoint, expirationTime,
 * keys: { p256dh, auth } }`. O endpoint é do serviço de push do navegador
 * (Google, Mozilla, Apple) e sempre https.
 */
export const inscricaoDePushSchema = z
  .object({
    endpoint: z.string().url().max(2048).refine((u) => u.startsWith('https://'), 'Endpoint precisa ser https.'),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(20).max(200),
      auth: z.string().min(8).max(100),
    }),
  })
  .strict();
export type InscricaoDePushInput = z.infer<typeof inscricaoDePushSchema>;

export const removerInscricaoDePushSchema = z
  .object({ endpoint: z.string().url().max(2048) })
  .strict();
