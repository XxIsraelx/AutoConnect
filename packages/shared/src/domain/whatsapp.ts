/**
 * WhatsApp oficial — o contrato que o provedor tem de cumprir, não o formato dele.
 *
 * Mesmo desenho da assinatura externa e da cobrança: o resto do sistema fala
 * este vocabulário e nunca vê o payload do provedor. O formato é inspirado no
 * da API de nuvem da Meta (conta identificada por um id de número, mensagem
 * com id próprio, status de entrega por webhook assinado), que é o único
 * provedor oficial — mas nada aqui é específico dela. Um BSP (360dialog,
 * Twilio, Gupshup) seria outro adaptador.
 *
 * `Uint8Array` e não `Buffer`: este pacote também vai para o navegador.
 */

import { normalizarTelefoneBr } from './telefone';

/* ── Janela de atendimento ────────────────────────────────── */

/**
 * A regra que mais molda a tela: mensagem livre só dentro de 24 h da última
 * mensagem **do cliente**. Fora dela, só modelo aprovado pela Meta — e é o
 * modelo que custa. A API da Meta recusa o texto livre fora da janela; conferir
 * aqui antes é o que permite à tela oferecer o modelo em vez de mostrar erro.
 */
export const JANELA_DE_ATENDIMENTO_HORAS = 24;

const JANELA_MS = JANELA_DE_ATENDIMENTO_HORAS * 60 * 60 * 1000;

