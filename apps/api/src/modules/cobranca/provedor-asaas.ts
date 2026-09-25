import {
  BadRequestException, HttpException, Logger, UnauthorizedException,
} from '@nestjs/common';
import {
  deCentavos, emCentavos,
  type AssinaturaNoGateway, type CabecalhosDeCobranca, type ClienteDeCobranca,
  type EventoDeCobranca, type FaturaDoGateway, type MeioDePagamento, type NovaAssinatura,
  type ProvedorDeCobranca, type StatusDeFatura, type TipoEventoCobranca,
} from '@autoconnect/shared';
import { CABECALHO_TOKEN_ASAAS, tokenConfere } from './token-webhook';

/**
 * Adaptador da Asaas (API v3).
 *
 * Referência: https://docs.asaas.com/reference/comece-por-aqui
 *
 * Tudo o que é formato da Asaas mora aqui. O resto do sistema vê só o
 * vocabulário de `ProvedorDeCobranca`.
 *
 * ✅ **Validado contra o sandbox real em 25/09/2026** — ciclo inteiro (salvar
 * cliente, atualizar, criar assinatura, ler fatura, confirmar o pagamento pelo
 * recurso de sandbox, cancelar duas vezes e limpar). O que divergiu da
 * documentação está anotado abaixo, campo a campo. O que **não** deu para
 * validar: a entrega real do webhook, porque a URL cadastrada na conta aponta
 * para produção. Ver `docs/decisoes/2026-09-25 cobranca e bloqueio por
 * vencimento.md`.
 *
 * ── Autenticação ────────────────────────────────────────────────────
 * Chamada: chave crua no cabeçalho `access_token` (não é `Bearer`).
 * Webhook: a Asaas devolve, em toda entrega, o token cadastrado junto do
 * webhook, no cabeçalho `asaas-access-token`. Ela **não** assina o corpo —
 * por isso a conferência é de token, e não de HMAC como na Clicksign.
 */

const TIMEOUT_PADRAO_MS = 20_000;

/** Meios aceitos pela Asaas. `UNDEFINED` deixa o cliente escolher na fatura. */
const PARA_ASAAS: Record<MeioDePagamento, string> = {
  pix: 'PIX',
  boleto: 'BOLETO',
  cartao: 'CREDIT_CARD',
  indefinido: 'UNDEFINED',
};

const DA_ASAAS: Record<string, MeioDePagamento> = {
  PIX: 'pix',
  BOLETO: 'boleto',
  CREDIT_CARD: 'cartao',
  UNDEFINED: 'indefinido',
};

/**
 * Eventos do webhook de cobranças → evento normalizado.
 *
 * `PAYMENT_CONFIRMED` (pago, dinheiro ainda não disponível) e
 * `PAYMENT_RECEIVED` (disponível na conta) **liberam os dois**: para o
 * cliente, o pagamento já aconteceu, e segurar a loja bloqueada até o dinheiro
 * compensar puniria quem pagou. Os dois chegam para a mesma fatura, e a
 * idempotência por `(provider, event_key)` cuida da repetição.
 *
 * `PAYMENT_DELETED` e `PAYMENT_RESTORED` ficam fora: são mexidas da loja no
 * painel da Asaas, não decisões de acesso.
 */
export const EVENTOS_ASAAS: Record<string, TipoEventoCobranca> = {
  PAYMENT_CONFIRMED: 'pagamento_confirmado',
  PAYMENT_RECEIVED: 'pagamento_confirmado',
  PAYMENT_ANTICIPATED: 'pagamento_confirmado',
  PAYMENT_OVERDUE: 'pagamento_vencido',
  PAYMENT_REFUNDED: 'reembolso',
  PAYMENT_PARTIALLY_REFUNDED: 'reembolso',
  PAYMENT_CHARGEBACK_REQUESTED: 'reembolso',
  SUBSCRIPTION_DELETED: 'assinatura_cancelada',
};

export interface ConfigAsaas {
  /** Base **sem** `/v3`, ex.: `https://api-sandbox.asaas.com`. */
  apiUrl: string;
  /** Chave da API (`$aact_...`). Nunca sai em log nem em mensagem de erro. */
  apiKey: string;
  /** O token cadastrado no webhook da Asaas. */
  tokenWebhook: string;
  timeoutMs?: number;
  /** Injetável para teste; o padrão é o `fetch` global do Node 20. */
  fetch?: typeof fetch;
}

