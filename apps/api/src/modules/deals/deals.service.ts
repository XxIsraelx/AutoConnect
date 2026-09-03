import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type DealStatus } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { isDealEditable, type DealStatusValue } from '@autoconnect/shared';
import type {
  CreateDealInput,
  UpdateDealInput,
  CreateDealPaymentInput,
  ListDealsInput,
  CreateAcquisitionInput,
  CreateVehicleCostInput,
  DadosDoCompradorInput,
} from '@autoconnect/shared';
import { DealStateService } from './deal-state.service';
import { MarginService } from './margin.service';

const INCLUDE_DETALHE = {
  vehicle: {
    select: {
      id: true, versionName: true, yearModel: true, yearMake: true,
      licensePlate: true, price: true, status: true,
      brand: { select: { name: true } },
      model: { select: { name: true } },
    },
  },
  customer: { select: { id: true, fullName: true, email: true, phone: true } },
  salesperson: { select: { id: true, fullName: true } },
  branch: { select: { id: true, name: true } },
  payments: { orderBy: { createdAt: 'asc' } },
  tradeIn: true,
  buyer: true,
  statusEvents: {
    orderBy: { occurredAt: 'desc' },
    include: { actor: { select: { id: true, fullName: true } } },
  },
} satisfies Prisma.DealInclude;

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    /**
     * Consolidado da plataforma para o super admin.
     *
     * O caminho global precisa da conexão privilegiada, não da comum: sem
     * contexto de tenant, a conexão da aplicação não enxerga linha nenhuma
     * assim que o RLS for ligado — o consolidado viraria vazio silencioso.
     */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly estado: DealStateService,
    private readonly margem: MarginService,
  ) {}

  /**
   * Escrita exige concessionária.
   *
   * O super admin sem loja selecionada tem escopo global e enxerga o
   * consolidado — mas gravar um negócio "de ninguém" não faz sentido, e um
   * `tenantId` indefinido numa tabela de dinheiro é exatamente o que o tipo
   * `Escopo` existe para impedir.
   */
  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new BadRequestException(
        'Selecione uma concessionária para operar negócios.',
      );
    }
    return escopo.tenantId;
  }

  async create(escopo: Escopo, autorId: string, input: CreateDealInput) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const veiculo = await tx.vehicle.findFirst({
        where: { id: input.vehicleId, tenantId },
        select: { id: true, status: true },
      });
      // 404 e não 403: confirmar que o veículo existe já entregaria informação
      // sobre o estoque de outra loja.
      if (!veiculo) throw new NotFoundException('Veículo não encontrado');

      this.conferirValores(input.listPrice, input.discount, input.saleValue);

      try {
        const negocio = await tx.deal.create({
          data: {
            tenantId,
            vehicleId: input.vehicleId,
            leadId: input.leadId,
            branchId: input.branchId,
            customerUserId: input.customerUserId,
            salespersonId: input.salespersonId ?? autorId,
            listPrice: new Prisma.Decimal(input.listPrice),
            discount: new Prisma.Decimal(input.discount),
            saleValue: new Prisma.Decimal(input.saleValue),
          },
          include: INCLUDE_DETALHE,
        });

        // O carro sai da vitrine enquanto o negócio está vivo.
        await tx.vehicle.update({
          where: { id: input.vehicleId },
          data: { status: 'reserved' },
        });

        await tx.dealStatusEvent.create({
          data: {
            tenantId,
            dealId: negocio.id,
            fromStatus: 'draft',
            toStatus: 'draft',
            actorUserId: autorId,
            reason: 'Negócio aberto',
          },
        });

        return negocio;
      } catch (e) {
        // O índice único parcial é quem garante isto de verdade: entre um
        // SELECT de checagem e o INSERT cabe outra transação.
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new ConflictException(
            'Este veículo já tem um negócio em andamento.',
          );
        }
        throw e;
      }
    });
  }


  /**
   * Clientes com quem a loja já se relacionou, para vincular ao negócio.
   *
   * O critério é o **mesmo** da policy `cliente_relacionado` (migration
   * 20260902150000): quem tem lead, agendamento ou conversa com esta
   * concessionária. Não é a base de clientes da plataforma — a loja não deve
   * enxergar quem nunca falou com ela.
   *
   * Cliente tem `tenant_id` nulo, então nenhum `where: { tenantId }` o
   * alcançaria; o vínculo é sempre indireto, por isso o SQL explícito.
   */
  async clientesRelacionados(escopo: Escopo, busca?: string) {
    const tenantId = this.tenantDe(escopo);
    const termo = busca?.trim() ? `%${busca.trim()}%` : null;

    return this.prisma.withTenant(tenantId, (tx) =>
      tx.$queryRaw<{ id: string; fullName: string; email: string; phone: string | null }[]>`
        SELECT u.id, u.full_name AS "fullName", u.email, u.phone
          FROM users u
         WHERE u.role = 'customer'
           AND u.status <> 'deleted'
           AND (
                EXISTS (SELECT 1 FROM leads l
                         WHERE l.customer_user_id = u.id AND l.tenant_id = ${tenantId}::uuid)
             OR EXISTS (SELECT 1 FROM appointments a
                         WHERE a.customer_user_id = u.id AND a.tenant_id = ${tenantId}::uuid)
             OR EXISTS (SELECT 1 FROM conversations c
                         WHERE c.customer_user_id = u.id AND c.tenant_id = ${tenantId}::uuid)
           )
           AND (${termo}::text IS NULL
                OR u.full_name ILIKE ${termo} OR u.email ILIKE ${termo})
         ORDER BY u.full_name
         LIMIT 20`,
    );
  }


  /**
   * Identificação do comprador para o contrato.
   *
   * Fica no negócio e não no perfil do cliente: a loja não escreve em
   * `customer_profiles` (isolado por `app.user_id`), e o contrato precisa do
   * dado como estava na emissão.
   */
  async salvarComprador(escopo: Escopo, id: string, dados: DadosDoCompradorInput) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const negocio = await tx.deal.findFirst({ where: { id, tenantId } });
      if (!negocio) throw new NotFoundException('Negócio não encontrado');

      if (!isDealEditable(negocio.status as DealStatusValue)) {
        throw new ConflictException(
          `Negócio em "${negocio.status}" não aceita alteração dos dados do comprador — ` +
            'há contrato assinado com a qualificação anterior.',
        );
      }

      return tx.dealBuyer.upsert({
        where: { dealId: id },
        create: { dealId: id, tenantId, ...dados },
        update: dados,
      });
    });
  }

  async findAll(escopo: Escopo, filtros: ListDealsInput) {
    const where: Prisma.DealWhereInput = {
      ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }),
      ...(filtros.status ? { status: filtros.status as DealStatus } : {}),
      ...(filtros.salespersonId ? { salespersonId: filtros.salespersonId } : {}),
      ...(filtros.vehicleId ? { vehicleId: filtros.vehicleId } : {}),
      ...(filtros.from || filtros.to
        ? { createdAt: { ...(filtros.from && { gte: filtros.from }), ...(filtros.to && { lte: filtros.to }) } }
        : {}),
    };

    const consulta = async (tx: ScopedClient) => {
      const [itens, total] = await Promise.all([
        tx.deal.findMany({
          where,
          include: INCLUDE_DETALHE,
          orderBy: { createdAt: 'desc' },
          skip: (filtros.page - 1) * filtros.perPage,
          take: filtros.perPage,
        }),
        tx.deal.count({ where }),
      ]);
      return { itens, total, page: filtros.page, perPage: filtros.perPage };
    };

    if (ehGlobal(escopo)) return consulta(this.privilegiado);
    return this.prisma.withTenant(escopo.tenantId, consulta);
  }

  async findOne(escopo: Escopo, id: string) {
    const buscar = async (tx: ScopedClient) => {
      const negocio = await tx.deal.findFirst({
        where: { id, ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }) },
        include: INCLUDE_DETALHE,
      });
      if (!negocio) throw new NotFoundException('Negócio não encontrado');
      return negocio;
    };

    if (ehGlobal(escopo)) return buscar(this.privilegiado);
    return this.prisma.withTenant(escopo.tenantId, buscar);
  }

  async update(escopo: Escopo, id: string, input: UpdateDealInput) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const negocio = await tx.deal.findFirst({ where: { id, tenantId } });
      if (!negocio) throw new NotFoundException('Negócio não encontrado');

      if (!isDealEditable(negocio.status as DealStatusValue)) {
        throw new ConflictException(
          `Negócio em "${negocio.status}" não aceita alteração de valores — ` +
            'há contrato assinado.',
        );
      }

      const lista = input.listPrice ?? negocio.listPrice.toFixed(2);
      const desconto = input.discount ?? negocio.discount.toFixed(2);
      const venda = input.saleValue ?? negocio.saleValue.toFixed(2);
      this.conferirValores(lista, desconto, venda);

      return tx.deal.update({
        where: { id },
        data: {
          ...(input.listPrice !== undefined && { listPrice: new Prisma.Decimal(input.listPrice) }),
          ...(input.discount !== undefined && { discount: new Prisma.Decimal(input.discount) }),
          ...(input.saleValue !== undefined && { saleValue: new Prisma.Decimal(input.saleValue) }),
          ...(input.branchId !== undefined && { branchId: input.branchId }),
          ...(input.salespersonId !== undefined && { salespersonId: input.salespersonId }),
          ...(input.customerUserId !== undefined && { customerUserId: input.customerUserId }),
        },
        include: INCLUDE_DETALHE,
      });
    });
  }

  async transition(
    escopo: Escopo,
    id: string,
    atorId: string,
    destino: DealStatusValue,
    motivo?: string,
  ) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const negocio = await tx.deal.findFirst({ where: { id, tenantId } });
      if (!negocio) throw new NotFoundException('Negócio não encontrado');

      await this.estado.transicionar(tx, negocio, destino, atorId, motivo);
      return tx.deal.findFirst({ where: { id, tenantId }, include: INCLUDE_DETALHE });
    });
  }

  async addPayment(escopo: Escopo, id: string, input: CreateDealPaymentInput) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const negocio = await tx.deal.findFirst({ where: { id, tenantId } });
      if (!negocio) throw new NotFoundException('Negócio não encontrado');

      if (!isDealEditable(negocio.status as DealStatusValue)) {
        throw new ConflictException(
          `Negócio em "${negocio.status}" não aceita novos pagamentos.`,
        );
      }

      const existentes = await tx.dealPayment.findMany({
        where: { dealId: id, status: { in: ['pending', 'confirmed'] } },
        select: { value: true },
      });
      const soma = existentes
        .reduce((acc, p) => acc.plus(p.value), new Prisma.Decimal(0))
        .plus(input.value);

      // Recusa o excesso na hora: um pagamento acima da venda é erro de
      // digitação, e deixá-lo entrar transforma a conferência da assinatura
      // num quebra-cabeça de qual lançamento está errado.
      if (soma.greaterThan(negocio.saleValue)) {
        throw new ConflictException(
          `A soma dos pagamentos ficaria em ${soma.toFixed(2)}, acima da venda ` +
            `de ${negocio.saleValue.toFixed(2)}.`,
        );
      }

      return tx.dealPayment.create({
        data: {
          tenantId,
          dealId: id,
          kind: input.kind,
          status: input.status,
          value: new Prisma.Decimal(input.value),
          institution: input.institution,
          installments: input.installments,
          installmentValue: input.installmentValue
            ? new Prisma.Decimal(input.installmentValue)
            : undefined,
          notes: input.notes,
          confirmedAt: input.status === 'confirmed' ? new Date() : undefined,
        },
      });
    });
  }

  /** Demonstrativo de margem do negócio. Restrito a manager+ no controller. */
  async margemDoNegocio(escopo: Escopo, id: string) {
    const ler = async (tx: ScopedClient) => {
      const negocio = await tx.deal.findFirst({
        where: { id, ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }) },
        select: {
          id: true, vehicleId: true, saleValue: true, status: true,
          grossMargin: true, vehicleCostSnapshot: true, closedAt: true,
        },
      });
      if (!negocio) throw new NotFoundException('Negócio não encontrado');

      // Depois de faturado vale o que foi congelado, não o custo de hoje.
      if (negocio.grossMargin != null && negocio.vehicleCostSnapshot != null) {
        return {
          vehicleId: negocio.vehicleId,
          congelado: true,
          totalCost: negocio.vehicleCostSnapshot.toFixed(2),
          saleValue: negocio.saleValue.toFixed(2),
          grossMargin: negocio.grossMargin.toFixed(2),
        };
      }

      const d = await this.margem.doVeiculo(
        tx, negocio.vehicleId, ehGlobal(escopo) ? undefined : escopo.tenantId,
        negocio.saleValue, negocio.closedAt,
      );
      return { ...d, congelado: false };
    };

    if (ehGlobal(escopo)) return ler(this.privilegiado);
    return this.prisma.withTenant(escopo.tenantId, ler);
  }

  async registrarAquisicao(escopo: Escopo, vehicleId: string, input: CreateAcquisitionInput) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const veiculo = await tx.vehicle.findFirst({
        where: { id: vehicleId, tenantId }, select: { id: true },
      });
      if (!veiculo) throw new NotFoundException('Veículo não encontrado');

      return tx.vehicleAcquisition.upsert({
        where: { vehicleId },
        create: {
          tenantId,
          vehicleId,
          origin: input.origin,
          supplierName: input.supplierName,
          supplierDocument: input.supplierDocument,
          purchaseValue: new Prisma.Decimal(input.purchaseValue),
          enteredAt: input.enteredAt,
          notes: input.notes,
        },
        update: {
          origin: input.origin,
          supplierName: input.supplierName,
          supplierDocument: input.supplierDocument,
          purchaseValue: new Prisma.Decimal(input.purchaseValue),
          enteredAt: input.enteredAt,
          notes: input.notes,
        },
      });
    });
  }

  async lancarCusto(escopo: Escopo, vehicleId: string, input: CreateVehicleCostInput) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const veiculo = await tx.vehicle.findFirst({
        where: { id: vehicleId, tenantId }, select: { id: true },
      });
      if (!veiculo) throw new NotFoundException('Veículo não encontrado');

      return tx.vehicleCost.create({
        data: {
          tenantId,
          vehicleId,
          kind: input.kind,
          value: new Prisma.Decimal(input.value),
          description: input.description,
          supplierName: input.supplierName,
          incurredAt: input.incurredAt,
        },
      });
    });
  }

  /** Giro de estoque: quanto tempo cada carro está parado e quanto já custou. */
  async relatorioEstoque(escopo: Escopo) {
    const ler = async (tx: ScopedClient) => {
      const veiculos = await tx.vehicle.findMany({
        where: {
          status: { in: ['available', 'reserved'] },
          ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }),
        },
        select: {
          id: true, versionName: true, yearModel: true, createdAt: true, price: true,
          brand: { select: { name: true } },
          model: { select: { name: true } },
          acquisition: { select: { purchaseValue: true, enteredAt: true } },
          costs: { select: { value: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      return veiculos.map((v) => {
        const compra = v.acquisition?.purchaseValue ?? new Prisma.Decimal(0);
        const preparo = v.costs.reduce((a, c) => a.plus(c.value), new Prisma.Decimal(0));
        const inicio = v.acquisition?.enteredAt ?? v.createdAt;

        return {
          vehicleId: v.id,
          descricao: `${v.brand.name} ${v.model.name} ${v.versionName ?? ''}`.trim(),
          yearModel: v.yearModel,
          price: v.price.toFixed(2),
          totalCost: compra.plus(preparo).toFixed(2),
          temAquisicao: v.acquisition != null,
          daysInStock: Math.max(
            0,
            Math.floor((Date.now() - inicio.getTime()) / 86_400_000),
          ),
        };
      });
    };

    if (ehGlobal(escopo)) return ler(this.privilegiado);
    return this.prisma.withTenant(escopo.tenantId, ler);
  }


  /** Aquisição, lançamentos e totais de um veículo — a aba de custo. */
  async custoDoVeiculo(escopo: Escopo, vehicleId: string) {
    const ler = async (tx: ScopedClient) => {
      const tenantId = ehGlobal(escopo) ? undefined : escopo.tenantId;

      const veiculo = await tx.vehicle.findFirst({
        where: { id: vehicleId, ...(tenantId ? { tenantId } : {}) },
        select: { id: true, createdAt: true, price: true, status: true },
      });
      if (!veiculo) throw new NotFoundException('Veículo não encontrado');

      const [aquisicao, custos] = await Promise.all([
        tx.vehicleAcquisition.findFirst({ where: { vehicleId, ...(tenantId ? { tenantId } : {}) } }),
        tx.vehicleCost.findMany({
          where: { vehicleId, ...(tenantId ? { tenantId } : {}) },
          orderBy: { incurredAt: 'desc' },
        }),
      ]);

      const compra = aquisicao?.purchaseValue ?? new Prisma.Decimal(0);
      const preparo = custos.reduce((a, c) => a.plus(c.value), new Prisma.Decimal(0));
      const inicio = aquisicao?.enteredAt ?? veiculo.createdAt;

      return {
        vehicleId,
        acquisition: aquisicao
          ? {
              origin: aquisicao.origin,
              supplierName: aquisicao.supplierName,
              purchaseValue: aquisicao.purchaseValue.toFixed(2),
              enteredAt: aquisicao.enteredAt,
              notes: aquisicao.notes,
            }
          : null,
        costs: custos.map((c) => ({
          id: c.id,
          kind: c.kind,
          value: c.value.toFixed(2),
          description: c.description,
          supplierName: c.supplierName,
          incurredAt: c.incurredAt,
        })),
        purchaseValue: compra.toFixed(2),
        costsTotal: preparo.toFixed(2),
        totalCost: compra.plus(preparo).toFixed(2),
        listPrice: veiculo.price.toFixed(2),
        daysInStock: Math.max(0, Math.floor((Date.now() - inicio.getTime()) / 86_400_000)),
      };
    };

    if (ehGlobal(escopo)) return ler(this.privilegiado);
    return this.prisma.withTenant(escopo.tenantId, ler);
  }

  /**
   * Margem por mês, para o gráfico de `/relatorios`.
   *
   * Considera só negócios já faturados: antes disso a margem é estimativa, e
   * misturar estimativa com realizado num gráfico de resultado é como a loja
   * passa a acreditar num lucro que ainda não teve. Usa o valor **congelado**
   * no faturamento, não o custo de hoje.
   */
  async relatorioMargem(escopo: Escopo, meses = 12) {
    const desde = new Date();
    desde.setMonth(desde.getMonth() - (meses - 1));
    desde.setDate(1);
    desde.setHours(0, 0, 0, 0);

    const ler = async (tx: ScopedClient) => {
      const negocios = await tx.deal.findMany({
        where: {
          ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }),
          status: { in: ['invoiced', 'documentation', 'delivered'] },
          closedAt: { gte: desde },
        },
        select: {
          closedAt: true, saleValue: true,
          grossMargin: true, vehicleCostSnapshot: true,
        },
        orderBy: { closedAt: 'asc' },
      });

      const porMes = new Map<
        string,
        { negocios: number; venda: Prisma.Decimal; custo: Prisma.Decimal; margem: Prisma.Decimal }
      >();

      for (const n of negocios) {
        if (!n.closedAt) continue;
        const chave = `${n.closedAt.getFullYear()}-${String(n.closedAt.getMonth() + 1).padStart(2, '0')}`;
        const atual = porMes.get(chave) ?? {
          negocios: 0,
          venda: new Prisma.Decimal(0),
          custo: new Prisma.Decimal(0),
          margem: new Prisma.Decimal(0),
        };
        atual.negocios += 1;
        atual.venda = atual.venda.plus(n.saleValue);
        atual.custo = atual.custo.plus(n.vehicleCostSnapshot ?? 0);
        atual.margem = atual.margem.plus(n.grossMargin ?? 0);
        porMes.set(chave, atual);
      }

      return [...porMes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([periodo, v]) => ({
          periodo,
          negocios: v.negocios,
          venda: v.venda.toFixed(2),
          custo: v.custo.toFixed(2),
          margem: v.margem.toFixed(2),
        }));
    };

    if (ehGlobal(escopo)) return ler(this.privilegiado);
    return this.prisma.withTenant(escopo.tenantId, ler);
  }

  /** `listPrice − discount` tem de ser `saleValue`. */
  private conferirValores(lista: string, desconto: string, venda: string): void {
    const esperado = new Prisma.Decimal(lista).minus(desconto);
    if (!esperado.equals(new Prisma.Decimal(venda))) {
      throw new BadRequestException(
        `O valor da venda deveria ser ${esperado.toFixed(2)} ` +
          `(tabela ${lista} − desconto ${desconto}), mas veio ${venda}.`,
      );
    }
  }
}
