import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
  deCentavos, emCentavos,
  type AssinaturaNoGateway, type CabecalhosDeCobranca, type ClienteDeCobranca,
  type EventoDeCobranca, type FaturaDoGateway, type MeioDePagamento, type NovaAssinatura,
  type ProvedorDeCobranca, type StatusDeFatura, type TipoEventoCobranca,
} from '@autoconnect/shared';
import { CABECALHO_TOKEN_ASAAS, tokenConfere } from './token-webhook';

/**
 * Formato do webhook simulado. Imita o da Asaas (`event`, `payment` com
 * `id`, `subscription`, `value`, `dueDate`, `billingType`, `invoiceUrl`) para
 * que o adaptador real seja uma tradução parecida — mas é só isso: nada fora
 * deste arquivo conhece esse formato.
 */
interface PayloadSimulado {
  id?: string;
  event: string;
  dateCreated?: string;
  payment?: {
    id: string;
    subscription?: string;
    externalReference?: string;
    value: number;
    dueDate: string;
    billingType?: string;
    invoiceUrl?: string;
    paymentDate?: string;
  };
  subscription?: { id: string; externalReference?: string };
}

const TRADUCAO: Record<string, TipoEventoCobranca> = {
  PAYMENT_CONFIRMED: 'pagamento_confirmado',
  PAYMENT_RECEIVED: 'pagamento_confirmado',
  PAYMENT_OVERDUE: 'pagamento_vencido',
  PAYMENT_REFUNDED: 'reembolso',
  SUBSCRIPTION_DELETED: 'assinatura_cancelada',
  PAYMENT_CREATED: 'ignorado',
  PAYMENT_UPDATED: 'ignorado',
};

const MEIO_SIMULADO: Record<string, MeioDePagamento> = {
  PIX: 'pix',
  BOLETO: 'boleto',
  CREDIT_CARD: 'cartao',
  UNDEFINED: 'indefinido',
};

const PARA_GATEWAY: Record<MeioDePagamento, string> = {
  pix: 'PIX',
  boleto: 'BOLETO',
  cartao: 'CREDIT_CARD',
  indefinido: 'UNDEFINED',
};

interface AssinaturaEmMemoria {
  idCliente: string;
  valorCentavos: bigint;
  meio: MeioDePagamento;
  referencia: string;
  cancelada: boolean;
  faturas: FaturaDoGateway[];
}

export interface EntregaSimuladaDeCobranca {
  cabecalhos: CabecalhosDeCobranca;
  corpo: Buffer;
}

export type AcaoSimuladaDeCobranca = 'pagar' | 'vencer' | 'estornar' | 'cancelar';

/**
 * Gateway de desenvolvimento e de teste.
 *
 * Exercita o caminho completo — cliente, assinatura, fatura com link,
 * webhook autenticado, idempotência, bloqueio e volta — sem conta na Asaas e
 * sem cobrar ninguém. Vive em memória: reiniciar a API perde as assinaturas,
 * e a loja precisa contratar de novo.
 *
 * Só é montado com `COBRANCA_FORNECEDOR=simulado` fora de produção.
 */
export class ProvedorSimuladoDeCobranca implements ProvedorDeCobranca {
  readonly nome = 'simulado';
  readonly disponivel = true;
  readonly sandbox = true;

  private readonly clientes = new Map<string, ClienteDeCobranca>();
  private readonly assinaturas = new Map<string, AssinaturaEmMemoria>();
  private sequencia = 0;

  constructor(private readonly token: string) {}

  private proximoId(prefixo: string): string {
    this.sequencia += 1;
    return `${prefixo}_sim_${String(this.sequencia).padStart(6, '0')}`;
  }

  salvarCliente(dados: ClienteDeCobranca, idExterno?: string | null): Promise<{ idExterno: string }> {
    const id = idExterno ?? this.proximoId('cus');
    this.clientes.set(id, dados);
    return Promise.resolve({ idExterno: id });
  }

  criarAssinatura(nova: NovaAssinatura): Promise<AssinaturaNoGateway> {
    if (!this.clientes.has(nova.idClienteExterno)) {
      return Promise.reject(new NotFoundException('Cliente simulado não encontrado (a API reiniciou?).'));
    }

    const id = this.proximoId('sub');
    const fatura: FaturaDoGateway = {
      idExterno: this.proximoId('pay'),
      status: 'pendente',
      valorCentavos: nova.valorCentavos,
      vencimento: nova.primeiroVencimento,
      pagoEm: null,
      meio: nova.meio,
      // `.invalid` é reservado (RFC 2606): não resolve em lugar nenhum.
      urlPagamento: `https://pagamento.simulado.invalid/${id}`,
    };

    this.assinaturas.set(id, {
      idCliente: nova.idClienteExterno,
      valorCentavos: nova.valorCentavos,
      meio: nova.meio,
      referencia: nova.referencia,
      cancelada: false,
      faturas: [fatura],
    });

    // Como a Asaas de verdade: a primeira cobrança nasce no vencimento pedido
    // e o `proximoVencimento` devolvido já é o **ciclo seguinte**. O simulado
    // devolvia o primeiro vencimento, e era por isso que o e2e não pegava o
    // cálculo errado de carência (validado no sandbox em 25/09/2026).
    const proximoCiclo = new Date(nova.primeiroVencimento);
    proximoCiclo.setUTCMonth(proximoCiclo.getUTCMonth() + 1);

    return Promise.resolve({ idExterno: id, proximoVencimento: proximoCiclo });
  }

