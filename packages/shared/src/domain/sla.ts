/**
 * Prazo de primeiro contato — o relógio do lead.
 *
 * Vive no shared porque as duas pontas precisam da MESMA conta: a API calcula
 * `firstResponseDueAt` na criação do lead e a tela precisa dizer quanto falta.
 * Duas fórmulas é como se produz uma etiqueta "no prazo" sobre um lead que a
 * API já considera estourado.
 *
 * ## A decisão do relógio
 *
 * **O relógio só corre no horário de funcionamento da loja.** Um lead que
 * chega às 23h de sábado não pode nascer estourado às 23h15 — ninguém foi
 * negligente, a loja estava fechada. O prazo desse lead começa a contar na
 * próxima abertura.
 *
 * O expediente vem de `DealershipBranch.businessHours`, que já existe e já é
 * editado em `/configuracoes`: `{ "0": { closed, open, close }, … "6": {…} }`,
 * com 0 = domingo. Quando a loja não configurou nada, usamos
 * `EXPEDIENTE_PADRAO` (seg–sex 09–18, sáb 09–13) em vez de contar 24h por dia:
 * o padrão errado para menos é um alarme falso; o padrão errado para mais é um
 * lead esquecido.
 *
 * ## Fuso
 *
 * As horas do expediente são horário **local da loja** (`Tenant.timezone`,
 * padrão `America/Sao_Paulo`). A conversão usa `Intl`, sem biblioteca: o Brasil
 * não tem horário de verão desde 2019, e o cálculo abaixo funciona mesmo onde
 * houvesse, porque o deslocamento é consultado a cada instante examinado.
 */

export interface ExpedienteDoDia {
  closed: boolean;
  /** "09:00" */
  open: string;
  /** "18:00" */
  close: string;
}

/** Chave = dia da semana como string, 0 = domingo. */
export type Expediente = Record<string, ExpedienteDoDia>;

export const FUSO_PADRAO = 'America/Sao_Paulo';

/** Seg–sex 09–18, sáb 09–13, domingo fechado. */
export const EXPEDIENTE_PADRAO: Expediente = {
  '0': { closed: true, open: '09:00', close: '18:00' },
  '1': { closed: false, open: '09:00', close: '18:00' },
  '2': { closed: false, open: '09:00', close: '18:00' },
  '3': { closed: false, open: '09:00', close: '18:00' },
  '4': { closed: false, open: '09:00', close: '18:00' },
  '5': { closed: false, open: '09:00', close: '18:00' },
  '6': { closed: false, open: '09:00', close: '13:00' },
};

/** Prazo padrão de primeira resposta, em minutos de expediente. */
export const SLA_PADRAO_MINUTOS = 15;

/** Limites aceitos na configuração da loja: 1 minuto a 3 dias úteis de 8h. */
export const SLA_MINUTOS_MIN = 1;
export const SLA_MINUTOS_MAX = 1440;

/** Reconhece um `businessHours` utilizável; qualquer outra coisa vira padrão. */
export function expedienteValido(bh: unknown): bh is Expediente {
  if (!bh || typeof bh !== 'object' || Array.isArray(bh)) return false;
  const dias = Object.entries(bh as Record<string, unknown>);
  if (dias.length === 0) return false;
  return dias.every(([dia, valor]) => {
    if (!/^[0-6]$/.test(dia)) return false;
    if (!valor || typeof valor !== 'object') return false;
    const d = valor as Partial<ExpedienteDoDia>;
    return typeof d.closed === 'boolean'
      && typeof d.open === 'string'
      && typeof d.close === 'string';
  });
}

/** `businessHours` do banco → expediente utilizável, com o padrão de reserva. */
export function expedienteOuPadrao(bh: unknown): Expediente {
  return expedienteValido(bh) ? bh : EXPEDIENTE_PADRAO;
}

function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Partes do calendário local da loja para um instante. */
interface RelogioLocal {
  ano: number; mes: number; dia: number;
  minutosDoDia: number;
  diaDaSemana: number;
}

const CAMPOS = ['year', 'month', 'day', 'hour', 'minute', 'weekday'] as const;

