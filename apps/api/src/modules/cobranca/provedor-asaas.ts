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
 * ⚠ **Escrito sem conta e sem sandbox** (25/09/2026): nenhuma chamada deste
 * arquivo jamais saiu para a Asaas. O que está aqui veio da documentação
 * pública, e a lista do que precisa ser conferido com uma conta em mãos está
 * em `docs/decisoes/2026-09-25 cobranca e bloqueio por vencimento.md`.
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
    return { idExterno: r.id, proximoVencimento: deDataAsaas(r.nextDueDate) };
  }

  /**
   * A fatura em aberto (ou a última gerada), com o link de pagamento.
   *
   * `GET /subscriptions/:id/payments` devolve as cobranças da assinatura; a
   * `invoiceUrl` é a página onde o cliente escolhe Pix, boleto ou cartão — é
   * ela que a tela mostra, e não um código Pix copiado por nós: renderizar
   * meio de pagamento é trabalho de quem tem certificação PCI.
   */
  async faturaAtual(idAssinaturaExterna: string): Promise<FaturaDoGateway | null> {
    const r = await this.chamar('GET', `/subscriptions/${idAssinaturaExterna}/payments?limit=10`);
    const lista = r.data ?? [];
    if (lista.length === 0) return null;

    const emAberto = lista.find((p) => statusDaFatura(p.status) === 'pendente' || statusDaFatura(p.status) === 'vencida');
    return this.paraFatura(emAberto ?? lista[0]!);
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
   * Assinatura que já não existe (404) é no-op: cancelar duas vezes não é erro.
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
    const ocorrido = payload.dateCreated ? new Date(payload.dateCreated) : new Date();

    return {
      tipo,
      // A Asaas manda `id` do evento nas entregas com fila ativada. Sem ele,
      // quem chama cai no SHA-256 do corpo cru.
      idEvento: payload.id,
      idAssinaturaExterna: p?.subscription ?? payload.subscription?.id,
      referencia: p?.externalReference ?? payload.subscription?.externalReference,
      fatura: p ? (this.paraFatura(p) ?? undefined) : undefined,
      ocorridoEm: Number.isNaN(ocorrido.getTime()) ? new Date() : ocorrido,
    };
  }
}
