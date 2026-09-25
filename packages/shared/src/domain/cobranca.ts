/**
 * Cobrança da assinatura da loja — o contrato que o gateway tem de cumprir,
 * não o formato dele.
 *
 * Mesmo desenho da assinatura eletrônica e da consulta veicular: o resto do
 * sistema fala este vocabulário e nunca vê o payload do gateway. O formato é
 * inspirado no da Asaas (cliente, assinatura mensal, fatura com link de
 * pagamento, webhook autenticado por token em cabeçalho), que é o gateway
 * escolhido, mas nada aqui é específico dela — trocar de gateway é escrever
 * outro adaptador.
 *
 * `Uint8Array` e não `Buffer` nas assinaturas de tipo: este pacote também vai
 * para o navegador.
 */

/* ── Faixas de preço ──────────────────────────────────────────── */

/**
 * Planos pagos. Repete o enum `SubscriptionPlan` do Prisma menos o `trial` —
 * `paridade-enums.spec.ts` quebra se o conjunto divergir.
 *
 * Os nomes são os comerciais, e não `starter`/`pro`/`enterprise`: a migration
 * `cobranca_asaas` renomeou os valores do enum justamente para que o que está
 * no banco seja o que está na tabela de preços. Um `plan = 'enterprise'`
 * significando "Pro" seria uma tradução a mais para errar.
 */
export const PLANOS_PAGOS = ['essencial', 'crescimento', 'profissional'] as const;
export type PlanoPago = (typeof PLANOS_PAGOS)[number];

export interface FaixaDePlano {
  plano: PlanoPago;
  nome: string;
  /** Em centavos: dinheiro nunca é `number` de ponto flutuante. */
  precoMensalCentavos: bigint;
  /** Teto de veículos **não arquivados**; `null` = ilimitado. */
  limiteVeiculos: number | null;
  /** Frase curta para o cartão do plano na tela. */
  resumo: string;
}

/**
 * A tabela de preços. **Este é o único lugar onde os valores moram** — a API,
 * a tela da loja, o painel do super admin e o adaptador do gateway leem daqui.
 *
 * Cobrança **por loja**, com faixa por volume de estoque e usuários
 * ilimitados: num setor de alta rotatividade de vendedor, cobrar por assento
 * faz a loja evitar cadastrar gente (ver
 * `docs/planos/levantamento-crms-e-paridade.md`, §5).
 */
export const CATALOGO_DE_PLANOS: Record<PlanoPago, FaixaDePlano> = {
  essencial: {
    plano: 'essencial',
    nome: 'Essencial',
    precoMensalCentavos: 27_900n,
    limiteVeiculos: 30,
    resumo: 'Para a loja que gira até 30 carros no pátio.',
  },
  crescimento: {
    plano: 'crescimento',
    nome: 'Crescimento',
    precoMensalCentavos: 47_900n,
    limiteVeiculos: 80,
    resumo: 'Para quem passou dos 30 e ainda cabe em 80.',
  },
  profissional: {
    plano: 'profissional',
    nome: 'Pro',
    precoMensalCentavos: 79_900n,
    limiteVeiculos: null,
    resumo: 'Estoque ilimitado, sem teto de anúncios.',
  },
};

export const FAIXAS = PLANOS_PAGOS.map((p) => CATALOGO_DE_PLANOS[p]);

export function ehPlanoPago(plano: string): plano is PlanoPago {
  return (PLANOS_PAGOS as readonly string[]).includes(plano);
}

/**
 * Teto de veículos do plano. `null` = sem teto.
 *
 * O trial roda com o teto da menor faixa: quem avalia o produto precisa
 * descobrir o limite **antes** de pagar, não depois. Se o trial fosse
 * ilimitado, a loja subiria 60 carros em 14 dias e a primeira experiência
 * depois de pagar seria "não posso publicar".
 */
export function limiteDeVeiculos(plano: string): number | null {
  if (ehPlanoPago(plano)) return CATALOGO_DE_PLANOS[plano].limiteVeiculos;
  return CATALOGO_DE_PLANOS.essencial.limiteVeiculos;
}

/**
 * A menor faixa que comporta este estoque, ou `null` quando nenhuma comporta
 * (só acontece se o catálogo perder a faixa ilimitada). É o que a tela usa
 * para dizer "seu estoque pede o plano X".
 */