  faturaAtual(idAssinaturaExterna: string): Promise<FaturaDoGateway | null> {
    const a = this.assinaturas.get(idAssinaturaExterna);
    return Promise.resolve(a ? (a.faturas[a.faturas.length - 1] ?? null) : null);
  }

  cancelarAssinatura(idAssinaturaExterna: string): Promise<void> {
    const a = this.assinaturas.get(idAssinaturaExterna);
    if (a) a.cancelada = true;
    return Promise.resolve();
  }

  interpretarWebhook(cabecalhos: CabecalhosDeCobranca, corpoCru: Uint8Array): EventoDeCobranca {
    if (!tokenConfere(cabecalhos, CABECALHO_TOKEN_ASAAS, this.token)) {
      throw new UnauthorizedException('Token do webhook de cobrança não confere.');
    }

    let payload: PayloadSimulado;
    try {
      payload = JSON.parse(Buffer.from(corpoCru).toString('utf8')) as PayloadSimulado;
    } catch {
      throw new BadRequestException('Corpo do webhook não é JSON.');
    }

    const nome = payload?.event;
    if (!nome) throw new BadRequestException('Webhook sem evento.');

    // `hasOwn`: um nome como "constructor" não pode cair no protótipo.
    const tipo = Object.prototype.hasOwnProperty.call(TRADUCAO, nome) ? TRADUCAO[nome] : 'ignorado';
    const p = payload.payment;

    return {
      tipo,
      idEvento: payload.id,
      idAssinaturaExterna: p?.subscription ?? payload.subscription?.id,
      referencia: p?.externalReference ?? payload.subscription?.externalReference,
      fatura: p
        ? {
            idExterno: p.id,
            status: statusDoEvento(tipo),
            valorCentavos: emCentavos(p.value.toFixed(2)),
            vencimento: new Date(`${p.dueDate}T12:00:00.000Z`),
            pagoEm: p.paymentDate ? new Date(`${p.paymentDate}T12:00:00.000Z`) : null,
            meio: MEIO_SIMULADO[p.billingType ?? 'UNDEFINED'] ?? 'indefinido',
            urlPagamento: p.invoiceUrl ?? null,
          }
        : undefined,
      ocorridoEm: payload.dateCreated ? new Date(payload.dateCreated) : new Date(),
    };
  }

  /* ── Só do simulado ─────────────────────────────────────── */

  entrega(payload: PayloadSimulado): EntregaSimuladaDeCobranca {
    const corpo = Buffer.from(JSON.stringify(payload));
    return {
      corpo,
      cabecalhos: {
        'content-type': 'application/json',
        [CABECALHO_TOKEN_ASAAS]: this.token,
      },
    };
  }

  /**
   * O que o gateway mandaria depois de a loja pagar (ou não). Devolvido como
   * as entregas de webhook, para passarem pelo caminho real.
   */
  simular(idAssinaturaExterna: string, acao: AcaoSimuladaDeCobranca): EntregaSimuladaDeCobranca[] {
    const a = this.assinaturas.get(idAssinaturaExterna);
    if (!a) {
      throw new NotFoundException(
        'Assinatura simulada não encontrada (a API reiniciou?). Contrate o plano de novo.',
      );
    }

    const agora = new Date();
    const dia = (d: Date) => d.toISOString().slice(0, 10);
    const fatura = a.faturas[a.faturas.length - 1]!;

    if (acao === 'cancelar') {
      a.cancelada = true;
      return [
        this.entrega({
          id: this.proximoId('evt'),
          event: 'SUBSCRIPTION_DELETED',
          dateCreated: agora.toISOString(),
          subscription: { id: idAssinaturaExterna, externalReference: a.referencia },
        }),
      ];
    }

    const evento =
      acao === 'pagar' ? 'PAYMENT_RECEIVED' : acao === 'vencer' ? 'PAYMENT_OVERDUE' : 'PAYMENT_REFUNDED';

    if (acao === 'pagar') {
      fatura.status = 'paga';
      fatura.pagoEm = agora;
      // A próxima fatura nasce em aberto, como na Asaas: a assinatura segue.
      a.faturas.push({
        ...fatura,
        idExterno: this.proximoId('pay'),
        status: 'pendente',
        pagoEm: null,
        vencimento: new Date(fatura.vencimento.getTime() + 30 * 86_400_000),
      });
    } else if (acao === 'vencer') {
      fatura.status = 'vencida';
    } else {
      fatura.status = 'estornada';
    }

    return [
      this.entrega({
        id: this.proximoId('evt'),
        event: evento,
        dateCreated: agora.toISOString(),
        payment: {
          id: fatura.idExterno,
          subscription: idAssinaturaExterna,
          externalReference: a.referencia,
          value: Number(deCentavos(a.valorCentavos)),
          dueDate: dia(fatura.vencimento),
          billingType: PARA_GATEWAY[a.meio],
          invoiceUrl: fatura.urlPagamento ?? undefined,
          paymentDate: acao === 'pagar' ? dia(agora) : undefined,
        },
      }),
    ];
  }
}

function statusDoEvento(tipo: TipoEventoCobranca): StatusDeFatura {
  switch (tipo) {
    case 'pagamento_confirmado': return 'paga';
    case 'pagamento_vencido': return 'vencida';
    case 'reembolso': return 'estornada';
    case 'assinatura_cancelada': return 'cancelada';
    default: return 'pendente';
  }
}
