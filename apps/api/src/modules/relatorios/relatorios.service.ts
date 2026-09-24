import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { DEAL_FATURADO_STATUSES } from '@autoconnect/shared';
import { montarCsv } from './csv';

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
        // Sem percentual configurado a comissão é `null`, e não zero: zero
        // diria "não ganhou nada", quando o que houve foi "ninguém informou
        // quanto ela ganha".
        const comissao = pct ? margem.times(pct).dividedBy(100).toDecimalPlaces(2) : null;

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
          comissaoEstimada: dinheiro ? (comissao?.toFixed(2) ?? null) : null,
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
        take: 5000,
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

    return montarCsv(cabecalho, linhas);
  }

  /** Estoque atual: giro por veículo, com o estado do anúncio junto. */
  async csvDeEstoque(escopo: Escopo, quem: QuemPede): Promise<string> {
    const tenantId = this.tenantDe(escopo);
    const dinheiro = this.veDinheiro(quem);

    const veiculos = await this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
      tx.vehicle.findMany({
        where: { tenantId, status: { notIn: ['sold', 'archived'] } },
        orderBy: { createdAt: 'asc' },
        take: 5000,
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

    return montarCsv(cabecalho, linhas);
  }
}