export function faixaParaEstoque(veiculos: number): FaixaDePlano | null {
  return FAIXAS.find((f) => f.limiteVeiculos === null || veiculos <= f.limiteVeiculos) ?? null;
}

/**
 * O que conta para o limite: veículo **não arquivado**.
 *
 * `archived` é a lixeira do estoque — o carro que a loja não tem mais, mantido
 * só para o histórico de negócios e relatórios não ficarem com buracos. Cobrar
 * por ele empurraria a loja a apagar o passado para caber na faixa, e apagar
 * histórico é justamente o que não queremos incentivar.
 *
 * **Rascunho conta.** Um anúncio em `draft` é um carro que está no pátio; o
 * que ele não tem é foto ou preço. Se rascunho não contasse, a loja inteira
 * caberia no Essencial com 200 carros "quase publicados", e o limite
 * significaria "quantos anúncios você tem no ar", que não é o que a faixa
 * vende (estoque sob gestão).
 */
export const STATUS_QUE_CONTA_NO_LIMITE = ['available', 'reserved', 'sold', 'in_maintenance'] as const;

export interface UsoDoEstoque {
  usados: number;
  limite: number | null;
  /** `true` quando publicar mais um estouraria a faixa. */
  noLimite: boolean;
  /** `true` quando o estoque atual já passou da faixa (mudança de plano para baixo). */
  excedido: boolean;
}

export function usoDoEstoque(plano: string, usados: number): UsoDoEstoque {
  const limite = limiteDeVeiculos(plano);
  return {
    usados,
    limite,
    noLimite: limite !== null && usados >= limite,
    excedido: limite !== null && usados > limite,
  };
}

/* ── Ciclo de vida da assinatura ──────────────────────────────── */

/**
 * Dias entre o vencimento da fatura e o bloqueio.
 *
 * Boleto compensa em até 3 dias úteis e Pix cai na hora, mas quem paga no dia
 * do vencimento numa sexta pode ver o crédito só na terça. Sete dias cobrem
 * isso com folga e ainda dão uma semana para quem simplesmente esqueceu —
 * bloquear um cliente que ia pagar custa muito mais que uma semana de uso.
 */
export const DIAS_DE_CARENCIA = 7;

/** Quantos dias antes do fim do trial (e do vencimento) o aviso aparece. */
export const DIAS_DE_AVISO_ANTES = 3;

/**
 * Espelho de `SubscriptionStatus` do Prisma.
 *
 * - `active`: trial em dia ou assinatura paga.
 * - `past_due`: fatura vencida. Ainda **não** bloqueia — a carência decide.
 * - `canceled`: a loja cancelou, ou o trial acabou sem assinatura.
 * - `paused`: reservado; hoje nada o produz.
 */
export const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'canceled', 'paused'] as const;
export type SubscriptionStatusValue = (typeof SUBSCRIPTION_STATUSES)[number];

/** O que o sistema faz com a loja agora. */
export const SITUACOES_DE_COBRANCA = [
  'trial',
  'trial_terminando',
  'ativa',
  'em_carencia',
  'somente_leitura',
] as const;
export type SituacaoDeCobranca = (typeof SITUACOES_DE_COBRANCA)[number];

export interface AssinaturaParaAvaliar {
  plan: string;
  status: string;
  trialEndsAt?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  /** Fim da carência, gravado quando a fatura vence. */
  graceUntil?: Date | string | null;
}

export interface Veredito {
  situacao: SituacaoDeCobranca;
  /** A loja continua vendo e exportando tudo; só não cria nem edita. */
  somenteLeitura: boolean;
  /** Dias inteiros até o próximo marco (fim do trial ou da carência). Negativo = passou. */
  diasRestantes: number | null;
  /** O marco em si, para a tela mostrar a data. */
  prazoAte: Date | null;
  /** Frase pronta para a faixa no painel. `null` quando não há nada a avisar. */
  aviso: string | null;
}

