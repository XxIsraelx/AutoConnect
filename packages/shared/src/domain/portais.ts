/**
 * Entrada de leads dos portais (OLX, Webmotors, iCarros, Mercado Livre).
 *
 * O desenho é o de "capturar agora, entender depois". Cada loja ganha um
 * endereço próprio por portal — uma URL de webhook e um e-mail de
 * encaminhamento —, e **tudo** o que chega é guardado cru. O que o sistema sabe
 * ler vira lead na hora, pelo mesmo caminho do formulário (deduplicação,
 * rodízio, prazo). O que não sabe fica visível na tela como "não entendido" e é
 * reprocessado quando o leitor daquele portal existir — o lead não se perde
 * enquanto o leitor não chega.
 *
 * Quem lê:
 *  - **webhook**: o formato AutoConnect (`leadDePortalSchema`), que qualquer
 *    integração (Zapier, Make, RD Station, o próprio portal) consegue montar;
 *  - **e-mail**: `interpretarEmailDeLead`, que procura os rótulos que os
 *    portais usam na notificação ("Nome:", "Telefone:", "Mensagem:").
 * Um leitor específico por portal entra quando houver um e-mail real de
 * amostra — até lá, o genérico cobre, e o que ele não entender fica guardado.
 */

import { z } from 'zod';
import { normalizarTelefoneBr } from './telefone';

/* ── Os portais ───────────────────────────────────────────── */

export const PORTAIS = {
  olx: { nome: 'OLX', dominios: ['olx.com.br'] },
  webmotors: { nome: 'Webmotors', dominios: ['webmotors.com.br'] },
  icarros: { nome: 'iCarros', dominios: ['icarros.com.br', 'icarros.com'] },
  mercadolivre: { nome: 'Mercado Livre', dominios: ['mercadolivre.com.br', 'mercadolibre.com'] },
  outro: { nome: 'Outro portal ou integração', dominios: [] as string[] },
} as const;

export type ChaveDoPortal = keyof typeof PORTAIS;
export const CHAVES_DE_PORTAL = Object.keys(PORTAIS) as ChaveDoPortal[];

export function ehPortal(v: string): v is ChaveDoPortal {
  return (CHAVES_DE_PORTAL as string[]).includes(v);
}

/**
 * O que acontece com cada entrega. `nao_entendido` guarda o cru para
 * reprocessar; `ignorado` é o que não é lead e nunca vai ser (a confirmação de
 * encaminhamento do Gmail, por exemplo).
 */
export const SITUACOES_DE_ENTREGA_DE_PORTAL = ['aplicado', 'duplicado', 'nao_entendido', 'ignorado'] as const;
export type SituacaoDeEntregaDePortal = (typeof SITUACOES_DE_ENTREGA_DE_PORTAL)[number];

/* ── O lead, normalizado ──────────────────────────────────── */

export interface AnuncioDoPortal {
  titulo?: string | null;
  url?: string | null;
  codigo?: string | null;
  preco?: string | null;
}

export interface LeadDePortal {
  /** Id do lead no portal, quando ele manda — chave de idempotência melhor que o corpo. */
  idExterno?: string | null;
  nome: string | null;
  /** Forma canônica (`normalizarTelefoneBr`), ou nulo. */
  telefone: string | null;
  email: string | null;
  mensagem: string | null;
  anuncio: AnuncioDoPortal | null;
}

/** Sem telefone nem e-mail não há com quem falar — não é lead, por mais que tenha nome. */
export function leadDePortalUtilizavel(l: LeadDePortal): boolean {
  return !!(l.telefone || l.email);
}

/**
 * A mensagem que vai para o lead: o que o cliente escreveu e, embaixo, de qual
 * anúncio veio. O vendedor lê o anúncio no lead sem abrir o portal, e o
 * vínculo com o carro do estoque fica com ele ("Vincular veículo") — casar
 * título de anúncio com estoque por texto erraria o carro.
 */
export function mensagemDoLeadDePortal(l: LeadDePortal, portal: ChaveDoPortal): string | null {
  const a = l.anuncio;
  const anuncio = a && [a.titulo, a.preco && `R$ ${a.preco.replace(/^R\$\s*/i, '')}`, a.codigo && `código ${a.codigo}`]
    .filter(Boolean)
    .join(' · ');
  const partes = [
    l.mensagem?.trim() || null,
    anuncio ? `Anúncio na ${PORTAIS[portal].nome}: ${anuncio}` : null,
    a?.url ?? null,
  ].filter(Boolean);
  return partes.length ? partes.join('\n') : null;
}

/* ── Webhook: o formato AutoConnect ───────────────────────── */

const textoOpcional = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => v || null);

