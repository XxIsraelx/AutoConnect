import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@autoconnect/db';
import { Prisma } from '@autoconnect/db';
import { PrismaService } from '../../common/prisma/prisma.service';

const MEMBER_ROLES: UserRole[] = [
  UserRole.tenant_admin, UserRole.manager, UserRole.salesperson,
];

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  private periodRange(period: string) {
    const [y, m] = period.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    return { start, end };
  }

  /** Visão geral de desempenho da equipe num período "YYYY-MM" */
  async overview(tenantId: string, period: string): Promise<unknown> {
    const { start, end } = this.periodRange(period);

    // Uma transação só, em vez de cinco idas ao banco: além do isolamento, é
    // ganho de latência — API e banco estão em regiões diferentes.
    const { members, leads, appts, goals, soldVehicles, negocios } = await this.prisma.withTenant(
      tenantId,
      async (tx) => ({
        members: await tx.user.findMany({
      where: {
        tenantId,
        status: { not: 'deleted' },
        role: { in: MEMBER_ROLES },
      },
      select: {
        id: true, email: true, fullName: true, role: true,
        status: true, lastLoginAt: true, avatarUrl: true, createdAt: true,
        salespersonProfile: { select: { commissionPct: true } },
      },
          orderBy: { createdAt: 'asc' },
        }),
        // leads atribuídos no período OU ganhos no período
        leads: await tx.lead.findMany({
      where: {
        tenantId,
        OR: [
          { createdAt: { gte: start, lt: end } },
          { wonAt: { gte: start, lt: end } },
        ],
      },
      select: {
        assignedTo: true, status: true, wonAt: true, createdAt: true,
            vehicle: { select: { price: true } },
          },
        }),
        // agendamentos por vendedor no período
        appts: await tx.appointment.groupBy({
      by: ['salespersonId'],
      where: { tenantId, scheduledStart: { gte: start, lt: end } },
          _count: { _all: true },
        }),
        // metas do período
        goals: await tx.salesGoal.findMany({ where: { tenantId, period } }),
        // Negócios faturados no período. É daqui que sai o valor vendido:
        // antes ele vinha de `lead.vehicle.price`, o preço de **tabela**, e
        // a comissão saía sobre um valor que o cliente nunca pagou — sempre
        // acima do real, porque desconto é a regra e não a exceção.
        negocios: await tx.deal.findMany({
          where: {
            tenantId,
            status: { in: ['invoiced', 'documentation', 'delivered'] },
            closedAt: { gte: start, lt: end },
          },
          select: { salespersonId: true, saleValue: true },
        }),
        // veículos vendidos no período (loja)
        soldVehicles: await tx.vehicle.findMany({
          where: { tenantId, status: 'sold', soldAt: { gte: start, lt: end } },
          select: { price: true },
        }),
      }),
    );

    const apptMap = new Map(appts.map((a) => [a.salespersonId, a._count._all]));

    // Soma em Decimal, nunca com `Number`: um centavo de diferença numa
    // comissão vira ligação do vendedor.
    const vendidoPor = new Map<string, Prisma.Decimal>();
    for (const n of negocios) {
      if (!n.salespersonId) continue;
      vendidoPor.set(
        n.salespersonId,
        (vendidoPor.get(n.salespersonId) ?? new Prisma.Decimal(0)).plus(n.saleValue),
      );
    }
    const vendidoNaLoja = negocios.reduce(
      (a, n) => a.plus(n.saleValue),
      new Prisma.Decimal(0),
    );
    const teamGoal = goals.find((g) => g.userId === null)?.target ?? null;
    const goalMap = new Map(goals.filter((g) => g.userId).map((g) => [g.userId, g.target]));

    const inPeriod = (d: Date | null) => !!d && d >= start && d < end;

    const memberStats = members.map((mem) => {
      const assigned = leads.filter((l) => l.assignedTo === mem.id && inPeriod(l.createdAt)).length;
      const wonLeads = leads.filter((l) => l.assignedTo === mem.id && l.status === 'won' && inPeriod(l.wonAt));
      const won = wonLeads.length;
      const vendido = vendidoPor.get(mem.id) ?? new Prisma.Decimal(0);
      const conversion = assigned > 0 ? Math.round((won / assigned) * 100) : 0;
      const commissionPct =
        mem.salespersonProfile?.commissionPct != null
          ? Number(mem.salespersonProfile.commissionPct)
          : null;
      const commission =
        commissionPct != null
          ? vendido.times(commissionPct).dividedBy(100).toFixed(2)
          : null;
      return {
        id: mem.id, email: mem.email, fullName: mem.fullName, role: mem.role,
        status: mem.status, lastLoginAt: mem.lastLoginAt, avatarUrl: mem.avatarUrl,
        goal: goalMap.get(mem.id) ?? null,
        assigned, won, conversion,
        // string: é assim que Decimal atravessa o JSON, e o front formata sem
        // fazer conta.
        valueSold: vendido.toFixed(2),
        commissionPct, commission,
        appointments: apptMap.get(mem.id) ?? 0,
      };
    });

    const teamWon = leads.filter((l) => l.status === 'won' && inPeriod(l.wonAt));
    const teamAssigned = leads.filter((l) => inPeriod(l.createdAt)).length;
    const teamValue = vendidoNaLoja.toFixed(2);

    const team = {
      goal: teamGoal,
      won: teamWon.length,
      assigned: teamAssigned,
      conversion: teamAssigned > 0 ? Math.round((teamWon.length / teamAssigned) * 100) : 0,
      valueSold: teamValue,
      vehiclesSold: soldVehicles.length,
      vehiclesSoldValue: soldVehicles.reduce((s, v) => s + Number(v.price), 0),
      memberCount: members.length,
    };

    return { period, team, members: memberStats };
  }

  /** Define/atualiza uma meta (userId null = meta da equipe) */
  async setGoal(tenantId: string, userId: string | null, period: string, target: number): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.salesGoal.findFirst({
        where: { tenantId, userId: userId ?? null, period },
      });
      if (existing) {
        return tx.salesGoal.update({ where: { id: existing.id }, data: { target } });
      }
      return tx.salesGoal.create({
        data: { tenantId, userId: userId ?? null, period, target },
      });
    });
  }

  /** Define o percentual de comissão de um vendedor (cria o perfil se faltar) */
  async setCommission(tenantId: string, userId: string, pct: number | null): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      // Garante que o usuário pertence ao tenant
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('Membro não encontrado');

      return tx.salespersonProfile.upsert({
        where: { userId },
        update: { commissionPct: pct },
        create: { userId, tenantId, commissionPct: pct },
        select: { userId: true, commissionPct: true },
      });
    });
  }
}
