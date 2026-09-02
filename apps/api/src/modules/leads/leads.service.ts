import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { EmailService } from '../../common/email/email.service';
import type { CreateLeadInput, UpdateLeadStatusInput } from '@autoconnect/shared';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    /** Consolidado da plataforma para o super admin. */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly email: EmailService,
  ) {}

  /** Cria um lead. O userId vem do token JWT (customer logado). */
  async create(
    userId: string,
    tenantId: string,
    input: CreateLeadInput,
  ): Promise<unknown> {
    const { lead, tenant, customer, vehicleInfo } = await this.prisma.withTenantAndUser(
      tenantId,
      userId,
      async (tx) => {
    // Busca dados do cliente
    const customer = await tx.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true, phone: true },
    });
    if (!customer) throw new NotFoundException('Usuário não encontrado');

    // Busca dados da concessionária (para o e-mail)
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { tradeName: true, primaryPhone: true, branches: {
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { email: true },
      }},
    });
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');

    // Info do veículo (se fornecido)
    let vehicleInfo = 'veículo';
    if (input.vehicleId) {
      const vehicle = await tx.vehicle.findUnique({
        where: { id: input.vehicleId },
        select: {
          versionName: true,
          yearModel: true,
          brand: { select: { name: true } },
          model: { select: { name: true } },
        },
      });
      if (vehicle) {
        vehicleInfo = `${vehicle.brand.name} ${vehicle.model.name} ${vehicle.versionName} ${vehicle.yearModel}`;
      }
    }

    const lead = await tx.lead.create({
      data: {
        tenantId,
        customerUserId: userId,
        vehicleId: input.vehicleId ?? null,
        branchId: input.branchId ?? null,
        contactName: input.contactName ?? customer.fullName,
        contactEmail: input.contactEmail ?? customer.email,
        contactPhone: input.contactPhone ?? customer.phone ?? null,
        source: input.source,
        message: input.message ?? null,
        status: 'new',
      },
    });

        return { lead, tenant, customer, vehicleInfo };
      },
    );

    // Dispara e-mail de notificação para a concessionária (não bloqueante)
    const dealerEmail = tenant.branches[0]?.email;
    if (dealerEmail) {
      this.email
        .sendLeadNotification({
          to: dealerEmail,
          dealerName: tenant.tradeName,
          customerName: customer.fullName,
          vehicleInfo,
          message: input.message ?? null,
          leadUrl: `${process.env.WEB_URL ?? 'http://localhost:3000'}/dashboard/leads`,
        })
        .catch(() => {/* silencia erros de e-mail */});
    }

    return lead;
  }

  /** Lista leads da concessionária autenticada (dealer/admin) */
  async findAll(escopo: Escopo, opts: {
    status?: string;
    vehicleId?: string;
    page?: number;
    perPage?: number;
  }): Promise<unknown> {
    const { status, vehicleId, page = 1, perPage = 20 } = opts;
    const skip = (page - 1) * perPage;

    const where = {
      ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }),
      ...(status ? { status: status as 'new' | 'contacted' | 'qualified' | 'negotiating' | 'won' | 'lost' | 'archived' } : {}),
      ...(vehicleId ? { vehicleId } : {}),
    };

    const consultar = async (tx: ScopedClient) => {
      const [items, total] = await Promise.all([
        tx.lead.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          vehicle: {
            select: {
              id: true,
              versionName: true,
              yearModel: true,
              price: true,
              brand: { select: { name: true } },
              model: { select: { name: true } },
              images: { where: { isCover: true }, take: 1, select: { url: true } },
            },
          },
          customer: {
            select: { id: true, fullName: true, email: true, phone: true },
          },
        },
      }),
        tx.lead.count({ where }),
      ]);

      return { items, total, page, perPage };
    };

    return ehGlobal(escopo)
      ? consultar(this.privilegiado)
      : this.prisma.withTenant(escopo.tenantId, consultar);
  }

  /** Atualiza status de um lead (dealer/admin) */
  async updateStatus(
    tenantId: string,
    leadId: string,
    input: UpdateLeadStatusInput,
  ): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId } });
      if (!lead) throw new NotFoundException('Lead não encontrado');

      return tx.lead.update({
        where: { id: leadId },
        data: { status: input.status },
      });
    });
  }

  /** Conta leads por status para o dashboard (dealer/admin) */
  async getStats(escopo: Escopo): Promise<unknown> {
    const agrupar = (tx: ScopedClient) =>
      tx.lead.groupBy({
        by: ['status'],
        where: ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId },
        _count: { _all: true },
      });

    const groups = await (ehGlobal(escopo)
      ? agrupar(this.privilegiado)
      : this.prisma.withTenant(escopo.tenantId, agrupar));

    const stats: Record<string, number> = {};
    for (const g of groups) {
      stats[g.status] = g._count._all;
    }
    return stats;
  }

  /** Deleta / arquiva um lead (dealer/admin) */
  async remove(tenantId: string, leadId: string): Promise<{ deleted: boolean }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId } });
      if (!lead) throw new NotFoundException('Lead não encontrado');
      await tx.lead.delete({ where: { id: leadId } });
    });
    return { deleted: true };
  }

  /** Atribui lead a um vendedor */
  async assign(tenantId: string, leadId: string, salesPersonId: string | null): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId } });
      if (!lead) throw new NotFoundException('Lead não encontrado');

      if (salesPersonId) {
        const sp = await tx.user.findFirst({
          where: { id: salesPersonId, tenantId, status: 'active' },
        });
        if (!sp) throw new NotFoundException('Vendedor não encontrado');
      }

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: { assignedTo: salesPersonId },
        include: { assignee: { select: { id: true, fullName: true, email: true } } },
      });

      await tx.leadInteraction.create({
        data: {
          leadId,
          tenantId,
          kind: 'assignment',
          content: salesPersonId ? `Lead atribuído` : 'Atribuição removida',
          payload: { salesPersonId } as never,
        },
      });

      return updated;
    });
  }

  /** Histórico completo de um lead (timeline) */
  async getHistory(tenantId: string, leadId: string): Promise<unknown> {
    const lead = await this.prisma.withTenant(tenantId, (tx) =>
      tx.lead.findFirst({
      where: { id: leadId, tenantId },
      include: {
        vehicle: {
          select: {
            id: true, versionName: true, yearModel: true, price: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
            images: { where: { isCover: true }, take: 1, select: { url: true } },
          },
        },
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
        assignee:  { select: { id: true, fullName: true, email: true } },
        interactions: {
          orderBy: { occurredAt: 'asc' },
          include: { actor: { select: { id: true, fullName: true } } },
        },
        appointments: {
          orderBy: { scheduledStart: 'asc' },
          select: { id: true, scheduledStart: true, scheduledEnd: true, status: true, type: true, notes: true },
        },
      },
      }),
    );
    if (!lead) throw new NotFoundException('Lead não encontrado');
    return lead;
  }

  /** Adiciona interação manual a um lead */
  async addInteraction(
    tenantId: string,
    leadId: string,
    actorUserId: string,
    kind: string,
    content: string,
  ): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId } });
      if (!lead) throw new NotFoundException('Lead não encontrado');

      const interaction = await tx.leadInteraction.create({
        data: {
          leadId, tenantId, actorUserId, kind, content,
        },
      });

      // Atualiza lastActivityAt
      await tx.lead.update({
        where: { id: leadId },
        data: { lastActivityAt: new Date() },
      });

      return interaction;
    });
  }

  /**
   * Avaliação de um lead de troca: o vendedor informa quanto vale o veículo
   * oferecido. Guarda na metadata, registra na timeline e avisa o cliente.
   */
  async setTradeInAppraisal(
    tenantId: string,
    leadId: string,
    actorUserId: string,
    input: { value: number; note?: string; status?: 'offered' | 'rejected' },
  ): Promise<unknown> {
    const { lead, updated, offered } = await this.prisma.withTenant(tenantId, async (tx) => {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, tenantId },
      include: {
        tenant:  { select: { tradeName: true } },
        vehicle: {
          select: {
            price: true, versionName: true, yearModel: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
          },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (lead.source !== 'trade_in') throw new BadRequestException('Este lead não é uma proposta de troca');

    const meta = (lead.metadata && typeof lead.metadata === 'object' ? lead.metadata : {}) as Record<string, unknown>;
    const tradeIn = (meta.tradeIn && typeof meta.tradeIn === 'object' ? meta.tradeIn : {}) as Record<string, unknown>;
    const offered = (tradeIn.vehicle ?? {}) as { brandName?: string; modelName?: string; versionName?: string; yearModel?: number };

    const appraisal = {
      value: input.value,
      note: input.note ?? null,
      status: input.status ?? 'offered',
      evaluatedBy: actorUserId,
      evaluatedAt: new Date().toISOString(),
    };
    const newMeta = { ...meta, tradeIn: { ...tradeIn, appraisal } };

    const updated = await tx.lead.update({
      where: { id: leadId },
      data: {
        metadata: newMeta as Prisma.InputJsonValue,
        lastActivityAt: new Date(),
      },
    });

    await tx.leadInteraction.create({
      data: {
        leadId, tenantId, actorUserId,
        kind: 'trade_in_appraisal',
        content: input.status === 'rejected'
          ? 'Proposta de troca recusada'
          : `Veículo avaliado em R$ ${input.value.toLocaleString('pt-BR')}`,
        payload: { value: input.value, status: appraisal.status } as never,
      },
    });

      return { lead, updated, offered };
    });

    // Avisa o cliente (e-mail de contato do lead)
    if (lead.contactEmail && input.status !== 'rejected') {
      const offeredInfo = `${offered.brandName ?? ''} ${offered.modelName ?? ''} ${offered.versionName ?? ''} ${offered.yearModel ?? ''}`.replace(/\s+/g, ' ').trim();
      const desiredInfo = lead.vehicle
        ? `${lead.vehicle.brand.name} ${lead.vehicle.model.name} ${lead.vehicle.versionName ?? ''} ${lead.vehicle.yearModel}`.replace(/\s+/g, ' ').trim()
        : null;
      this.email.sendTradeInAppraisal({
        to: lead.contactEmail,
        customerName: lead.contactName ?? 'cliente',
        dealerName: lead.tenant.tradeName,
        offeredVehicle: offeredInfo || 'seu veículo',
        value: input.value,
        desiredVehicle: desiredInfo,
        desiredPrice: lead.vehicle ? Number(lead.vehicle.price) : null,
        note: input.note ?? null,
      }).catch(() => {/* silencia erros de e-mail */});
    }

    return updated;
  }

  /** Exporta leads como CSV */
  async exportCsv(tenantId: string, opts: { status?: string; from?: string; to?: string }): Promise<string> {
    const where = {
      tenantId,
      ...(opts.status ? { status: opts.status as never } : {}),
      ...(opts.from || opts.to ? {
        createdAt: {
          ...(opts.from ? { gte: new Date(opts.from) } : {}),
          ...(opts.to   ? { lte: new Date(opts.to)   } : {}),
        },
      } : {}),
    };

    const leads = await this.prisma.withTenant(tenantId, (tx) =>
      tx.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        vehicle: { select: { versionName: true, yearModel: true, price: true, brand: { select: { name: true } }, model: { select: { name: true } } } },
        customer: { select: { fullName: true, email: true, phone: true } },
        assignee:  { select: { fullName: true } },
      },
      take: 5000,
      }),
    );

    const header = ['ID', 'Nome', 'E-mail', 'Telefone', 'Veículo', 'Preço', 'Fonte', 'Status', 'Vendedor', 'Mensagem', 'Criado em'];
    const rows = leads.map((l) => [
      l.id,
      l.contactName ?? l.customer?.fullName ?? '',
      l.contactEmail ?? l.customer?.email ?? '',
      l.contactPhone ?? l.customer?.phone ?? '',
      l.vehicle ? `${l.vehicle.brand.name} ${l.vehicle.model.name} ${l.vehicle.versionName ?? ''} ${l.vehicle.yearModel}` : '',
      l.vehicle?.price?.toString() ?? '',
      l.source,
      l.status,
      l.assignee?.fullName ?? '',
      (l.message ?? '').replace(/[\r\n,]/g, ' '),
      l.createdAt.toISOString(),
    ]);

    return [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  }
}
