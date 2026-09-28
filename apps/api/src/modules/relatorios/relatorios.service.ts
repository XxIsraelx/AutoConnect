import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import {
  calcularComissao, DEAL_FATURADO_STATUSES, DEAL_TERMINAL_STATUSES,
  MOTIVOS_DE_CANCELAMENTO_DE_NEGOCIO,
} from '@autoconnect/shared';
import { montarCsv, montarCsvComTeto, TETO_DE_LINHAS_CSV } from '../../common/csv';
import {
  consultaDeClientesRelacionados, type ClienteRelacionado,
} from '../../common/clientes-relacionados';

/** Quem enxerga custo, margem e comissão. Mesma lista do `deals.controller`. */
const VE_DINHEIRO = ['manager', 'tenant_admin', 'super_admin'];

/** Papéis que aparecem como vendedor no relatório. */
const PAPEIS_DE_VENDA = ['salesperson', 'manager', 'tenant_admin'] as const;

export interface QuemPede {
  id: string;
  role: string;
}

/** Uma linha do relatório. Dinheiro sai como string, nunca como número. */
export interface LinhaDeDesempenho {
  userId: string;
  nome: string;
  papel: string;
  leadsRecebidos: number;
  leadsAtendidos: number;
  agendamentos: number;
  comparecimentos: number;
  faltas: number;
  /** Percentual inteiro, ou `null` quando nenhum agendamento chegou ao fim. */
  taxaComparecimento: number | null;
  negociosGanhos: number;
  faturamento: string | null;
  margem: string | null;
  comissaoPct: string | null;
  comissaoEstimada: string | null;
}

/**
 * Desempenho por vendedor.
 *
 * Duas regras moldam este arquivo:
 *
 *  1. **Nada de N+1.** São quatro `groupBy` e uma leitura da equipe — cinco
 *     idas ao banco no total, independentemente de a loja ter 2 ou 40
 *     vendedores. Em produção a API roda em Virgínia e o banco em São Paulo:
 *     cada consulta custa ~0,6s, e um laço por vendedor transformaria o
 *     relatório em meio minuto de espera.
 *  2. **Dinheiro é `Decimal` até virar string.** `_sum` do Prisma devolve
 *     `Decimal`; somar com `Number` é como aparece um centavo do nada numa
 *     comissão.
 *
 * O tempo médio de primeira resposta **não** sai daqui: ele vem de
 * `GET /leads/sla-stats`, e a tela junta os dois. Duplicar o cálculo do SLA
 * aqui criaria duas definições do mesmo número, que é a forma mais rápida de
 * dois relatórios da mesma loja discordarem.
 */
