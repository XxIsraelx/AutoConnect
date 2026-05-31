import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import type { CreateLeadInput, UpdateLeadStatusInput } from '@autoconnect/shared';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** Cria um lead. O userId vem do token JWT (customer logado). */
  async create(
    userId: string,
    tenantId: string,
    input: CreateLeadInput,
  ): Promise<unknown> {
    // Busca dados do cliente
    const customer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true, phone: true },
    });
    if (!customer) throw new NotFoundException('Usuário não encontrado');

    // Busca dados da concessionária (para o e-mail)
    const tenant = await this.prisma.tenant.findUnique({
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
      const vehicle = await this.prisma.vehicle.findUnique({
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

    const lead = await this.prisma.lead.create({
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
  async findAll(tenantId: string, opts: {
    status?: string;
    vehicleId?: string;
    page?: number;
    perPage?: number;
  }): Promise<unknown> {
    const { status, vehicleId, page = 1, perPage = 20 } = opts;
    const skip = (page - 1) * perPage;

    const where = {
      tenantId,
      ...(status ? { status: status as 'new' | 'contacted' | 'qualified' | 'negotiating' | 'won' | 'lost' | 'archived' } : {}),
      ...(vehicleId ? { vehicleId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
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
      this.prisma.lead.count({ where }),
    ]);

    return { items, total, page, perPage };
  }

  /** Atualiza status de um lead (dealer/admin) */
  async updateStatus(
    tenantId: string,
    leadId: string,
    input: UpdateLeadStatusInput,
  ): Promise<unknown> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) throw new NotFoundException('Lead não encontrado');

    return this.prisma.lead.update({
      where: { id: leadId },
      data: { status: input.status },
    });
  }

  /** Conta leads por status para o dashboard (dealer/admin) */
  async getStats(tenantId: string): Promise<unknown> {
    const groups = await this.prisma.lead.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
    });

    const stats: Record<string, number> = {};
    for (const g of groups) {
      stats[g.status] = g._count._all;
    }
    return stats;
  }

  /** Deleta / arquiva um lead (dealer/admin) */
  async remove(tenantId: string, leadId: string): Promise<{ deleted: boolean }> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    await this.prisma.lead.delete({ where: { id: leadId } });
    return { deleted: true };
  }

  /** Atribui lead a um vendedor */
  async assign(tenantId: string, leadId: string, salesPersonId: string | null): Promise<unknown> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) throw new NotFoundException('Lead não encontrado');

    if (salesPersonId) {
      const sp = await this.prisma.user.findFirst({
        where: { id: salesPersonId, tenantId, status: 'active' },
      });
      if (!sp) throw new NotFoundException('Vendedor não encontrado');
    }

    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data: { assignedTo: salesPersonId },
      include: { assignee: { select: { id: true, fullName: true, email: true } } },
    });

    await this.prisma.leadInteraction.create({
      data: {
        leadId,
        tenantId,
        kind: 'assignment',
        content: salesPersonId ? `Lead atribuído` : 'Atribuição removida',
        payload: { salesPersonId } as never,
      },
    });

    return updated;
  }

  /** Histórico completo de um lead (timeline) */
  async getHistory(tenantId: string, leadId: string): Promise<unknown> {
    const lead = await this.prisma.lead.findFirst({
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
    });
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
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) throw new NotFoundException('Lead não encontrado');

    const interaction = await this.prisma.leadInteraction.create({
      data: {
        leadId, tenantId, actorUserId, kind, content,
      },
    });

    // Atualiza lastActivityAt
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { lastActivityAt: new Date() },
    });

    return interaction;
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

    const leads = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        vehicle: { select: { versionName: true, yearModel: true, price: true, brand: { select: { name: true } }, model: { select: { name: true } } } },
        customer: { select: { fullName: true, email: true, phone: true } },
        assignee:  { select: { fullName: true } },
      },
      take: 5000,
    });

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