const umLeadDePortal = z
  .object({
    id: z.union([z.string(), z.number()]).optional().nullable().transform((v) => (v == null ? null : String(v))),
    nome: textoOpcional(120),
    telefone: textoOpcional(40),
    email: z.string().trim().email().max(160).optional().nullable().or(z.literal('')).transform((v) => v || null),
    mensagem: textoOpcional(4000),
    anuncio: z
      .object({
        titulo: textoOpcional(200),
        url: textoOpcional(500),
        codigo: z.union([z.string(), z.number()]).optional().nullable().transform((v) => (v == null ? null : String(v))),
        preco: z.union([z.string(), z.number()]).optional().nullable().transform((v) => (v == null ? null : String(v))),
      })
      .optional()
      .nullable(),
  })
  .transform((v): LeadDePortal => ({
    idExterno: v.id,
    nome: v.nome,
    telefone: normalizarTelefoneBr(v.telefone),
    email: v.email,
    mensagem: v.mensagem,
    anuncio: v.anuncio
      ? { titulo: v.anuncio.titulo, url: v.anuncio.url, codigo: v.anuncio.codigo, preco: v.anuncio.preco }
      : null,
  }));

/**
 * O formato que o webhook aceita de qualquer portal ou integração: um lead ou
 * uma lista. Campos a mais são ignorados (o portal manda o que quiser); o que
 * importa é haver telefone ou e-mail — conferido depois, por lead.
 */
export const leadDePortalSchema = z.union([umLeadDePortal, z.array(umLeadDePortal).max(100)]);

/* ── E-mail: o leitor genérico ────────────────────────────── */

export interface EmailDeEntrada {
  /** Id da mensagem no provedor de e-mail — a chave de idempotência. */
  idExterno: string;
  de: string | null;
  para: string[];
  assunto: string | null;
  texto: string | null;
  html: string | null;
}

/** HTML de e-mail para texto com quebras onde a tabela e o parágrafo quebram. */
export function textoDoHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
}

/** Sem acento e em minúsculas, para comparar rótulo. */
function simples(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

type Campo = 'nome' | 'telefone' | 'email' | 'mensagem' | 'titulo' | 'codigo' | 'preco';

/**
 * Os rótulos, sem acento e em minúsculas. A ordem importa: "nome do veículo"
 * é anúncio, não nome — por isso os de anúncio vêm antes.
 */
const ROTULOS: [Campo, RegExp][] = [
  ['titulo', /^(anuncio|veiculo|carro|modelo|titulo do anuncio|nome do veiculo|produto)$/],
  ['codigo', /^(codigo( do anuncio)?|id do anuncio|referencia|cod\.? anuncio|numero do anuncio)$/],
  ['preco', /^(preco|valor( do anuncio)?)$/],
  ['nome', /^(nome( do (cliente|interessado|comprador|contato))?|cliente|interessado|comprador|remetente)$/],
  ['telefone', /^(telefone|celular|whats ?app|fone|tel\.?|telefone de contato|telefone do (cliente|interessado))$/],
  ['email', /^(e-?mail( do (cliente|interessado))?)$/],
  ['mensagem', /^(mensagem|comentario|observacao|observacoes|pergunta|duvida)$/],
];

function campoDoRotulo(rotulo: string): Campo | null {
  const r = simples(rotulo).replace(/[:\-–]+$/, '').trim();
  for (const [campo, padrao] of ROTULOS) if (padrao.test(r)) return campo;
  return null;
}

/** "Rótulo: valor" (ou "Rótulo - valor") numa linha só. */
const EM_LINHA = /^([^:–]{2,40}?)\s*[:–]\s*(.*)$|^([^:–\-]{2,40}?)\s+-\s+(.*)$/;

/**
 * Lê uma notificação de lead por e-mail.
 *
 * Aceita as duas formas que os portais usam: "Nome: Maria" numa linha, e a
 * tabela, em que o rótulo e o valor viram linhas seguidas depois do HTML virar
 * texto. A mensagem pode ter várias linhas: vai até a linha em branco ou o
 * próximo rótulo.
 *
 * Só telefone **rotulado** entra: um número solto no e-mail costuma ser o da
 * própria loja ou do portal, no rodapé. `null` quando não há telefone nem
 * e-mail do cliente — e aí a entrega fica guardada como "não entendida".
 */
export function interpretarEmailDeLead(email: Pick<EmailDeEntrada, 'assunto' | 'texto' | 'html'>): LeadDePortal | null {
  const corpo = (email.texto?.trim() ? email.texto : email.html ? textoDoHtml(email.html) : '') ?? '';
  const linhas = corpo.replace(/\r/g, '').split('\n').map((l) => l.trim());

  const achado: Partial<Record<Campo, string>> = {};
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha) continue;

    let campo: Campo | null = null;
    let valor = '';
    const m = EM_LINHA.exec(linha);
    if (m) {
      campo = campoDoRotulo(m[1] ?? m[3] ?? '');
      valor = (m[2] ?? m[4] ?? '').trim();
    }
    if (!campo) {
      // Tabela: rótulo sozinho na linha, valor na seguinte.
      campo = campoDoRotulo(linha);
      if (campo) {
        const prox = linhas.slice(i + 1).find((l) => l !== '');
        if (prox && !campoDoRotulo(prox) && !EM_LINHA.test(prox)) {
          valor = prox;
          i = linhas.indexOf(prox, i + 1);
        }
      }
    }
    if (!campo || achado[campo]) continue;

    if (campo === 'mensagem') {
      // Várias linhas: até a linha em branco ou o próximo rótulo.
      const resto: string[] = valor ? [valor] : [];
      for (let j = i + 1; j < linhas.length; j++) {
        const l = linhas[j];
        if (!l) { if (resto.length) break; continue; }
        const r = EM_LINHA.exec(l);
        if ((r && campoDoRotulo(r[1] ?? r[3] ?? '')) || campoDoRotulo(l)) break;
        resto.push(l);
        i = j;
      }
      valor = resto.join('\n');
    }
    if (valor) achado[campo] = valor;
  }

  const telefone = normalizarTelefoneBr(achado.telefone);
  const emailDoCliente = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(achado.email ?? '') ? achado.email!.toLowerCase() : null;
  const url = corpo.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? null;

  const lead: LeadDePortal = {
    idExterno: null,
    nome: achado.nome?.slice(0, 120) ?? null,
    telefone,
    email: emailDoCliente,
    mensagem: achado.mensagem?.slice(0, 4000) ?? null,
    anuncio: achado.titulo || achado.codigo || achado.preco
      ? { titulo: achado.titulo ?? null, codigo: achado.codigo ?? null, preco: achado.preco ?? null, url }
      : null,
  };
  return leadDePortalUtilizavel(lead) ? lead : null;
}