@Injectable()
export class RelatoriosService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new BadRequestException(
        'Selecione uma concessionária para ver o desempenho da equipe.',
      );
    }
    return escopo.tenantId;
  }

  /** Custo e margem são de gerente para cima — mesma regra da aba de custo. */
  private veDinheiro(quem: QuemPede): boolean {
    return VE_DINHEIRO.includes(quem.role);
  }

  async desempenhoPorVendedor(
    escopo: Escopo,
    quem: QuemPede,
    days: number,
  ): Promise<{
    periodo: { days: number; from: Date; to: Date };
    veDinheiro: boolean;
    vendedores: LinhaDeDesempenho[];
  }> {
    const tenantId = this.tenantDe(escopo);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const dinheiro = this.veDinheiro(quem);

    // Vendedor vê a própria linha e só. Não é cosmética de tela: o filtro entra
    // na consulta, então o número dos colegas não chega nem a sair do banco.
    const soOProprio = !dinheiro;
    // `{ not: null }` deixa de fora o que ninguém pegou; o id do próprio já
    // implica não-nulo, então uma coisa substitui a outra em vez de somar.
    const dono = soOProprio ? quem.id : ({ not: null } as const);

    const linhas = await this.prisma.withTenant(tenantId, async (tx) => {
      const [equipe, leads, agendamentos, negocios] = await Promise.all([
        tx.user.findMany({
          where: {
            tenantId,
            role: { in: [...PAPEIS_DE_VENDA] },
            status: { not: 'deleted' },
            ...(soOProprio ? { id: quem.id } : {}),
          },
          select: {
            id: true,
            fullName: true,
            role: true,
            salespersonProfile: { select: { commissionPct: true } },
          },
          orderBy: { fullName: 'asc' },
        }),

        // Leads do período, por dono e por estágio. O `status` vem junto para
        // que "atendido" saia do mesmo agrupamento, sem uma segunda consulta.
        tx.lead.groupBy({
          by: ['assignedTo', 'status'],
          where: {
            tenantId,
            createdAt: { gte: from, lte: to },
            assignedTo: dono,
          },
          _count: { _all: true },
        }),

        // Agendamentos pela data marcada, não pela de cadastro: o que se mede é
        // a agenda do período, e um test drive marcado em março para abril é
        // resultado de abril.
        tx.appointment.groupBy({
          by: ['salespersonId', 'status'],
          where: {
            tenantId,
            scheduledStart: { gte: from, lte: to },
            salespersonId: dono,
          },
          _count: { _all: true },
        }),

        // Venda realizada é negócio faturado, com os valores congelados no
        // faturamento — a mesma definição do gráfico de margem.
        tx.deal.groupBy({
          by: ['salespersonId'],
          where: {
            tenantId,
            status: { in: [...DEAL_FATURADO_STATUSES] },
            closedAt: { gte: from, lte: to },
            salespersonId: dono,
          },
          _count: { _all: true },
          _sum: { saleValue: true, grossMargin: true },
        }),
      ]);

      return { equipe, leads, agendamentos, negocios };
    });

    const { equipe, leads, agendamentos, negocios } = linhas;

    const contarLeads = (userId: string, filtro: (status: string) => boolean) =>
      leads
        .filter((l) => l.assignedTo === userId && filtro(l.status))
        .reduce((acc, l) => acc + l._count._all, 0);

    const contarAgendamentos = (userId: string, filtro: (status: string) => boolean) =>
      agendamentos
        .filter((a) => a.salespersonId === userId && filtro(a.status))
        .reduce((acc, a) => acc + a._count._all, 0);

    return {
      periodo: { days, from, to },
      veDinheiro: dinheiro,
      vendedores: equipe.map((u) => {
        const recebidos = contarLeads(u.id, () => true);
        // "Atendido" é lead que saiu de `new`. Não é o mesmo que respondido no
        // prazo — esse número é o do SLA, que vem de `/leads/sla-stats`.
        const atendidos = contarLeads(u.id, (s) => s !== 'new');

        const marcados = contarAgendamentos(u.id, () => true);
        const compareceu = contarAgendamentos(u.id, (s) => s === 'completed');
        const faltou = contarAgendamentos(u.id, (s) => s === 'no_show');

        const negocio = negocios.find((n) => n.salespersonId === u.id);
        const faturamento = negocio?._sum.saleValue ?? new Prisma.Decimal(0);
        const margem = negocio?._sum.grossMargin ?? new Prisma.Decimal(0);

        const pct = u.salespersonProfile?.commissionPct ?? null;
        // A base é o **valor de venda**, e a conta mora no shared: esta tela
        // aplicava o percentual sobre a margem bruta e `/equipe` sobre o
        // faturamento, e a mesma pessoa tinha dois valores de comissão no
        // mesmo mês. O porquê da base escolhida está em `domain/comissao.ts`.
        const comissao = calcularComissao(faturamento.toFixed(2), pct?.toFixed(2) ?? null);

        return {
          userId: u.id,
          nome: u.fullName,
          papel: u.role,
          leadsRecebidos: recebidos,
          leadsAtendidos: atendidos,
          agendamentos: marcados,
          comparecimentos: compareceu,
          faltas: faltou,
          taxaComparecimento:
            compareceu + faltou > 0
              ? Math.round((compareceu / (compareceu + faltou)) * 100)
              : null,
          negociosGanhos: negocio?._count._all ?? 0,
          faturamento: dinheiro ? faturamento.toFixed(2) : null,
          margem: dinheiro ? margem.toFixed(2) : null,
          comissaoPct: dinheiro && pct ? pct.toFixed(2) : null,
          comissaoEstimada: dinheiro ? comissao : null,
        } satisfies LinhaDeDesempenho;
      }),
    };
  }

  /* ── Exportações ─────────────────────────────────────────── */

  async csvDeDesempenho(escopo: Escopo, quem: QuemPede, days: number): Promise<string> {
    const { vendedores, veDinheiro } = await this.desempenhoPorVendedor(escopo, quem, days);

    const cabecalho = [
      'Vendedor', 'Papel', 'Leads recebidos', 'Leads atendidos',
      'Agendamentos', 'Comparecimentos', 'Faltas', 'Comparecimento (%)',
      'Negócios ganhos',
      ...(veDinheiro ? ['Faturamento', 'Margem', 'Comissão (%)', 'Comissão estimada'] : []),
    ];

    const linhas = vendedores.map((v) => [
      v.nome, v.papel, v.leadsRecebidos, v.leadsAtendidos,
      v.agendamentos, v.comparecimentos, v.faltas, v.taxaComparecimento ?? '',
      v.negociosGanhos,
      ...(veDinheiro
        ? [v.faturamento ?? '', v.margem ?? '', v.comissaoPct ?? '', v.comissaoEstimada ?? '']
        : []),
    ]);

    return montarCsv(cabecalho, linhas);
  }

  /** Negócios do período, um por linha. Custo e margem só para quem os vê. */
  async csvDeNegocios(escopo: Escopo, quem: QuemPede, days: number): Promise<string> {
    const tenantId = this.tenantDe(escopo);
    const dinheiro = this.veDinheiro(quem);
    const from = new Date(Date.now() - days * 86_400_000);

    const negocios = await this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
      tx.deal.findMany({
        where: {
          tenantId,
          createdAt: { gte: from },
          // Vendedor exporta a própria carteira, pela mesma regra da tela.
          ...(dinheiro ? {} : { salespersonId: quem.id }),
        },
        orderBy: { createdAt: 'desc' },
        take: TETO_DE_LINHAS_CSV + 1,
        select: {
          id: true, status: true, createdAt: true, closedAt: true,
          listPrice: true, discount: true, saleValue: true,
          vehicleCostSnapshot: true, grossMargin: true,
          vehicle: {
            select: {
              versionName: true, yearModel: true, licensePlate: true,
              brand: { select: { name: true } },
              model: { select: { name: true } },
            },
          },
          salesperson: { select: { fullName: true } },
          customer: { select: { fullName: true } },
          buyer: { select: { fullName: true } },
        },
      }),
    );

    const cabecalho = [
      'ID', 'Status', 'Veículo', 'Ano', 'Placa', 'Vendedor', 'Comprador',
      'Tabela', 'Desconto', 'Venda',
      ...(dinheiro ? ['Custo do veículo', 'Margem bruta'] : []),
      'Criado em', 'Fechado em',
    ];

    const linhas = negocios.map((n) => [
      n.id,
      n.status,
      `${n.vehicle.brand.name} ${n.vehicle.model.name} ${n.vehicle.versionName ?? ''}`.trim(),
      n.vehicle.yearModel,
      n.vehicle.licensePlate ?? '',
      n.salesperson?.fullName ?? '',
      n.buyer?.fullName ?? n.customer?.fullName ?? '',
      n.listPrice.toFixed(2),
      n.discount.toFixed(2),
      n.saleValue.toFixed(2),
      ...(dinheiro
        ? [n.vehicleCostSnapshot?.toFixed(2) ?? '', n.grossMargin?.toFixed(2) ?? '']
        : []),
      n.createdAt.toISOString(),
      n.closedAt?.toISOString() ?? '',
    ]);

    return montarCsvComTeto(cabecalho, linhas);
  }

  /** Estoque atual: giro por veículo, com o estado do anúncio junto. */
  async csvDeEstoque(escopo: Escopo, quem: QuemPede): Promise<string> {
    const tenantId = this.tenantDe(escopo);
    const dinheiro = this.veDinheiro(quem);

    const veiculos = await this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
      tx.vehicle.findMany({
        where: { tenantId, status: { notIn: ['sold', 'archived'] } },
        orderBy: { createdAt: 'asc' },
        take: TETO_DE_LINHAS_CSV + 1,
        select: {
          id: true, versionName: true, yearModel: true, yearMake: true,
          licensePlate: true, mileageKm: true, color: true,
          status: true, listingStatus: true, price: true, promoPrice: true,
          createdAt: true, publishedAt: true,
          brand: { select: { name: true } },
          model: { select: { name: true } },
          acquisition: { select: { purchaseValue: true, enteredAt: true } },
          costs: { select: { value: true } },
        },
      }),
    );

    const cabecalho = [
      'ID', 'Veículo', 'Ano modelo', 'Ano fabricação', 'Placa', 'KM', 'Cor',
      'Status do estoque', 'Estado do anúncio', 'Preço', 'Preço promocional',
      ...(dinheiro ? ['Custo total', 'Tem aquisição registrada'] : []),
      'Dias em estoque', 'Publicado em',
    ];

    const linhas = veiculos.map((v) => {
      const compra = v.acquisition?.purchaseValue ?? new Prisma.Decimal(0);
      const preparo = v.costs.reduce((a, c) => a.plus(c.value), new Prisma.Decimal(0));
      const inicio = v.acquisition?.enteredAt ?? v.createdAt;

      return [
        v.id,
        `${v.brand.name} ${v.model.name} ${v.versionName ?? ''}`.trim(),
        v.yearModel,
        v.yearMake,
        v.licensePlate ?? '',
        v.mileageKm,
        v.color ?? '',
        v.status,
        v.listingStatus,
        v.price.toFixed(2),
        v.promoPrice?.toFixed(2) ?? '',
        ...(dinheiro
          ? [compra.plus(preparo).toFixed(2), v.acquisition ? 'sim' : 'não']
          : []),
        Math.max(0, Math.floor((Date.now() - inicio.getTime()) / 86_400_000)),
        v.publishedAt?.toISOString() ?? '',
      ];
    });

    return montarCsvComTeto(cabecalho, linhas);
  }

  /**
   * Por que a loja perdeu — consolidado por motivo.
   *
   * O negócio grava `cancel_reason_code` desde 23/09/2026 e **nenhuma tela
   * agrupava por ele**: o motivo aparecia no detalhe de cada negócio, um a um, e
   * "por que perdemos este mês" não tinha resposta. O lead já tinha essa
   * contagem (`/leads/stats`); o negócio, não.
   *
   * Um `groupBy` só, nunca um laço por motivo: a API roda a ~0,6s do banco.
   *
   * O valor sai de `listPrice` — o preço de tabela — porque negócio perdido cedo
   * não tem valor de venda negociado, e somar `saleValue` faria o total despencar
   * justamente nos que morreram antes da negociação.
   *
   * `codigo: null` é o negócio cancelado antes de 23/09/2026, quando o motivo
   * não era obrigatório. Aparece como "sem motivo registrado" em vez de sumir:
   * um total que não fecha com a lista é pior que uma linha honesta.
   */
  async motivosDePerda(escopo: Escopo, quem: QuemPede, days: number): Promise<{
    periodo: { days: number; from: Date };
    veDinheiro: boolean;
    total: number;
    motivos: { codigo: string | null; rotulo: string; quantidade: number; valorDeTabela: string | null }[];
  }> {
    const tenantId = this.tenantDe(escopo);
    const dinheiro = this.veDinheiro(quem);
    const from = new Date(Date.now() - days * 86_400_000);

    const grupos = await this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
      tx.deal.groupBy({
        by: ['cancelReasonCode'],
        where: {
          tenantId,
          status: { in: [...DEAL_TERMINAL_STATUSES] },
          updatedAt: { gte: from },
          // Vendedor vê a própria carteira, como no resto do painel.
          ...(dinheiro ? {} : { salespersonId: quem.id }),
        },
        _count: { _all: true },
        _sum: { listPrice: true },
      }),
    );

    const rotulos = new Map<string, string>(
      MOTIVOS_DE_CANCELAMENTO_DE_NEGOCIO.map((m) => [m.codigo as string, m.rotulo]),
    );

    const motivos = grupos
      .map((g) => ({
        codigo: g.cancelReasonCode ?? null,
        rotulo: g.cancelReasonCode
          ? rotulos.get(g.cancelReasonCode) ?? g.cancelReasonCode
          : 'Sem motivo registrado',
        quantidade: g._count._all,
        valorDeTabela: dinheiro ? (g._sum.listPrice?.toFixed(2) ?? '0.00') : null,
      }))
      .sort((a, b) => b.quantidade - a.quantidade || a.rotulo.localeCompare(b.rotulo));

    return {
      periodo: { days, from },
      veDinheiro: dinheiro,
      total: motivos.reduce((soma, m) => soma + m.quantidade, 0),
      motivos,
    };
  }

  /* ── Portabilidade: a loja leva os dados dela ───────────────────
   *
   * A LGPD dá ao titular o direito de levar seus dados, e o termo do programa
   * de fundadores promete o mesmo à loja. Até 27/09/2026 saíam leads,
   * desempenho, negócios e estoque — **agendamento, conversa e mensagem não
   * tinham como sair**, e é neles que mora o histórico de atendimento.
   *
   * Todos passam por `withTenant` e pelo mesmo recorte de carteira do resto:
   * vendedor leva o que é dele, gerência leva tudo. Nenhum deles é "exportar o
   * banco": o teto de linhas e o filtro de período continuam valendo.
   */

  /**
   * Agendamentos do período.
   *
   * O contato sai **copiado do próprio agendamento**, com o da conta como
   * segunda opção: o visitante que agenda sem cadastro
   * (`POST /appointments/dealer`) só existe ali, e ler do `customer` deixaria a
   * coluna vazia justamente nesses.
   */
  async csvDeAgendamentos(escopo: Escopo, quem: QuemPede, days: number): Promise<string> {
    const tenantId = this.tenantDe(escopo);
    const todos = this.veDinheiro(quem);
    const from = new Date(Date.now() - days * 86_400_000);

    const agendamentos = await this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
      tx.appointment.findMany({
        where: {
          tenantId,
          scheduledStart: { gte: from },
          ...(todos ? {} : { salespersonId: quem.id }),
        },
        orderBy: { scheduledStart: 'desc' },
        take: TETO_DE_LINHAS_CSV + 1,
        select: {
          id: true, type: true, status: true, scheduledStart: true, scheduledEnd: true,
          contactName: true, contactPhone: true, contactEmail: true,
          notes: true, cancellationReason: true, createdAt: true, leadId: true,
          customer: { select: { fullName: true, phone: true, email: true } },
          salesperson: { select: { fullName: true } },
          branch: { select: { name: true } },
          vehicle: {
            select: {
              versionName: true, yearModel: true,
              brand: { select: { name: true } },
              model: { select: { name: true } },
            },
          },
        },
      }),
    );

    const cabecalho = [
      'ID', 'Tipo', 'Status', 'Início', 'Fim', 'Cliente', 'Telefone', 'E-mail',
      'Veículo', 'Vendedor', 'Filial', 'Lead', 'Observações', 'Motivo do cancelamento',
      'Criado em',
    ];

    const linhas = agendamentos.map((a) => [
      a.id,
      a.type,
      a.status,
      a.scheduledStart.toISOString(),
      a.scheduledEnd.toISOString(),
      a.contactName ?? a.customer?.fullName ?? '',
      a.contactPhone ?? a.customer?.phone ?? '',
      a.contactEmail ?? a.customer?.email ?? '',
      a.vehicle
        ? `${a.vehicle.brand.name} ${a.vehicle.model.name} ${a.vehicle.versionName ?? ''} ${a.vehicle.yearModel}`.trim()
        : '',
      a.salesperson?.fullName ?? '',
      a.branch?.name ?? '',
      a.leadId ?? '',
      a.notes ?? '',
      a.cancellationReason ?? '',
      a.createdAt.toISOString(),
    ]);

    return montarCsvComTeto(cabecalho, linhas);
  }

  /** Conversas do período, uma por linha, com a contagem de mensagens. */
  async csvDeConversas(escopo: Escopo, quem: QuemPede, days: number): Promise<string> {
    const tenantId = this.tenantDe(escopo);
    const todos = this.veDinheiro(quem);
    const from = new Date(Date.now() - days * 86_400_000);

    const conversas = await this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
      tx.conversation.findMany({
        where: {
          tenantId,
          createdAt: { gte: from },
          ...(todos ? {} : { salespersonId: quem.id }),
        },
        orderBy: { createdAt: 'desc' },
        take: TETO_DE_LINHAS_CSV + 1,
        select: {
          id: true, status: true, createdAt: true, lastMessageAt: true,
          contactName: true, contactPhone: true, contactEmail: true, leadId: true,
          customer: { select: { fullName: true, phone: true, email: true } },
          salesperson: { select: { fullName: true } },
          vehicle: {
            select: {
              versionName: true, yearModel: true,
              brand: { select: { name: true } },
              model: { select: { name: true } },
            },
          },
          _count: { select: { messages: true } },
        },
      }),
    );

    const cabecalho = [
      'ID', 'Status', 'Cliente', 'Telefone', 'E-mail', 'Veículo', 'Vendedor',
      'Lead', 'Mensagens', 'Criada em', 'Última mensagem em',
    ];

    const linhas = conversas.map((c) => [
      c.id,
      c.status,
      c.contactName ?? c.customer?.fullName ?? '',
      c.contactPhone ?? c.customer?.phone ?? '',
      c.contactEmail ?? c.customer?.email ?? '',
      c.vehicle
        ? `${c.vehicle.brand.name} ${c.vehicle.model.name} ${c.vehicle.versionName ?? ''} ${c.vehicle.yearModel}`.trim()
        : '',
      c.salesperson?.fullName ?? '',
      c.leadId ?? '',
      c._count.messages,
      c.createdAt.toISOString(),
      c.lastMessageAt?.toISOString() ?? '',
    ]);

    return montarCsvComTeto(cabecalho, linhas);
  }

  /**
   * Clientes vinculados à loja.
   *
   * "Vinculado" é a mesma definição da policy `cliente_relacionado`, e a consulta
   * é **a mesma** que alimenta a busca de cliente das telas
   * (`common/clientes-relacionados.ts`): a loja não leva na exportação alguém que
   * ela não conseguiria achar na tela, nem o contrário.
   *
   * Só gerência exporta: a lista de clientes da loja é o ativo que sai pela porta
   * quando um vendedor troca de emprego, e a carteira já nasce fechada no resto
   * do produto por essa razão.
   */
  async csvDeClientes(escopo: Escopo, quem: QuemPede): Promise<string> {
    const tenantId = this.tenantDe(escopo);
    if (!this.veDinheiro(quem)) {
      throw new ForbiddenException(
        'A lista de clientes da loja é exportada pela gerência. ' +
          'Você continua exportando os leads e as conversas da sua carteira.',
      );
    }

    const clientes = await this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
      tx.$queryRaw<ClienteRelacionado[]>(
        consultaDeClientesRelacionados(tenantId, { limite: TETO_DE_LINHAS_CSV + 1 }),
      ),
    );

    const cabecalho = [
      'ID', 'Nome', 'E-mail', 'Telefone', 'Leads', 'Agendamentos', 'Conversas',
      'Primeiro contato', 'Último contato',
    ];

    const linhas = clientes.map((c) => [
      c.id, c.fullName, c.email, c.phone ?? '',
      c.leads, c.agendamentos, c.conversas,
      c.primeiroContato ? new Date(c.primeiroContato).toISOString() : '',
      c.ultimoContato ? new Date(c.ultimoContato).toISOString() : '',
    ]);

    return montarCsvComTeto(cabecalho, linhas);
  }

  /**
   * Mensagens, uma por linha — é o conteúdo do atendimento.
   *
   * `senderUserId` nulo é o cliente sem conta do chat do lead anônimo: a coluna
   * diz "cliente", e não fica vazia como se a mensagem não tivesse autor.
   */
  async csvDeMensagens(escopo: Escopo, quem: QuemPede, days: number): Promise<string> {
    const tenantId = this.tenantDe(escopo);
    const todos = this.veDinheiro(quem);
    const from = new Date(Date.now() - days * 86_400_000);

    const mensagens = await this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
      tx.message.findMany({
        where: {
          tenantId,
          createdAt: { gte: from },
          ...(todos ? {} : { conversation: { salespersonId: quem.id } }),
        },
        orderBy: { createdAt: 'desc' },
        take: TETO_DE_LINHAS_CSV + 1,
        select: {
          id: true, conversationId: true, kind: true, body: true,
          attachmentUrl: true, createdAt: true, readAt: true,
          sender: { select: { fullName: true, role: true } },
        },
      }),
    );

    const cabecalho = [
      'ID', 'Conversa', 'Quando', 'Autor', 'Papel do autor', 'Tipo', 'Texto',
      'Anexo', 'Lida em',
    ];

    const linhas = mensagens.map((m) => [
      m.id,
      m.conversationId,
      m.createdAt.toISOString(),
      m.sender?.fullName ?? 'cliente',
      m.sender?.role ?? 'sem conta',
      m.kind,
      m.body ?? '',
      m.attachmentUrl ?? '',
      m.readAt?.toISOString() ?? '',
    ]);

    return montarCsvComTeto(cabecalho, linhas);
  }
}