function paraData(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Dias inteiros de `agora` até `alvo`, arredondando para cima. */
function diasAte(alvo: Date, agora: Date): number {
  return Math.ceil((alvo.getTime() - agora.getTime()) / 86_400_000);
}

/**
 * O que acontece com a loja, dado o estado da assinatura.
 *
 * Pura e sem banco de propósito: é a mesma função que decide o bloqueio na
 * API, a faixa de aviso no painel e a coluna do painel do super admin. Três
 * cópias desta regra seria três chances de a tela dizer "tudo certo" enquanto
 * a API responde 402.
 *
 * As regras, na ordem:
 *
 * 1. **Plano pago com status `active` é a loja em dia**, sem mais perguntas —
 *    inclusive quando o super admin trocou o plano à mão, que é o caminho de
 *    desbloqueio manual e precisa continuar funcionando depois do bloqueio.
 * 2. **Trial** vale enquanto `trialEndsAt` não passou. Nos últimos
 *    `DIAS_DE_AVISO_ANTES` dias vira `trial_terminando` — é a mesma situação,
 *    só com aviso.
 * 3. **Vencido** (trial acabado sem plano pago, ou fatura em `past_due`) entra
 *    em **carência** até `graceUntil`. Passou disso, `somente_leitura`.
 * 4. **Cancelada** é somente leitura na hora: o cancelamento é do cliente, e
 *    ele sabe o que escolheu. Os dados continuam todos lá.
 */
export function avaliarCobranca(
  assinatura: AssinaturaParaAvaliar | null | undefined,
  agora: Date = new Date(),
): Veredito {
  // Loja sem linha de assinatura: dado antigo, anterior ao autosserviço. Não
  // bloqueia — inventar um bloqueio para quem nunca teve trial trancaria um
  // cliente por causa de uma migração.
  if (!assinatura) {
    return { situacao: 'ativa', somenteLeitura: false, diasRestantes: null, prazoAte: null, aviso: null };
  }

  const pago = ehPlanoPago(assinatura.plan);
  const trialAte = paraData(assinatura.trialEndsAt);
  const carenciaAte = paraData(assinatura.graceUntil);

  if (assinatura.status === 'canceled') {
    return {
      situacao: 'somente_leitura',
      somenteLeitura: true,
      diasRestantes: null,
      prazoAte: null,
      aviso:
        'Sua assinatura está cancelada. A loja está em modo somente leitura: ' +
        'você continua vendo e exportando tudo, mas não é possível cadastrar nem editar.',
    };
  }

  if (pago && assinatura.status === 'active') {
    return { situacao: 'ativa', somenteLeitura: false, diasRestantes: null, prazoAte: null, aviso: null };
  }

  // Plano pago com fatura vencida, ou trial que acabou: a carência manda.
  const vencido = pago
    ? assinatura.status === 'past_due'
    : !trialAte || trialAte.getTime() <= agora.getTime();

  if (vencido) {
    const fim = carenciaAte ?? somarDias(trialAte ?? agora, pago ? DIAS_DE_CARENCIA : 0);
    const dias = diasAte(fim, agora);

    if (fim.getTime() > agora.getTime()) {
      return {
        situacao: 'em_carencia',
        somenteLeitura: false,
        diasRestantes: dias,
        prazoAte: fim,
        aviso: pago
          ? `Sua fatura está vencida. Você tem ${dias} dia${dias === 1 ? '' : 's'} para pagar ` +
            'antes que a loja entre em modo somente leitura.'
          : `Seu período de teste acabou. Você tem ${dias} dia${dias === 1 ? '' : 's'} para ` +
            'escolher um plano antes que a loja entre em modo somente leitura.',
      };
    }

    return {
      situacao: 'somente_leitura',
      somenteLeitura: true,
      diasRestantes: dias,
      prazoAte: fim,
      aviso: pago
        ? 'Sua fatura continua em aberto e a loja está em modo somente leitura. ' +
          'Nada foi apagado — pague a fatura e tudo volta na hora.'
        : 'Seu período de teste acabou e a loja está em modo somente leitura. ' +
          'Nada foi apagado — escolha um plano e tudo volta na hora.',
    };
  }

  // Trial em dia.
  const dias = trialAte ? diasAte(trialAte, agora) : null;
  const terminando = dias !== null && dias <= DIAS_DE_AVISO_ANTES;

  return {
    situacao: terminando ? 'trial_terminando' : 'trial',
    somenteLeitura: false,
    diasRestantes: dias,
    prazoAte: trialAte,
    aviso: terminando
      ? `Seu período de teste termina em ${dias} dia${dias === 1 ? '' : 's'}. ` +
        'Escolha um plano para não perder o acesso de escrita.'
      : null,
  };
}

export function somarDias(base: Date, dias: number): Date {
  return new Date(base.getTime() + dias * 86_400_000);
}

/* ── O provedor ───────────────────────────────────────────────── */

export const MEIOS_DE_PAGAMENTO = ['pix', 'boleto', 'cartao', 'indefinido'] as const;
export type MeioDePagamento = (typeof MEIOS_DE_PAGAMENTO)[number];

export const ROTULO_MEIO: Record<MeioDePagamento, string> = {
  pix: 'Pix',
  boleto: 'Boleto',
  cartao: 'Cartão de crédito',
  indefinido: 'Pix, boleto ou cartão (você escolhe na hora de pagar)',
};

/** Dados do pagador. O gateway exige CNPJ e e-mail; o resto é melhor esforço. */
export interface ClienteDeCobranca {
  /** Id da loja aqui dentro — vai como referência externa no gateway. */
  referencia: string;
  nome: string;
  email: string;
  /** Só dígitos. */
  cnpj: string;
  telefone?: string | null;
  cep?: string | null;
}

export interface NovaAssinatura {
  idClienteExterno: string;
  plano: PlanoPago;
  /** Em centavos. O adaptador converte para a unidade do gateway. */
  valorCentavos: bigint;
  meio: MeioDePagamento;
  /** Vencimento da primeira cobrança. */
  primeiroVencimento: Date;
  descricao: string;
  /** Id da nossa assinatura — volta nos webhooks como referência externa. */
  referencia: string;
}

export interface AssinaturaNoGateway {
  idExterno: string;
  /**
   * O vencimento do **próximo ciclo**, e não o da fatura que acabou de nascer.
   *
   * ⚠ Validado contra o sandbox da Asaas em 25/09/2026: pedimos
   * `nextDueDate: 2026-09-28`, a Asaas gerou a primeira cobrança para
   * 2026-09-28 **e respondeu `nextDueDate: 2026-10-28`** — ela já avançou o
   * ciclo. Quem quiser o vencimento da primeira fatura tem de usar o que
   * *pediu* (`NovaAssinatura.primeiroVencimento`) ou ler a fatura; usar este
   * campo dá um mês a mais de graça a quem contratou e não pagou.
   *
   * Serve para exibir "próxima cobrança em", nunca para calcular carência.
   */
  proximoVencimento: Date | null;
}

export const STATUS_DE_FATURA = ['pendente', 'paga', 'vencida', 'estornada', 'cancelada'] as const;
export type StatusDeFatura = (typeof STATUS_DE_FATURA)[number];

export const ROTULO_FATURA: Record<StatusDeFatura, string> = {
  pendente: 'Aguardando pagamento',
  paga: 'Paga',
  vencida: 'Vencida',
  estornada: 'Estornada',
  cancelada: 'Cancelada',
};

export interface FaturaDoGateway {
  idExterno: string;
  status: StatusDeFatura;
  valorCentavos: bigint;
  vencimento: Date;
  pagoEm: Date | null;
  meio: MeioDePagamento;
  /** Página de pagamento do gateway (Pix, boleto e cartão numa tela só). */
  urlPagamento: string | null;
}

export const EVENTOS_COBRANCA = [
  'pagamento_confirmado',
  'pagamento_vencido',
  'assinatura_cancelada',
  'reembolso',
  'ignorado',
] as const;
export type TipoEventoCobranca = (typeof EVENTOS_COBRANCA)[number];

/** O que o webhook disse, já traduzido. */
export interface EventoDeCobranca {
  tipo: TipoEventoCobranca;
  /**
   * Id do evento no gateway. É a chave de idempotência; sem ele, quem chama
   * usa o SHA-256 do corpo cru — a mesma entrega repetida tem o mesmo corpo.
   */
  idEvento?: string;
  /** Assinatura no gateway a que o evento se refere, quando há. */
  idAssinaturaExterna?: string;
  /** Referência externa que mandamos na criação — o id da nossa assinatura. */
  referencia?: string;
  fatura?: FaturaDoGateway;
  ocorridoEm: Date;
}

export type CabecalhosDeCobranca = Record<string, string | string[] | undefined>;

/**
 * O que um gateway de cobrança precisa implementar.
 *
 * `interpretarWebhook` confere a autenticidade e **lança** quando ela não
 * confere. O payload do gateway não sai daqui.
 */
export interface ProvedorDeCobranca {
  readonly nome: string;
  /** Falso quando nenhum gateway está configurado: a tela esconde a opção. */
  readonly disponivel: boolean;
  /** Conta de homologação: nada cobrado ali é dinheiro de verdade. */
  readonly sandbox?: boolean;

  /** Cria ou atualiza o cliente no gateway (idempotente pela referência). */
  salvarCliente(dados: ClienteDeCobranca, idExterno?: string | null): Promise<{ idExterno: string }>;
  criarAssinatura(nova: NovaAssinatura): Promise<AssinaturaNoGateway>;
  /** A fatura em aberto (ou a última), com o link de pagamento. */
  faturaAtual(idAssinaturaExterna: string): Promise<FaturaDoGateway | null>;
  cancelarAssinatura(idAssinaturaExterna: string): Promise<void>;
  interpretarWebhook(cabecalhos: CabecalhosDeCobranca, corpoCru: Uint8Array): EventoDeCobranca;
}

/* ── Aplicação do evento ──────────────────────────────────────── */

export interface EstadoDaCobranca {
  status: SubscriptionStatusValue;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
}

export interface ResultadoDoEventoDeCobranca {
  estado: EstadoDaCobranca;
  mudou: boolean;
}

/**
 * Aplica um evento do gateway ao estado da assinatura.
 *
 * Pura e idempotente pelo mesmo motivo da assinatura eletrônica: webhooks
 * chegam repetidos e fora de ordem, e aplicar o mesmo evento duas vezes tem de
 * dar o mesmo estado.
 *
 * - `pagamento_confirmado` **sempre** volta a `active` e limpa a carência, sem
 *   olhar o estado anterior: é o caminho da volta imediata, e é o que faz uma
 *   loja bloqueada voltar no instante em que o Pix cai.
 * - `pagamento_vencido` só marca `past_due` e abre a carência **uma vez** — um
 *   segundo vencido não estende o prazo (senão a loja que nunca paga ganharia
 *   sete dias por mês, para sempre).
 * - `reembolso` e `assinatura_cancelada` levam a `canceled`. Somente leitura
 *   imediata: o dinheiro voltou.
 */
export function aplicarEventoDeCobranca(
  atual: EstadoDaCobranca,
  evento: Pick<EventoDeCobranca, 'tipo' | 'fatura' | 'ocorridoEm'>,
  carenciaDias: number = DIAS_DE_CARENCIA,
): ResultadoDoEventoDeCobranca {
  const igual: ResultadoDoEventoDeCobranca = { estado: atual, mudou: false };

  switch (evento.tipo) {
    case 'pagamento_confirmado': {
      // O período vai até um mês depois do vencimento da fatura paga; sem
      // fatura no evento, um mês a partir de agora.
      const base = evento.fatura?.vencimento ?? evento.ocorridoEm;
      const fim = somarDias(base, 30);
      if (atual.status === 'active' && atual.graceUntil === null &&
          atual.currentPeriodEnd?.getTime() === fim.getTime()) {
        return igual;
      }
      return {
        estado: { status: 'active', currentPeriodEnd: fim, graceUntil: null },
        mudou: true,
      };
    }

    case 'pagamento_vencido': {
      if (atual.status === 'past_due' && atual.graceUntil) return igual;
      return {
        estado: {
          ...atual,
          status: 'past_due',
          graceUntil: somarDias(evento.fatura?.vencimento ?? evento.ocorridoEm, carenciaDias),
        },
        mudou: true,
      };
    }

    case 'reembolso':
    case 'assinatura_cancelada': {
      if (atual.status === 'canceled') return igual;
      return { estado: { ...atual, status: 'canceled', graceUntil: null }, mudou: true };
    }

    case 'ignorado':
      return igual;
  }
}