/** Erro de chamada à Asaas. A mensagem nunca carrega a chave. */
export class ErroAsaas extends HttpException {
  constructor(mensagem: string, status: number, readonly statusAsaas?: number) {
    super(mensagem, status);
  }
}

interface RespostaAsaas {
  id?: string;
  status?: string;
  value?: number;
  dueDate?: string;
  paymentDate?: string;
  clientPaymentDate?: string;
  billingType?: string;
  invoiceUrl?: string;
  nextDueDate?: string;
  description?: string;
  subscription?: string;
  externalReference?: string;
  errors?: { code?: string; description?: string }[];
  data?: RespostaAsaas[];
}

interface PayloadWebhookAsaas {
  id?: string;
  event?: string;
  dateCreated?: string;
  payment?: RespostaAsaas;
  subscription?: RespostaAsaas;
}

/** A Asaas fala em reais com duas casas; o sistema fala em centavos. */
export function paraReais(centavos: bigint): number {
  return Number(deCentavos(centavos));
}

/** `"2026-10-05"` — o formato de data da Asaas, em UTC para não pular o dia. */
export function dataAsaas(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `"2026-10-05"` de volta, ao meio-dia UTC: nenhum fuso do Brasil muda o dia. */
function deDataAsaas(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Fuso das datas da Asaas: a conta é brasileira e ela não manda offset. */
const OFFSET_ASAAS = '-03:00';

/**
 * `dateCreated` do **evento** do webhook: `"2026-10-05 14:30:00"`.
 *
 * Note o espaço e a **ausência de fuso** — a Asaas renderiza no horário da
 * conta (Brasília) e omite o offset. Jogar isso em `new Date()` faz o V8
 * interpretar como horário **local do servidor**: o mesmo evento viraria um
 * instante em São Paulo (dev) e outro em UTC (Railway), com 3 horas de
 * diferença. Como `ocorridoEm` é o que abre a carência quando o evento chega
 * sem fatura, o instante tem de ser o mesmo nos dois lugares.
 *
 * Por isso o offset entra explícito. Data pura (`"2026-10-05"`) cai no
 * meio-dia UTC, como no resto do adaptador.
 */
export function deDataHoraAsaas(s: string | undefined): Date | null {
  if (!s) return null;
  const texto = s.trim();

  // Já veio com fuso (Z ou ±HH:MM)? Respeita o que veio.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(texto)) {
    const comFuso = new Date(texto);
    return Number.isNaN(comFuso.getTime()) ? null : comFuso;
  }

  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(texto);
  if (!m) return null;

  const d = m[2]
    ? new Date(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}${OFFSET_ASAAS}`)
    : new Date(`${m[1]}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function statusDaFatura(status: string | undefined): StatusDeFatura {
  switch (status) {
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
      return 'paga';
    case 'OVERDUE':
      return 'vencida';
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'CHARGEBACK_REQUESTED':
      return 'estornada';
    case 'DELETED':
      return 'cancelada';
    default:
      return 'pendente';
  }
}

export class ProvedorAsaas implements ProvedorDeCobranca {
  readonly nome = 'asaas';
  readonly disponivel = true;
  readonly sandbox: boolean;

  private readonly logger = new Logger(ProvedorAsaas.name);
  private readonly base: string;
  private readonly buscar: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigAsaas) {
    this.base = `${config.apiUrl.replace(/\/+$/, '')}/v3`;
    this.buscar = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? TIMEOUT_PADRAO_MS;
    this.sandbox = /sandbox/i.test(config.apiUrl);
  }

  /* ── HTTP ─────────────────────────────────────────────────── */

  private async chamar(
    metodo: 'GET' | 'POST' | 'DELETE',
    caminho: string,
    corpo?: unknown,
  ): Promise<RespostaAsaas> {
    const controlador = new AbortController();
    const relogio = setTimeout(() => controlador.abort(), this.timeoutMs);

    let resposta: Response;
    try {
      resposta = await this.buscar(`${this.base}${caminho}`, {
        method: metodo,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          access_token: this.config.apiKey,
          // A Asaas pede identificação do integrador nas chamadas.
          'User-Agent': 'AutoConnect/1.0 (NestJS)',
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controlador.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new ErroAsaas(`A Asaas não respondeu em ${this.timeoutMs / 1000}s.`, 504);
      }
      throw new ErroAsaas(`Falha de rede ao falar com a Asaas: ${(err as Error).message}`, 502);
    } finally {
      clearTimeout(relogio);
    }

    const texto = await resposta.text();
    let dados: RespostaAsaas = {};
    if (texto) {
      try {
        dados = JSON.parse(texto) as RespostaAsaas;
      } catch {
        if (resposta.ok) throw new ErroAsaas('A Asaas devolveu uma resposta que não é JSON.', 502);
      }
    }

    if (!resposta.ok) throw this.traduzirErro(resposta.status, dados);
    return dados;
  }

  /**
   * Erro da Asaas → erro do sistema. O `description` dela entra na mensagem
   * (é o que diz "CPF/CNPJ inválido"); a chave, nunca.
   */
  private traduzirErro(status: number, dados: RespostaAsaas): HttpException {
    const detalhe = dados.errors?.map((e) => e.description).filter(Boolean).join('; ');
    const sufixo = detalhe ? ` ${detalhe}` : '';

    if (status === 400 || status === 422) {
      return new ErroAsaas(`A Asaas recusou os dados da cobrança.${sufixo}`, 422, status);
    }
    if (status === 401 || status === 403) {
      return new ErroAsaas(
        'A Asaas recusou a credencial — verifique ASAAS_API_KEY e se a chave é do ambiente certo.',
        503, status,
      );
    }
    if (status === 429) {
      return new ErroAsaas('A Asaas está limitando as chamadas. Tente de novo em instantes.', 503, status);
    }
    return new ErroAsaas(`A Asaas respondeu ${status}.${sufixo}`, 502, status);
  }

  /* ── Cliente ──────────────────────────────────────────────── */

  async salvarCliente(dados: ClienteDeCobranca, idExterno?: string | null): Promise<{ idExterno: string }> {
    const corpo = {
      name: dados.nome,
      email: dados.email,
      cpfCnpj: dados.cnpj.replace(/\D/g, ''),
      mobilePhone: dados.telefone?.replace(/\D/g, '') || undefined,
      postalCode: dados.cep?.replace(/\D/g, '') || undefined,
      // Referência externa: é por ela que se reencontra a loja no painel da
      // Asaas sem precisar casar por nome ou CNPJ.
      externalReference: dados.referencia,
      notificationDisabled: false,
    };

    // A Asaas atualiza com POST no cliente existente; sem id, cria.
    // Confirmado no sandbox (25/09/2026): o segundo POST em
    // `/customers/cus_...` devolveu **o mesmo id** com os campos novos, e a
    // busca por `externalReference` continuou trazendo um cliente só.
    const r = await this.chamar('POST', idExterno ? `/customers/${idExterno}` : '/customers', corpo);
    if (!r.id) throw new ErroAsaas('A Asaas criou o cliente sem devolver o id.', 502);
    return { idExterno: r.id };
  }

  /* ── Assinatura ───────────────────────────────────────────── */

  async criarAssinatura(nova: NovaAssinatura): Promise<AssinaturaNoGateway> {
    const r = await this.chamar('POST', '/subscriptions', {
      customer: nova.idClienteExterno,
      billingType: PARA_ASAAS[nova.meio],
      value: paraReais(nova.valorCentavos),
      nextDueDate: dataAsaas(nova.primeiroVencimento),
      cycle: 'MONTHLY',
      description: nova.descricao,
      externalReference: nova.referencia,
    });

    if (!r.id) throw new ErroAsaas('A Asaas criou a assinatura sem devolver o id.', 502);
    // ⚠ O `nextDueDate` da resposta **não** é o vencimento da cobrança que
    // acabou de nascer: a Asaas já gera a primeira e avança o ciclo. Sandbox,
    // 25/09/2026 — enviamos `2026-09-28`, a cobrança saiu com
    // `dueDate: 2026-09-28` e a assinatura respondeu `nextDueDate: 2026-10-28`.
    // Quem precisa do primeiro vencimento usa o que pediu (ver
    // `AssinaturaNoGateway.proximoVencimento`).
    return { idExterno: r.id, proximoVencimento: deDataAsaas(r.nextDueDate) };
  }

  /**
   * A fatura em aberto (ou a última gerada), com o link de pagamento.
   *
   * `GET /subscriptions/:id/payments` devolve as cobranças da assinatura; a
   * `invoiceUrl` é a página onde o cliente escolhe Pix, boleto ou cartão — é
   * ela que a tela mostra, e não um código Pix copiado por nós: renderizar
   * meio de pagamento é trabalho de quem tem certificação PCI.
   *
   * Envelope confirmado no sandbox (25/09/2026):
   * `{ object: 'list', hasMore, totalCount, limit, offset, data: [...] }`. A
   * `invoiceUrl` veio preenchida inclusive com `billingType: UNDEFINED`, que é
   * o nosso padrão. Assinatura inexistente devolve **200 com `data: []`** (não
   * 404), e aí a resposta é `null`.
   */
  async faturaAtual(idAssinaturaExterna: string): Promise<FaturaDoGateway | null> {
    const r = await this.chamar('GET', `/subscriptions/${idAssinaturaExterna}/payments?limit=10`);
    const lista = r.data ?? [];
    if (lista.length === 0) return null;

    const emAberto = lista.find((p) => statusDaFatura(p.status) === 'pendente' || statusDaFatura(p.status) === 'vencida');
    if (emAberto) return this.paraFatura(emAberto);

    // Nenhuma em aberto: a mais recente. A ordem da lista não é contrato da
    // Asaas, então ordenar aqui é o que torna a escolha a mesma sempre.
    const maisRecente = [...lista].sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? ''))[0]!;
    return this.paraFatura(maisRecente);
  }

  private paraFatura(p: RespostaAsaas): FaturaDoGateway | null {
    if (!p.id) return null;
    const vencimento = deDataAsaas(p.dueDate);
    return {
      idExterno: p.id,
      status: statusDaFatura(p.status),
      valorCentavos: emCentavos((p.value ?? 0).toFixed(2)),
      vencimento: vencimento ?? new Date(),
      pagoEm: deDataAsaas(p.paymentDate ?? p.clientPaymentDate),
      meio: DA_ASAAS[p.billingType ?? 'UNDEFINED'] ?? 'indefinido',
      urlPagamento: p.invoiceUrl ?? null,
    };
  }

  /**
   * Cancelar remove a assinatura na Asaas — as cobranças futuras deixam de ser
   * geradas. As faturas já pagas continuam no histórico dela e no nosso.
   *
   * Validado no sandbox (25/09/2026): `DELETE` responde **200
   * `{ deleted: true, id }`**, e repetir o `DELETE` na mesma assinatura responde
   * **200 de novo** — a Asaas já é idempotente aqui, o duplo clique não
   * incomoda ninguém. O 404 acontece com id que nunca existiu, e vem com
   * **corpo vazio**; segue tratado como no-op, que é o certo para
   * "cancele isto" sobre algo que não está mais lá.
   */
  async cancelarAssinatura(idAssinaturaExterna: string): Promise<void> {
    try {
      await this.chamar('DELETE', `/subscriptions/${idAssinaturaExterna}`);
    } catch (err) {
      if (err instanceof ErroAsaas && err.statusAsaas === 404) {
        this.logger.warn(`Assinatura ${idAssinaturaExterna} já não existe na Asaas — cancelamento é no-op.`);
        return;
      }
      throw err;
    }
  }

  /* ── Webhook ──────────────────────────────────────────────── */

  interpretarWebhook(cabecalhos: CabecalhosDeCobranca, corpoCru: Uint8Array): EventoDeCobranca {
    if (!tokenConfere(cabecalhos, CABECALHO_TOKEN_ASAAS, this.config.tokenWebhook)) {
      throw new UnauthorizedException('Token do webhook de cobrança não confere.');
    }

    let payload: PayloadWebhookAsaas;
    try {
      payload = JSON.parse(Buffer.from(corpoCru).toString('utf8')) as PayloadWebhookAsaas;
    } catch {
      throw new BadRequestException('Corpo do webhook não é JSON.');
    }

    const nome = payload?.event;
    if (!nome) throw new BadRequestException('Webhook sem evento.');

    const tipo = Object.prototype.hasOwnProperty.call(EVENTOS_ASAAS, nome)
      ? EVENTOS_ASAAS[nome]!
      : 'ignorado';

    const p = payload.payment;

    return {
      tipo,
      // A Asaas manda `id` do evento em toda entrega (`evt_<hash>&<n>`) e a
      // própria doc manda usá-lo contra processamento duplicado. Sem ele, quem
      // chama cai no SHA-256 do corpo cru.
      idEvento: payload.id,
      idAssinaturaExterna: p?.subscription ?? payload.subscription?.id,
      referencia: p?.externalReference ?? payload.subscription?.externalReference,
      fatura: p ? (this.paraFatura(p) ?? undefined) : undefined,
      ocorridoEm: deDataHoraAsaas(payload.dateCreated) ?? new Date(),
    };
  }
}