/**
 * A confirmação de encaminhamento do Gmail. Para encaminhar os e-mails da OLX
 * automaticamente, o Gmail exige confirmar o endereço de destino — e manda o
 * código **para o endereço da loja aqui**. Sem mostrar esse código na tela, o
 * dono configuraria o encaminhamento e ele nunca começaria a valer.
 */
export function codigoDeConfirmacaoDoGmail(email: Pick<EmailDeEntrada, 'de' | 'assunto' | 'texto' | 'html'>): string | null {
  const de = (email.de ?? '').toLowerCase();
  if (!de.includes('forwarding-noreply@google.com')) return null;
  const doAssunto = /\(#(\d{6,12})\)/.exec(email.assunto ?? '')?.[1];
  const corpo = email.texto ?? (email.html ? textoDoHtml(email.html) : '');
  const doCorpo = /(?:confirmation code|c[oó]digo de confirma[cç][aã]o)\s*:\s*(\d{6,12})/i.exec(corpo)?.[1];
  return doAssunto ?? doCorpo ?? null;
}

const PREFIXO_DA_CONFIRMACAO = 'O Gmail pediu para confirmar o encaminhamento. Código de confirmação: ';

/**
 * O resumo da entrega que traz o código do Gmail. O par abaixo existe para que
 * quem escreve (o leitor, na API) e quem lê (o passo a passo, na tela) usem o
 * mesmo texto — o código mora no resumo, e a tela o destaca no passo certo.
 */
export function resumoDaConfirmacaoDoGmail(codigo: string): string {
  return `${PREFIXO_DA_CONFIRMACAO}${codigo}`;
}

export function codigoDaConfirmacaoNoResumo(resumo: string | null | undefined): string | null {
  if (!resumo?.startsWith(PREFIXO_DA_CONFIRMACAO)) return null;
  return /^\d{6,12}$/.exec(resumo.slice(PREFIXO_DA_CONFIRMACAO.length).trim())?.[0] ?? null;
}

/* ── O endereço de entrada da loja ────────────────────────── */

/**
 * O token vai no endereço de e-mail, e parte da cadeia de encaminhamento
 * troca maiúsculas por minúsculas na parte local: por isso hexadecimal
 * minúsculo, e não base64. 20 bytes (40 caracteres) cabem com folga nos 64 da
 * parte local, somados ao prefixo.
 */
export const BYTES_DO_TOKEN_DE_PORTAL = 20;
export const TOKEN_DE_PORTAL = /^[0-9a-f]{40}$/;

/**
 * `leads@entrada.exemplo.com` + token → `leads+<token>@entrada.exemplo.com`.
 * O "+" é o endereço com sufixo que todo provedor de entrada entende.
 */
export function enderecoDeEntrada(base: string, token: string): string {
  const [local, dominio] = base.split('@');
  return `${local}+${token}@${dominio}`;
}

/** O token de um dos destinatários, ou `null`. */
export function tokenDoDestinatario(destinatarios: string[]): string | null {
  for (const d of destinatarios) {
    const endereco = d.match(/<([^>]+)>/)?.[1] ?? d;
    const m = /\+([0-9a-f]{40})@/i.exec(endereco.trim());
    if (m) return m[1].toLowerCase();
  }
  return null;
}