const SEMANA: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function relogioLocal(instante: Date, fuso: string): RelogioLocal {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
    hour12: false,
  }).formatToParts(instante);

  const mapa: Record<string, string> = {};
  for (const p of partes) {
    if ((CAMPOS as readonly string[]).includes(p.type)) mapa[p.type] = p.value;
  }

  // `hour12: false` produz "24" em algumas versões do ICU para a meia-noite.
  const hora = parseInt(mapa.hour, 10) % 24;

  return {
    ano: parseInt(mapa.year, 10),
    mes: parseInt(mapa.month, 10),
    dia: parseInt(mapa.day, 10),
    minutosDoDia: hora * 60 + parseInt(mapa.minute, 10),
    diaDaSemana: SEMANA[mapa.weekday] ?? 0,
  };
}

/** Quanto o fuso da loja está adiantado em relação ao UTC, naquele instante. */
function deslocamentoMinutos(instante: Date, fuso: string): number {
  const l = relogioLocal(instante, fuso);
  const comoSeUtc = Date.UTC(l.ano, l.mes - 1, l.dia, 0, l.minutosDoDia);
  // Segundos e milissegundos são descartados dos dois lados para que a conta
  // devolva um múltiplo de minuto.
  const base = Math.floor(instante.getTime() / 60000) * 60000;
  return Math.round((comoSeUtc - base) / 60000);
}

/** Instante UTC de uma hora local da loja num dia local dado. */
function instanteLocal(
  ano: number, mes: number, dia: number, minutosDoDia: number, fuso: string,
): Date {
  const palpite = new Date(Date.UTC(ano, mes - 1, dia, 0, minutosDoDia));
  const deslocamento = deslocamentoMinutos(palpite, fuso);
  const corrigido = new Date(palpite.getTime() - deslocamento * 60000);
  // Segunda passada: numa virada de horário de verão o deslocamento do palpite
  // pode ser o do lado errado da virada.
  const segundo = deslocamentoMinutos(corrigido, fuso);
  return segundo === deslocamento
    ? corrigido
    : new Date(palpite.getTime() - segundo * 60000);
}

/** Janelas de expediente por dia, a partir de um instante, em ordem. */
function* janelas(
  inicio: Date, expediente: Expediente, fuso: string, diasMax: number,
): Generator<{ abre: Date; fecha: Date }> {
  const l = relogioLocal(inicio, fuso);

  for (let i = 0; i <= diasMax; i++) {
    // Meio-dia evita que a soma de dias tropece numa virada de fuso.
    const referencia = new Date(
      instanteLocal(l.ano, l.mes, l.dia, 12 * 60, fuso).getTime() + i * 86_400_000,
    );
    const dia = relogioLocal(referencia, fuso);
    const conf = expediente[String(dia.diaDaSemana)];
    if (!conf || conf.closed) continue;

    const abreMin = minutosDe(conf.open);
    const fechaMin = minutosDe(conf.close);
    if (fechaMin <= abreMin) continue; // configuração inválida: dia ignorado

    yield {
      abre: instanteLocal(dia.ano, dia.mes, dia.dia, abreMin, fuso),
      fecha: instanteLocal(dia.ano, dia.mes, dia.dia, fechaMin, fuso),
    };
  }
}

/** Até onde o gerador procura antes de desistir — 60 dias cobre férias longas. */
const DIAS_DE_BUSCA = 60;

/**
 * Quando este lead tem que ter recebido o primeiro contato.
 *
 * Consome `minutos` de expediente a partir de `criadoEm`. Lead que chega com a
 * loja fechada começa a contar na próxima abertura.
 *
 * Devolve `null` quando o expediente não tem um único dia aberto nos próximos
 * 60 dias — sem hora de funcionamento não existe prazo a cobrar, e inventar um
 * produziria alarme sobre uma loja que nunca abriu.
 */
export function calcularPrazoDeResposta(
  criadoEm: Date,
  minutos: number,
  expediente: Expediente = EXPEDIENTE_PADRAO,
  fuso: string = FUSO_PADRAO,
): Date | null {
  if (!(minutos > 0)) return null;

  let restante = minutos;

  for (const janela of janelas(criadoEm, expediente, fuso, DIAS_DE_BUSCA)) {
    if (janela.fecha <= criadoEm) continue;

    const entra = janela.abre > criadoEm ? janela.abre : criadoEm;
    const disponiveis = (janela.fecha.getTime() - entra.getTime()) / 60000;

    if (disponiveis >= restante) {
      return new Date(entra.getTime() + restante * 60000);
    }
    restante -= disponiveis;
  }

  return null;
}

