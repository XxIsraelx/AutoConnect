import { createHash, timingSafeEqual } from 'crypto';
import type {
  EventoDeWhatsApp,
  FormatoDeMensagemWhatsApp,
  MensagemRecebidaDoWhatsApp,
  StatusDoWhatsApp,
} from '@autoconnect/shared';

/**
 * O formato da API de nuvem do WhatsApp (Meta), nos dois sentidos.
 *
 * Fica fora dos provedores porque os dois o usam: o adaptador da Meta para
 * falar com ela, e o simulado para **produzir** exatamente o que ela mandaria —
 * é o que faz o teste com o simulado exercitar o mesmo tradutor que vai rodar
 * em produção, em vez de um formato inventado que só existe nos testes.
 *
 * Referência: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */

/** Cabeçalho com o HMAC-SHA256 do corpo cru, com o segredo do app. */
export const CABECALHO_ASSINATURA_META = 'x-hub-signature-256';

/* ── Webhook: da Meta para cá ─────────────────────────────── */

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** `timestamp` da Meta é segundos Unix em string. */
function quando(v: unknown): Date {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

/** O que a mensagem diz, e em que formato — `null` quando não é mensagem do cliente. */
function conteudo(m: Obj): { formato: FormatoDeMensagemWhatsApp; texto: string | null } | null {
  const legenda = (chave: string) => texto(obj(m[chave])?.caption);
  switch (m.type) {
    case 'text':
      return { formato: 'texto', texto: texto(obj(m.text)?.body) };
    // Resposta a um botão de modelo e a um menu: o cliente "disse" o rótulo.
    case 'button':
      return { formato: 'texto', texto: texto(obj(m.button)?.text) };
    case 'interactive': {
      const i = obj(m.interactive);
      const t = texto(obj(i?.button_reply)?.title) ?? texto(obj(i?.list_reply)?.title);
      return { formato: 'texto', texto: t };
    }
    case 'image':
      return { formato: 'imagem', texto: legenda('image') };
    case 'video':
      return { formato: 'video', texto: legenda('video') };
    case 'document':
      return { formato: 'documento', texto: legenda('document') ?? texto(obj(m.document)?.filename) };
    case 'audio':
      return { formato: 'audio', texto: null };
    case 'location': {
      const l = obj(m.location);
      const partes = [texto(l?.name), texto(l?.address)].filter(Boolean);
      return { formato: 'localizacao', texto: partes.length ? partes.join(' — ') : null };
    }
    case 'contacts':
      return { formato: 'contato', texto: null };
    case 'sticker':
      return { formato: 'figurinha', texto: null };
    // Reação a uma mensagem (um emoji sobre ela) e aviso de sistema (o cliente
    // trocou de número) não são mensagens do cliente para a conversa.
    case 'reaction':
    case 'system':
      return null;
    default:
      return { formato: 'outro', texto: null };
  }
}

const STATUS: Record<string, StatusDoWhatsApp['status']> = {
  sent: 'enviada',
  delivered: 'entregue',
  read: 'lida',
  failed: 'falhou',
};

/** "131047 — Re-engagement message: mais de 24 h desde a última resposta" */
function motivoDoErro(status: Obj): string | null {
  const erro = obj(lista(status.errors)[0]);
  if (!erro) return null;
  const detalhe = texto(obj(erro.error_data)?.details) ?? texto(erro.message);
  const partes = [erro.code != null ? String(erro.code) : null, texto(erro.title)].filter(Boolean);
  const cabeca = partes.join(' — ');
  return [cabeca || null, detalhe].filter(Boolean).join(': ') || null;
}

/**
 * Traduz uma entrega da Meta em eventos. Nunca lança por conteúdo: parte
 * malformada é ignorada, e o resto da entrega segue — uma mensagem esquisita
 * não pode fazer a Meta reentregar a entrega inteira para sempre.
 */
export function interpretarEntregaDaMeta(corpo: unknown): EventoDeWhatsApp[] {
  const raiz = obj(corpo);
  if (!raiz || raiz.object !== 'whatsapp_business_account') return [];

  const eventos: EventoDeWhatsApp[] = [];
  for (const entrada of lista(raiz.entry)) {
    for (const mudanca of lista(obj(entrada)?.changes)) {
      const m = obj(mudanca);
      if (m?.field !== 'messages') continue;
      const valor = obj(m.value);
      const conta = texto(obj(valor?.metadata)?.phone_number_id);
      if (!valor || !conta) continue;

      const nomes = new Map<string, string>();
      for (const c of lista(valor.contacts)) {
        const waId = texto(obj(c)?.wa_id);
        const nome = texto(obj(obj(c)?.profile)?.name);
        if (waId && nome) nomes.set(waId, nome);
      }

      for (const bruta of lista(valor.messages)) {
        const msg = obj(bruta);
        const id = texto(msg?.id);
        const de = texto(msg?.from);
        if (!msg || !id || !de) continue;
        const c = conteudo(msg);
        if (!c) continue;
        eventos.push({
          tipo: 'mensagem',
          idExterno: id,
          conta,
          de: de.replace(/\D/g, ''),
          nome: nomes.get(de) ?? null,
          formato: c.formato,
          texto: c.texto,
          recebidaEm: quando(msg.timestamp),
        } satisfies MensagemRecebidaDoWhatsApp);
      }

      for (const bruto of lista(valor.statuses)) {
        const st = obj(bruto);
        const id = texto(st?.id);
        const status = STATUS[String(st?.status)];
        if (!st || !id || !status) continue;
        eventos.push({
          tipo: 'status',
          idExterno: id,
          conta,
          status,
          em: quando(st.timestamp),
          erro: status === 'falhou' ? motivoDoErro(st) : null,
        } satisfies StatusDoWhatsApp);
      }
    }
  }
  return eventos;
}

/**
 * O inverso, para o simulado: a entrega que a Meta mandaria para estes eventos.
 * Uma entrada por conta, como ela agrupa.
 */
export function montarEntregaDaMeta(eventos: EventoDeWhatsApp[]): Obj {
  const porConta = new Map<string, EventoDeWhatsApp[]>();
  for (const e of eventos) porConta.set(e.conta, [...(porConta.get(e.conta) ?? []), e]);

  const segundos = (d: Date) => String(Math.floor(d.getTime() / 1000));
  const DE_VOLTA: Record<StatusDoWhatsApp['status'], string> = {
    enviada: 'sent', entregue: 'delivered', lida: 'read', falhou: 'failed',
  };

  return {
    object: 'whatsapp_business_account',
    entry: [...porConta.entries()].map(([conta, doConta]) => {
      const mensagens = doConta.filter((e): e is MensagemRecebidaDoWhatsApp => e.tipo === 'mensagem');
      const status = doConta.filter((e): e is StatusDoWhatsApp => e.tipo === 'status');
      return {
        id: `waba-${conta}`,
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: conta, phone_number_id: conta },
            ...(mensagens.length && {
              contacts: mensagens.map((m) => ({ profile: { name: m.nome ?? '' }, wa_id: m.de })),
              messages: mensagens.map((m) => ({
                from: m.de,
                id: m.idExterno,
                timestamp: segundos(m.recebidaEm),
                type: 'text',
                text: { body: m.texto ?? '' },
              })),
            }),
            ...(status.length && {
              statuses: status.map((s) => ({
                id: s.idExterno,
                status: DE_VOLTA[s.status],
                timestamp: segundos(s.em),
                recipient_id: '0',
                ...(s.erro && { errors: [{ code: 0, title: s.erro }] }),
              })),
            }),
          },
        }],
      };
    }),
  };
}