function paraData(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Quando a janela fecha — `null` quando o cliente nunca escreveu. */
export function janelaFechaEm(ultimaDoCliente: Date | string | null | undefined): Date | null {
  const d = paraData(ultimaDoCliente);
  return d ? new Date(d.getTime() + JANELA_MS) : null;
}

/**
 * A janela está aberta? Conversa que a loja iniciou (lead de portal, por
 * exemplo) nasce **fechada**: o cliente ainda não escreveu, então o primeiro
 * contato é sempre por modelo.
 */
export function janelaDeAtendimentoAberta(
  ultimaDoCliente: Date | string | null | undefined,
  agora: Date = new Date(),
): boolean {
  const fecha = janelaFechaEm(ultimaDoCliente);
  return !!fecha && agora.getTime() < fecha.getTime();
}

/* ── Status de entrega ────────────────────────────────────── */

/**
 * O que aconteceu com uma mensagem que a loja mandou.
 *
 * `enviando` existe antes da resposta do provedor: a mensagem é gravada primeiro
 * (para aparecer na tela na hora) e só depois sai. Se o provedor recusar, vira
 * `falhou` com o motivo, e a tela diz que não chegou — em vez de a mensagem
 * sumir, ou pior, parecer entregue.
 */
export const STATUS_DE_ENTREGA = ['enviando', 'enviada', 'entregue', 'lida', 'falhou'] as const;
export type StatusDeEntrega = (typeof STATUS_DE_ENTREGA)[number];

const ORDEM_DE_ENTREGA: Record<Exclude<StatusDeEntrega, 'falhou'>, number> = {
  enviando: 0,
  enviada: 1,
  entregue: 2,
  lida: 3,
};

/**
 * O status novo vale?
 *
 * Os avisos do provedor chegam **fora de ordem** (o "lida" antes do
 * "entregue" é comum, porque são entregas independentes), e reentregues. A
 * regra é só avançar: um "entregue" atrasado não desfaz o "lida". `falhou` só
 * entra antes da entrega — depois que o celular do cliente recebeu, uma falha
 * tardia não é verdade sobre esta mensagem.
 */
export function statusDeEntregaAvanca(
  atual: StatusDeEntrega | null | undefined,
  novo: StatusDeEntrega,
): boolean {
  if (!atual) return true;
  if (atual === novo) return false;
  if (atual === 'falhou') return false;
  if (novo === 'falhou') return ORDEM_DE_ENTREGA[atual] < ORDEM_DE_ENTREGA.entregue;
  return ORDEM_DE_ENTREGA[novo] > ORDEM_DE_ENTREGA[atual];
}

/* ── Contato ──────────────────────────────────────────────── */

/**
 * A chave da conversa: o telefone na forma canônica brasileira.
 *
 * O WhatsApp identifica o cliente pelo `wa_id`, que para número brasileiro
 * **às vezes vem sem o nono dígito** (contas antigas: `551187654321`). Guardar
 * o `wa_id` cru como chave abriria duas conversas para a mesma pessoa — uma
 * pelo lead do portal (com o nove) e outra pela resposta dela (sem). A forma
 * canônica é a mesma dos leads, e é por ela que a deduplicação já compara.
 *
 * Número estrangeiro não tem forma canônica brasileira: fica com `+` e os
 * dígitos, que não colide com nenhuma forma canônica (que nunca tem `+`).
 */
export function contatoDoWhatsApp(waId: string): string {
  const digitos = waId.replace(/\D/g, '');
  return normalizarTelefoneBr(digitos) ?? `+${digitos}`;
}

/**
 * Para onde enviar: o `wa_id` que o cliente usou, quando ele já escreveu, senão
 * o número com DDI. O `wa_id` é o endereço que o WhatsApp reconhece de volta;
 * o número com DDI é o que se tem quando a loja fala primeiro.
 */
export function enderecoDoWhatsApp(contato: string, waId?: string | null): string {
  if (waId) return waId.replace(/\D/g, '');
  return contato.startsWith('+') ? contato.slice(1) : `55${contato}`;
}

/* ── Modelos (templates) ──────────────────────────────────── */

/**
 * Os modelos que o sistema sabe mandar.
 *
 * Cada um precisa existir **aprovado, com o mesmo nome e o mesmo texto**, na
 * conta de WhatsApp da loja — é a Meta quem aprova, e é ela quem decide a
 * categoria na aprovação (a declarada aqui é a pedida). O texto fica aqui, e
 * não só lá, por dois motivos: a mensagem gravada na conversa é o texto
 * renderizado (o histórico mostra o que o cliente leu), e a tela mostra a
 * prévia antes de enviar.
 *
 * `manual`: se o vendedor escolhe na conversa. O lembrete de agendamento é
 * automático — sai do cron de lembretes, não da tela.
 */
export const MODELOS_DE_WHATSAPP = {
  primeiro_contato: {
    nome: 'autoconnect_primeiro_contato',
    rotulo: 'Primeiro contato',
    categoria: 'utility',
    idioma: 'pt_BR',
    manual: true,
    campos: ['cliente', 'vendedor', 'loja', 'veiculo'],
    texto:
      'Olá, {{1}}! Aqui é {{2}}, da {{3}}. Recebemos seu interesse em {{4}}. ' +
      'Posso te ajudar por aqui?',
  },
  retomar_conversa: {
    nome: 'autoconnect_retomar_conversa',
    rotulo: 'Retomar a conversa',
    categoria: 'utility',
    idioma: 'pt_BR',
    manual: true,
    campos: ['cliente', 'loja'],
    texto:
      'Olá, {{1}}! Aqui é da {{2}}. Nossa conversa ficou parada — ' +
      'posso continuar te ajudando?',
  },
  retorno_proposta: {
    nome: 'autoconnect_retorno_proposta',
    rotulo: 'Retorno da proposta',
    categoria: 'utility',
    idioma: 'pt_BR',
    manual: true,
    campos: ['cliente', 'veiculo', 'loja'],
    texto:
      'Olá, {{1}}! A proposta de {{2}} que conversamos continua valendo. ' +
      'Quer seguir com ela? Equipe {{3}}.',
  },
  lembrete_agendamento: {
    nome: 'autoconnect_lembrete_agendamento',
    rotulo: 'Lembrete de agendamento',
    categoria: 'utility',
    idioma: 'pt_BR',
    manual: false,
    campos: ['cliente', 'compromisso', 'loja', 'quando'],
    texto:
      'Olá, {{1}}! Lembrando do seu {{2}} na {{3}}, {{4}}. ' +
      'Se precisar remarcar, é só responder esta mensagem.',
  },
} as const;

export type ChaveDoModelo = keyof typeof MODELOS_DE_WHATSAPP;
export type CampoDoModelo = (typeof MODELOS_DE_WHATSAPP)[ChaveDoModelo]['campos'][number];

export const MODELOS_MANUAIS = (Object.keys(MODELOS_DE_WHATSAPP) as ChaveDoModelo[]).filter(
  (k) => MODELOS_DE_WHATSAPP[k].manual,
) as Exclude<ChaveDoModelo, 'lembrete_agendamento'>[];

/**
 * Os parâmetros na ordem do modelo e o texto que o cliente vai ler.
 *
 * Campo vazio vira erro, não `{{3}}` no celular do cliente: a Meta recusa
 * parâmetro vazio, e um "Olá, !" que passasse seria pior.
 */
export function renderizarModelo(
  chave: ChaveDoModelo,
  valores: Partial<Record<CampoDoModelo, string | null | undefined>>,
): { parametros: string[]; texto: string } {
  const modelo = MODELOS_DE_WHATSAPP[chave];
  const parametros = (modelo.campos as readonly CampoDoModelo[]).map((campo) => {
    const v = valores[campo]?.replace(/\s+/g, ' ').trim();
    if (!v) throw new Error(`Modelo "${chave}" sem o campo "${campo}".`);
    return v;
  });
  const texto = modelo.texto.replace(/\{\{(\d+)\}\}/g, (_, n: string) => parametros[Number(n) - 1] ?? '');
  return { parametros, texto };
}

/* ── Eventos normalizados ─────────────────────────────────── */

/**
 * O formato da mensagem recebida. Só `texto` é exibido por inteiro hoje; os
 * demais entram na conversa como aviso ("o cliente mandou um áudio"), porque
 * baixar a mídia exige outra chamada ao provedor e um destino de arquivo —
 * fica para quando houver conta de verdade para medir o volume.
 */
export const FORMATOS_DE_MENSAGEM_WHATSAPP = [
  'texto', 'imagem', 'audio', 'video', 'documento', 'localizacao', 'contato', 'figurinha', 'outro',
] as const;
export type FormatoDeMensagemWhatsApp = (typeof FORMATOS_DE_MENSAGEM_WHATSAPP)[number];

export const ROTULO_DO_FORMATO: Record<Exclude<FormatoDeMensagemWhatsApp, 'texto'>, string> = {
  imagem: 'uma imagem',
  audio: 'um áudio',
  video: 'um vídeo',
  documento: 'um documento',
  localizacao: 'uma localização',
  contato: 'um contato',
  figurinha: 'uma figurinha',
  outro: 'uma mensagem de um tipo que o AutoConnect ainda não exibe',
};

export interface MensagemRecebidaDoWhatsApp {
  tipo: 'mensagem';
  /** Id da mensagem no provedor (`wamid...`). É a chave de idempotência. */
  idExterno: string;
  /** Id do número da loja no provedor — é por ele que se acha a loja. */
  conta: string;
  /** `wa_id` do cliente, só dígitos. */
  de: string;
  /** Nome do perfil do cliente no WhatsApp, quando o provedor manda. */
  nome: string | null;
  formato: FormatoDeMensagemWhatsApp;
  /** Texto da mensagem, ou a legenda da mídia. */
  texto: string | null;
  recebidaEm: Date;
}

export interface StatusDoWhatsApp {
  tipo: 'status';
  /** Id da mensagem que a loja enviou. */
  idExterno: string;
  conta: string;
  status: Exclude<StatusDeEntrega, 'enviando'>;
  em: Date;
  /** Motivo, quando `falhou`. */
  erro: string | null;
}

export type EventoDeWhatsApp = MensagemRecebidaDoWhatsApp | StatusDoWhatsApp;

/** Chave de idempotência de um evento: a mensagem, ou a mensagem e o status. */
export function chaveDoEventoDeWhatsApp(e: EventoDeWhatsApp): string {
  return e.tipo === 'mensagem' ? `msg:${e.idExterno}` : `status:${e.idExterno}:${e.status}`;
}

/* ── O provedor ───────────────────────────────────────────── */

export type CabecalhosDeWhatsApp = Record<string, string | string[] | undefined>;

export interface EnvioDeTexto {
  /** Id do número da loja no provedor. */
  conta: string;
  para: string;
  texto: string;
}

export interface EnvioDeModelo {
  conta: string;
  para: string;
  /** Nome do modelo aprovado — `MODELOS_DE_WHATSAPP[chave].nome`. */
  modelo: string;
  idioma: string;
  parametros: string[];
}

export interface ProvedorDeWhatsApp {
  readonly nome: string;
  /** Falso quando nada está configurado: a opção some da tela e a API recusa com 503. */
  readonly disponivel: boolean;

  enviarTexto(envio: EnvioDeTexto): Promise<{ idExterno: string }>;
  enviarModelo(envio: EnvioDeModelo): Promise<{ idExterno: string }>;

  /**
   * Confere a autenticidade do corpo **cru** e traduz para eventos.
   * Lança quando a assinatura não confere — antes de ler o conteúdo.
   * Uma entrega pode trazer vários eventos (e de várias contas).
   */
  interpretarWebhook(cabecalhos: CabecalhosDeWhatsApp, corpo: Uint8Array): EventoDeWhatsApp[];

  /**
   * O desafio do cadastro do webhook: o provedor chama a URL com um token
   * combinado e espera o `challenge` de volta. `null` quando o token não confere.
   */
  responderDesafio(consulta: Record<string, unknown>): string | null;
}