/* ── Etiqueta do lead na tela ─────────────────────────────── */

export const SLA_SITUACOES = [
  'sem_prazo',
  'no_prazo',
  'vencendo',
  'estourado',
  'respondido',
  'respondido_fora_do_prazo',
] as const;

export type SlaSituacao = (typeof SLA_SITUACOES)[number];

/** A partir de quanto do prazo restante a etiqueta vira "vencendo". */
export const FRACAO_DE_ALERTA = 0.25;

/** Nunca menos de um minuto de aviso, mesmo com prazo curtíssimo. */
const ALERTA_MINIMO_SEGUNDOS = 60;

/**
 * Quanto tempo antes do prazo a etiqueta passa a avisar.
 *
 * A API calcula isto a partir do prazo configurado pela loja e manda junto da
 * lista. Sem esse número, a tela estimaria o alerta sobre `prazo − criadoEm`,
 * que num lead recebido de madrugada é a noite inteira — a etiqueta diria
 * "no prazo" sobre um lead que o filtro "vencendo" já traz.
 */
export function limiteDeAlertaSegundos(slaMinutos: number): number {
  return Math.max(ALERTA_MINIMO_SEGUNDOS, Math.round(slaMinutos * 60 * FRACAO_DE_ALERTA));
}

/**
 * Em que pé está o prazo deste lead.
 *
 * A mesma função serve à lista (etiqueta), ao card (tempo restante) e ao
 * relatório — e é o que impede a tela de chamar de "no prazo" o que a API já
 * contabilizou como estourado.
 */
export function situacaoDoSla(
  lead: {
    criadoEm: Date | string;
    prazo: Date | string | null;
    respondidoEm: Date | string | null;
  },
  agora: Date = new Date(),
  /**
   * Quantos segundos antes do prazo a etiqueta vira "vencendo". Vem da API,
   * calculada sobre o prazo configurado pela loja — é o que faz a etiqueta e o
   * filtro "vencendo" concordarem. Sem ela, cai em um quarto da janela real do
   * lead, que serve para um lead criado dentro do expediente e exagera para um
   * criado de madrugada.
   */
  alertaSegundos?: number,
): { situacao: SlaSituacao; restanteSegundos: number | null } {
  const prazo = lead.prazo ? new Date(lead.prazo) : null;
  const respondido = lead.respondidoEm ? new Date(lead.respondidoEm) : null;

  if (respondido) {
    return {
      situacao: prazo && respondido > prazo ? 'respondido_fora_do_prazo' : 'respondido',
      restanteSegundos: null,
    };
  }
  if (!prazo) return { situacao: 'sem_prazo', restanteSegundos: null };

  const restanteSegundos = Math.round((prazo.getTime() - agora.getTime()) / 1000);
  if (restanteSegundos <= 0) return { situacao: 'estourado', restanteSegundos };

  const total = (prazo.getTime() - new Date(lead.criadoEm).getTime()) / 1000;
  const limiteDeAlerta = alertaSegundos ?? Math.max(ALERTA_MINIMO_SEGUNDOS, total * FRACAO_DE_ALERTA);

  return {
    situacao: restanteSegundos <= limiteDeAlerta ? 'vencendo' : 'no_prazo',
    restanteSegundos,
  };
}

/**
 * Interações que contam como primeira resposta.
 *
 * Nota interna **não** entra, de propósito: escrever "cliente parece quente" no
 * sistema não é falar com o cliente, e contá-la transformaria o indicador em
 * medida de quem digita mais. `visit` também fica de fora — quem apareceu foi
 * o cliente. Mensagem do vendedor no chat conta, e é registrada como `whatsapp`
 * ou `email` conforme o canal; ver `LEAD_INTERACTION_KINDS`.
 */
export const INTERACOES_DE_PRIMEIRA_RESPOSTA = [
  'call',
  'whatsapp',
  'email',
  'chat',
] as const;

export function contaComoPrimeiraResposta(kind: string): boolean {
  return (INTERACOES_DE_PRIMEIRA_RESPOSTA as readonly string[]).includes(kind);
}