/* ── Envio: daqui para a Meta ─────────────────────────────── */

export function corpoDeTexto(para: string, corpo: string): Obj {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: para,
    type: 'text',
    // Sem prévia de link: o vendedor cola link de anúncio, e a prévia puxaria
    // a foto de um concorrente se o link fosse do portal.
    text: { preview_url: false, body: corpo },
  };
}

export function corpoDeModelo(para: string, nome: string, idioma: string, parametros: string[]): Obj {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: para,
    type: 'template',
    template: {
      name: nome,
      language: { code: idioma },
      components: parametros.length
        ? [{ type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: t })) }]
        : [],
    },
  };
}

/* ── Desafio do cadastro do webhook ───────────────────────── */

/** Comparação em tempo constante, sem vazar o tamanho (ver `token-webhook.ts` da cobrança). */
function iguais(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

/**
 * `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`: a Meta confere
 * que a URL é nossa antes de mandar qualquer evento, e espera o `challenge` de
 * volta, cru. Token errado é `null` (a rota responde 403).
 */
export function responderDesafioDaMeta(consulta: Record<string, unknown>, token: string): string | null {
  const modo = consulta['hub.mode'];
  const recebido = consulta['hub.verify_token'];
  const desafio = consulta['hub.challenge'];
  if (!token || modo !== 'subscribe' || typeof recebido !== 'string' || typeof desafio !== 'string') {
    return null;
  }
  return iguais(recebido, token) ? desafio : null;
}
