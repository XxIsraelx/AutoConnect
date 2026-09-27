import {
  BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@autoconnect/db';
import {
  aplicarEventoDeCobranca, avaliarCobranca, CATALOGO_DE_PLANOS, deCentavos, DIAS_DE_CARENCIA,
  ehPlanoPago, faixaParaEstoque, FAIXAS, somarDias, STATUS_QUE_CONTA_NO_LIMITE, usoDoEstoque,
  type CabecalhosDeCobranca, type EstadoDaCobranca, type EventoDeCobranca, type FaturaDoGateway,
  type MeioDePagamento, type PlanoPago, type ProvedorDeCobranca,
} from '@autoconnect/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { PROVEDOR_DE_COBRANCA } from './provedor';
import { ProvedorSimuladoDeCobranca, type AcaoSimuladaDeCobranca } from './provedor-simulado';
import { sha256Hex } from './token-webhook';
import { EstadoDaLojaService } from './estado-da-loja.service';

/**
 * O evento normalizado, em JSON gravável.
 *
 * `JSON.stringify` **estoura** com `bigint`, e o valor da fatura é bigint de
 * propósito (dinheiro nunca é ponto flutuante). Sem esta conversão o webhook
 * respondia 500 e o gateway reentregava para sempre — sem nunca conseguir
 * gravar o evento que o tornaria idempotente.
 */
function paraJson(evento: EventoDeCobranca): Prisma.InputJsonValue {
  return {
    tipo: evento.tipo,
    idEvento: evento.idEvento ?? null,
    idAssinaturaExterna: evento.idAssinaturaExterna ?? null,
    referencia: evento.referencia ?? null,
    ocorridoEm: evento.ocorridoEm.toISOString(),
    fatura: evento.fatura
      ? {
          idExterno: evento.fatura.idExterno,
          status: evento.fatura.status,
          // String decimal, como todo dinheiro que atravessa a fronteira HTTP.
          valor: deCentavos(evento.fatura.valorCentavos),
          vencimento: evento.fatura.vencimento.toISOString(),
          pagoEm: evento.fatura.pagoEm?.toISOString() ?? null,
          meio: evento.fatura.meio,
          urlPagamento: evento.fatura.urlPagamento,
        }
      : null,
  };
}

export interface ResultadoDoWebhookDeCobranca {
  recebido: true;
  aplicado: boolean;
  motivo?: 'ignorado' | 'assinatura-desconhecida' | 'duplicado' | 'sem-efeito' | 'fatura-cancelada';
}

/**
 * Cobrança da assinatura da loja.
 *
 * Três pontas, e em nenhuma a ida à rede acontece dentro de transação — pelo
 * mesmo motivo da assinatura eletrônica e da consulta veicular: o rollback
 * desfaria o registro do que o gateway já fez, e a transação seguraria conexão
 * do pool pelo tempo do gateway.
 *
 *  1. `contratar`: valida → cria cliente e assinatura (rede) → grava.
 *  2. `receberWebhook`: confere o token → acha a loja → grava o evento cru →
 *     aplica (transação) → derruba o cache do guard.
 *  3. `cancelar`: gateway primeiro, depois o banco — se o gateway falhar, nada
 *     muda aqui e o pedido pode ser repetido.
 */
@Injectable()
export class CobrancaService {
  private readonly logger = new Logger(CobrancaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly estadoDaLoja: EstadoDaLojaService,
    private readonly config: ConfigService,
    @Inject(PROVEDOR_DE_COBRANCA)
    private readonly provedor: ProvedorDeCobranca,
  ) {}

  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new BadRequestException('Selecione uma concessionária para ver o plano e a cobrança.');
    }
    return escopo.tenantId;
  }

  private exigirProvedor(): void {
    if (!this.provedor.disponivel) {
      throw new ServiceUnavailableException(
        'Nenhum gateway de cobrança está configurado. ' +
          'A assinatura desta loja é gerenciada manualmente — fale com o suporte.',
      );
    }
  }

  get simulado(): boolean {
    return this.provedor instanceof ProvedorSimuladoDeCobranca &&
      this.config.get<string>('NODE_ENV') !== 'production';
  }

  capacidade() {
    return {
      disponivel: this.provedor.disponivel,
      provedor: this.provedor.disponivel ? this.provedor.nome : null,
      simulado: this.simulado,
      sandbox: Boolean(this.provedor.sandbox),
    };
  }

  /** O catálogo, com os preços já em string decimal (o formato que a API troca). */
  planos() {
    return FAIXAS.map((f) => ({
      plano: f.plano,
      nome: f.nome,
      resumo: f.resumo,
      precoMensal: deCentavos(f.precoMensalCentavos),
      limiteVeiculos: f.limiteVeiculos,
    }));
  }

  /* ── 1. O painel da loja ───────────────────────────────────── */

  async resumo(escopo: Escopo) {
    const tenantId = this.tenantDe(escopo);

    const dados = await this.prisma.withTenant(tenantId, async (tx) => {
      const assinatura = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      const veiculos = await tx.vehicle.count({
        where: { tenantId, status: { in: [...STATUS_QUE_CONTA_NO_LIMITE] } },
      });
      const faturas = assinatura
        ? await tx.tenantInvoice.findMany({
            where: { tenantId }, orderBy: { dueDate: 'desc' }, take: 24,
          })
        : [];
      return { assinatura, veiculos, faturas };
    });

    const veredito = avaliarCobranca(dados.assinatura);
    const plano = dados.assinatura?.plan ?? 'trial';
    const uso = usoDoEstoque(plano, dados.veiculos);

    return {
      ...this.capacidade(),
      planos: this.planos(),
      assinatura: dados.assinatura
        ? {
            /** O plano **efetivo** — o que a loja tem hoje. */
            plano: dados.assinatura.plan,
            /** Contratado e aguardando pagamento. Não vale ainda. */
            planoPendente: dados.assinatura.pendingPlan,
            pendenteDesde: dados.assinatura.pendingSince,
            status: dados.assinatura.status,
            trialEndsAt: dados.assinatura.trialEndsAt,
            currentPeriodEnd: dados.assinatura.currentPeriodEnd,
            graceUntil: dados.assinatura.graceUntil,
            cortesia: dados.assinatura.courtesySince
              ? { desde: dados.assinatura.courtesySince, motivo: dados.assinatura.courtesyReason }
              : null,
            canceledAt: dados.assinatura.canceledAt,
            meio: dados.assinatura.paymentMethod,
            contratada: Boolean(dados.assinatura.externalId),
          }
        : null,
      situacao: veredito.situacao,
      somenteLeitura: veredito.somenteLeitura,
      diasRestantes: veredito.diasRestantes,
      prazoAte: veredito.prazoAte,
      aviso: veredito.aviso,
      // O veredito é a fonte: a tela não decide por si se há plano pendente.
      planoPendente: veredito.planoPendente,
      uso: { ...uso, faixaSugerida: faixaParaEstoque(dados.veiculos)?.plano ?? null },
      faturas: dados.faturas.map((f) => ({
        id: f.id,
        status: f.status,
        // `.toFixed(2)`, não `.toString()`: o Decimal do Prisma normaliza e
        // devolveria "279" para R$ 279,00 — a convenção da API é sempre duas casas.
        valor: f.amount.toFixed(2),
        vencimento: f.dueDate,
        pagoEm: f.paidAt,
        meio: f.paymentMethod,
        urlPagamento: f.paymentUrl,
        descricao: f.description,
      })),
    };
  }

  /* ── 2. Contratar ──────────────────────────────────────────── */

  /**
   * Contratar um plano — ou trocar de plano.
   *
   * ## Contratar registra a intenção; **o pagamento é que muda o plano**
   *
   * Até 27/09/2026 esta função gravava `plan: plano` antes de qualquer
   * pagamento, mantendo o `status`. Como `avaliarCobranca` lê "plano pago +
   * `active`" como loja em dia sem mais perguntas, o resultado era uma loja que
   * contratava, nunca pagava e ficava com o plano — e com o teto de estoque
   * dele — **para sempre**. Aconteceu em produção.
   *
   * Agora o plano contratado vai para `pendingPlan`, e quem o promove é o
   * `pagamento_confirmado` do webhook. Enquanto pendente:
   *
   * - a loja continua no que tinha (trial vigente, plano pago anterior, ou
   *   somente leitura se já estava);
   * - o **teto de estoque continua sendo o do plano efetivo** — ninguém publica
   *   acima da faixa que ainda não pagou;
   * - a tela mostra "plano X contratado, aguardando pagamento" com o link da
   *   fatura.
   *
   * ## O que continua igual: contratar destrava quem estava vencido
   *
   * A carência vai até o primeiro vencimento + `DIAS_DE_CARENCIA`, como na
   * decisão original — quem se comprometeu volta a escrever antes de o boleto
   * vencer. A diferença é que agora isso é um prazo (10 dias), e não um plano
   * vitalício: passada a carência sem pagamento, a loja volta a somente
   * leitura. Loja **pagante e em dia** não recebe carência nenhuma aqui: ela
   * não está vencida, e gravar um prazo para ela só criaria data errada para o
   * dia em que uma fatura vencer.
   *
   * ## Troca de plano de quem já paga
   *
   * O `plan` antigo fica de pé (e o teto dele também) até a primeira fatura do
   * novo ser paga. No gateway existe **uma** assinatura viva: a nova é criada e
   * a anterior é cancelada logo depois — nessa ordem, porque falhar na criação
   * não pode deixar a loja sem assinatura nenhuma. Se a loja nunca pagar o
   * plano novo, o `PAYMENT_OVERDUE` da fatura dele abre a carência normal.
   */
  async contratar(escopo: Escopo, plano: PlanoPago, meio: MeioDePagamento) {
    const tenantId = this.tenantDe(escopo);
    this.exigirProvedor();

    const faixa = CATALOGO_DE_PLANOS[plano];

    // ── Leitura: dados do pagador e a assinatura de hoje ──────────────
    const atual = await this.prisma.withTenant(tenantId, async (tx) => {
      const loja = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: {
          id: true, tradeName: true, legalName: true, taxId: true,
          primaryEmail: true, primaryPhone: true,
        },
      });
      if (!loja) throw new NotFoundException('Concessionária não encontrada');

      const assinatura = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      if (!assinatura) throw new NotFoundException('Assinatura não encontrada');
      return { loja, assinatura };
    });

    if (atual.assinatura.courtesySince) {
      throw new ConflictException(
        'Esta loja está em cortesia e não paga assinatura. Fale com a AutoConnect para mudar de plano.',
      );
    }

    // Assinatura viva no gateway = tem id e não foi cancelada. É o que decide
    // se este pedido é uma contratação nova ou uma troca de plano.
    const anterior = atual.assinatura.status === 'canceled' ? null : atual.assinatura.externalId;

    if (anterior && atual.assinatura.pendingPlan === plano) {
      throw new ConflictException(
        `O plano ${faixa.nome} já está contratado e aguardando o pagamento da primeira fatura. ` +
          'Use o link da fatura em aberto para pagar — contratar de novo só geraria uma segunda cobrança.',
      );
    }
    if (anterior && !atual.assinatura.pendingPlan && atual.assinatura.plan === plano) {
      throw new ConflictException(
        `Esta loja já está no plano ${faixa.nome}. ` +
          'Se houver fatura em aberto, pague-a pelo link; para sair do plano, cancele a assinatura.',
      );
    }
    if (!atual.loja.taxId) {
      throw new BadRequestException(
        'Informe o CNPJ da loja em Configurações antes de contratar um plano — o gateway exige o pagador identificado.',
      );
    }

    // ── Rede: cliente e assinatura no gateway, fora de transação ──────
    const cliente = await this.provedor.salvarCliente(
      {
        referencia: tenantId,
        nome: atual.loja.legalName || atual.loja.tradeName,
        email: atual.loja.primaryEmail,
        cnpj: atual.loja.taxId,
        telefone: atual.loja.primaryPhone,
      },
      atual.assinatura.externalCustomerId,
    );

    // Primeiro vencimento: hoje + 3 dias, para o boleto ter tempo de ser
    // registrado e compensado antes de o trial acabar. Quem paga por Pix paga
    // na hora e a confirmação chega antes disso.
    const primeiroVencimento = somarDias(new Date(), 3);

    const assinatura = await this.provedor.criarAssinatura({
      idClienteExterno: cliente.idExterno,
      plano,
      valorCentavos: faixa.precoMensalCentavos,
      meio,
      primeiroVencimento,
      descricao: `AutoConnect — plano ${faixa.nome}`,
      referencia: atual.assinatura.id,
    });

    // Troca de plano: a assinatura anterior sai do gateway agora que a nova
    // existe. Nunca duas vivas — seriam duas cobranças mensais. Falhar aqui não
    // desfaz nada (o cliente já tem a fatura nova para pagar), então é aviso no
    // log e não erro: o super admin cancela a sobra em `/admin › Concessionárias`.
    if (anterior && anterior !== assinatura.idExterno) {
      try {
        await this.provedor.cancelarAssinatura(anterior);
      } catch (err) {
        this.logger.error(
          `Loja ${tenantId}: a assinatura ${anterior} não pôde ser cancelada ao trocar de plano ` +
            `(nova: ${assinatura.idExterno}). Pode haver cobrança dupla no gateway: ${err}`,
        );
      }
    }

    // ── Gravação ──────────────────────────────────────────────────────
    //
    // `plan` **não** muda aqui: contratar não é pagar. A intenção fica em
    // `pendingPlan` e o `pagamento_confirmado` do webhook a promove.
    //
    // Loja pagante e em dia não ganha carência: ela não está vencida, e um
    // `graceUntil` gravado agora seria a data errada no dia em que uma fatura
    // vencesse de verdade.
    const emDiaPagando = ehPlanoPago(atual.assinatura.plan) && atual.assinatura.status === 'active';

    await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          pendingPlan: plano,
          pendingSince: new Date(),
          externalProvider: this.provedor.nome,
          externalId: assinatura.idExterno,
          externalCustomerId: cliente.idExterno,
          paymentMethod: meio,
          canceledAt: null,
          // Carência até o primeiro vencimento + a carência normal: a loja que
          // contratou no último dia do trial não pode virar somente leitura
          // enquanto o boleto dela nem venceu. E é um **prazo**: passado ele
          // sem pagamento, a loja volta a somente leitura.
          //
          // ⚠ É o `primeiroVencimento` que pedimos, **não** o
          // `assinatura.proximoVencimento`: validado no sandbox da Asaas em
          // 25/09/2026, o `nextDueDate` da resposta já é o ciclo seguinte
          // (pedimos 28/09, a cobrança nasceu para 28/09 e a resposta veio
          // 28/10). Usá-lo daria 37 dias de carência em vez de 10 — um mês
          // de produto de graça para quem contratou e nunca pagou.
          ...(emDiaPagando ? {} : { graceUntil: somarDias(primeiroVencimento, DIAS_DE_CARENCIA) }),
          status: atual.assinatura.status === 'canceled' ? 'past_due' : atual.assinatura.status,
        },
      }),
    );

    this.estadoDaLoja.invalidar(tenantId);

    const fatura = await this.sincronizarFatura(tenantId, assinatura.idExterno, `AutoConnect — plano ${faixa.nome}`);
    return {
      contratada: true,
      /** O plano contratado. Ele **ainda não vale**: falta o pagamento. */
      plano,
      pendente: true,
      /** O que a loja tem enquanto a fatura não é paga. */
      planoEfetivo: atual.assinatura.plan,
      fatura,
    };
  }

  /**
   * Busca a fatura atual no gateway e espelha localmente.
   *
   * Falha do gateway aqui **não derruba a contratação**: a assinatura já
   * existe dos dois lados, e o link de pagamento é recuperável a qualquer
   * momento pela própria tela. O aviso no log é o que torna o caso visível.
   */
  private async sincronizarFatura(tenantId: string, idAssinaturaExterna: string, descricao?: string) {
    let doGateway: FaturaDoGateway | null = null;
    try {
      doGateway = await this.provedor.faturaAtual(idAssinaturaExterna);
    } catch (err) {
      this.logger.warn(`Não foi possível ler a fatura de ${idAssinaturaExterna}: ${err}`);
      return null;
    }
    if (!doGateway) return null;

    return this.gravarFatura(tenantId, doGateway, descricao);
  }

  private async gravarFatura(tenantId: string, f: FaturaDoGateway, descricao?: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const assinatura = await tx.tenantSubscription.findUnique({
        where: { tenantId }, select: { id: true },
      });
      if (!assinatura) return null;

      const dados = {
        tenantId,
        subscriptionId: assinatura.id,
        provider: this.provedor.nome,
        externalId: f.idExterno,
        status: f.status,
        amount: new Prisma.Decimal(deCentavos(f.valorCentavos)),
        paymentMethod: f.meio,
        dueDate: f.vencimento,
        paidAt: f.pagoEm,
        paymentUrl: f.urlPagamento,
        description: descricao ?? null,
      };

      const salva = await tx.tenantInvoice.upsert({
        where: { provider_externalId: { provider: this.provedor.nome, externalId: f.idExterno } },
        create: dados,
        // `description` fora do update: o texto da criação é o que vale, e o
        // webhook não o traz.
        update: {
          status: dados.status, amount: dados.amount, paymentMethod: dados.paymentMethod,
          dueDate: dados.dueDate, paidAt: dados.paidAt, paymentUrl: dados.paymentUrl,
        },
      });

      return {
        id: salva.id, status: salva.status, valor: salva.amount.toFixed(2),
        vencimento: salva.dueDate, urlPagamento: salva.paymentUrl,
      };
    });
  }

  /** Relê a fatura no gateway — é o botão "atualizar link de pagamento". */
  async atualizarFatura(escopo: Escopo) {
    const tenantId = this.tenantDe(escopo);
    this.exigirProvedor();

    const assinatura = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenantSubscription.findUnique({ where: { tenantId }, select: { externalId: true } }),
    );
    if (!assinatura?.externalId) throw new NotFoundException('Esta loja ainda não tem assinatura contratada.');

    const fatura = await this.sincronizarFatura(tenantId, assinatura.externalId);
    if (!fatura) throw new ServiceUnavailableException('O gateway não devolveu nenhuma fatura agora.');
    return fatura;
  }

  /* ── 3. Cancelar ───────────────────────────────────────────── */

  async cancelar(escopo: Escopo) {
    const tenantId = this.tenantDe(escopo);

    const assinatura = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenantSubscription.findUnique({ where: { tenantId }, select: { externalId: true, status: true } }),
    );
    if (!assinatura) throw new NotFoundException('Assinatura não encontrada');
    if (assinatura.status === 'canceled') return { cancelada: true };

    // Gateway primeiro: se ele falhar, nada muda aqui e o cliente repete. O
    // contrário diria "cancelado" com a cobrança seguindo mês que vem.
    if (assinatura.externalId) await this.provedor.cancelarAssinatura(assinatura.externalId);

    await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          status: 'canceled', canceledAt: new Date(), graceUntil: null,
          // A intenção morre com a assinatura: sem cobrança no gateway não há
          // fatura para pagar, e "aguardando pagamento" na tela de quem
          // cancelou seria mentira.
          pendingPlan: null, pendingSince: null,
        },
      }),
    );
    this.estadoDaLoja.invalidar(tenantId);

    return { cancelada: true };
  }

  /* ── 4. Webhook ────────────────────────────────────────────── */

  async receberWebhook(
    cabecalhos: CabecalhosDeCobranca,
    corpo: Buffer,
  ): Promise<ResultadoDoWebhookDeCobranca> {
    // Lança 401 se o token não conferir — antes de qualquer acesso ao banco.
    const evento = this.provedor.interpretarWebhook(cabecalhos, corpo);
    if (evento.tipo === 'ignorado') return { recebido: true, aplicado: false, motivo: 'ignorado' };

    const alvo = await this.acharAssinatura(evento);
    if (!alvo) {
      // 2xx e não 404, pela mesma razão do webhook de assinatura: a entrega é
      // autêntica, então a assinatura foi criada com este token por outra
      // instalação (homologação na mesma conta do gateway). Repetir não vai
      // fazê-la aparecer, e 4xx faria o gateway insistir.
      this.logger.warn(
        `Webhook de cobrança para assinatura desconhecida: ${evento.idAssinaturaExterna ?? evento.referencia ?? '?'}`,
      );
      return { recebido: true, aplicado: false, motivo: 'assinatura-desconhecida' };
    }

    const chave = evento.idEvento ?? sha256Hex(corpo);

    const resultado = await this.prisma.withTenant(alvo.tenantId, async (tx) => {
      // Idempotência, camada 1: `(provider, event_key)` é único. A segunda
      // entrega do mesmo evento bate aqui e nada mais acontece.
      try {
        await tx.billingWebhookEvent.create({
          data: {
            tenantId: alvo.tenantId,
            provider: this.provedor.nome,
            eventKey: chave,
            kind: evento.tipo,
            normalized: paraJson(evento),
            rawBody: corpo.toString('utf8').slice(0, 20_000),
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return { aplicado: false, motivo: 'duplicado' as const };
        }
        throw err;
      }

      // Fatura que o super admin cancelou à mão não volta pela porta dos
      // fundos. A Asaas pode ter um `PAYMENT_OVERDUE` na fila no instante em
      // que a cobrança é removida; aplicá-lo reabriria a carência (e o
      // bloqueio depois dela) por causa de uma cobrança que já não existe.
      // Pagamento confirmado **passa**: dinheiro que entrou é dinheiro que
      // entrou, mesmo que o cancelamento tenha corrido junto.
      if (evento.tipo === 'pagamento_vencido' && evento.fatura) {
        const local = await tx.tenantInvoice.findFirst({
          where: { provider: this.provedor.nome, externalId: evento.fatura.idExterno },
          select: { status: true },
        });
        if (local?.status === 'cancelada') {
          return { aplicado: false, motivo: 'fatura-cancelada' as const };
        }
      }

      // Os webhooks da mesma assinatura são serializados aqui: sem a trava,
      // um `PAYMENT_CONFIRMED` e um `PAYMENT_RECEIVED` chegando no mesmo
      // instante leriam o mesmo estado e o segundo sobrescreveria o primeiro.
      await tx.$queryRaw`SELECT id FROM tenant_subscriptions WHERE id = ${alvo.id}::uuid FOR UPDATE`;

      const linha = await tx.tenantSubscription.findUnique({ where: { id: alvo.id } });
      if (!linha) return { aplicado: false, motivo: 'assinatura-desconhecida' as const };

      const atual: EstadoDaCobranca = {
        plan: linha.plan,
        pendingPlan: linha.pendingPlan,
        status: linha.status,
        currentPeriodEnd: linha.currentPeriodEnd,
        graceUntil: linha.graceUntil,
      };

      // Idempotência, camada 2: a máquina de estados é pura. Mesmo que a
      // camada 1 falhasse (id de evento diferente para o mesmo fato), aplicar
      // duas vezes dá o mesmo estado.
      const { estado, mudou } = aplicarEventoDeCobranca(atual, evento);

      if (mudou) {
        await tx.tenantSubscription.update({
          where: { id: alvo.id },
          data: {
            // **É aqui que o plano contratado passa a valer.** A máquina de
            // estados decide: `pagamento_confirmado` promove o pendente,
            // cancelamento e reembolso o descartam, vencimento o mantém.
            plan: estado.plan as typeof linha.plan,
            pendingPlan: estado.pendingPlan as typeof linha.pendingPlan,
            pendingSince: estado.pendingPlan === null ? null : linha.pendingSince,
            status: estado.status,
            currentPeriodEnd: estado.currentPeriodEnd,
            currentPeriodStart: estado.status === 'active' ? new Date() : linha.currentPeriodStart,
            graceUntil: estado.graceUntil,
            canceledAt: estado.status === 'canceled' ? (linha.canceledAt ?? new Date()) : null,
            lastNoticeAt: estado.status === 'active' ? null : linha.lastNoticeAt,
          },
        });
      }

      await tx.billingWebhookEvent.update({
        where: { provider_eventKey: { provider: this.provedor.nome, eventKey: chave } },
        data: { applied: mudou },
      });

      return { aplicado: mudou, motivo: mudou ? undefined : ('sem-efeito' as const) };
    });

    // A fatura é espelhada fora da transação do evento: ela é histórico, e um
    // erro ao gravá-la não pode desfazer o desbloqueio que acabou de acontecer.
    // A cancelada à mão fica de fora: o espelho a devolveria a `vencida`.
    if (evento.fatura && resultado.motivo !== 'fatura-cancelada') {
      try {
        await this.gravarFatura(alvo.tenantId, evento.fatura);
      } catch (err) {
        this.logger.warn(`Falha ao espelhar a fatura ${evento.fatura.idExterno}: ${err}`);
      }
    }

    // **A volta imediata.** Sem isto, a loja que acabou de pagar continuaria
    // bloqueada até o cache de 30 s expirar — e 30 segundos olhando para um
    // aviso de bloqueio depois de pagar é tempo de sobra para abrir um chamado.
    this.estadoDaLoja.invalidar(alvo.tenantId);

    return { recebido: true, ...resultado };
  }

  /**
   * De qual loja é o evento.
   *
   * ── A única leitura sem contexto de tenant ──────────────────────
   * O webhook chega sem usuário e sem loja: tudo o que ele traz são ids do
   * gateway, cuja autenticidade o token acabou de provar. Descobrir a loja
   * exige atravessar concessionárias — o mesmo caso do webhook de assinatura e
   * do convite por token. A travessia é mínima de propósito: `findFirst` por
   * chave, devolvendo só `id` e `tenantId`. Tudo depois roda em `withTenant`.
   */
  private async acharAssinatura(evento: EventoDeCobranca) {
    if (evento.idAssinaturaExterna) {
      const porId = await this.privilegiado.tenantSubscription.findFirst({
        where: { externalProvider: this.provedor.nome, externalId: evento.idAssinaturaExterna },
        select: { id: true, tenantId: true },
      });
      if (porId) return porId;
    }
    // `referencia` é o id da nossa própria assinatura, que mandamos na
    // criação: é o caminho de volta quando o evento não traz a assinatura do
    // gateway (a Asaas omite `subscription` em cobrança avulsa).
    if (evento.referencia) {
      return this.privilegiado.tenantSubscription.findFirst({
        where: { id: evento.referencia },
        select: { id: true, tenantId: true },
      });
    }
    return null;
  }

  /* ── 5. Só do simulado ─────────────────────────────────────── */

  async simular(escopo: Escopo, acao: AcaoSimuladaDeCobranca) {
    const tenantId = this.tenantDe(escopo);
    if (!(this.provedor instanceof ProvedorSimuladoDeCobranca) || !this.simulado) {
      throw new NotFoundException('Simulação de cobrança só existe com o gateway simulado.');
    }

    const assinatura = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenantSubscription.findUnique({ where: { tenantId }, select: { externalId: true } }),
    );
    if (!assinatura?.externalId) throw new NotFoundException('Esta loja ainda não tem assinatura contratada.');

    const entregas = this.provedor.simular(assinatura.externalId, acao);
    const resultados: ResultadoDoWebhookDeCobranca[] = [];
    for (const e of entregas) resultados.push(await this.receberWebhook(e.cabecalhos, e.corpo));
    return { entregas: resultados };
  }
}
