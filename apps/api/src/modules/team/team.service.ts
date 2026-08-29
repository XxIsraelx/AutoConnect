import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@autoconnect/db';
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

    const members = await this.prisma.user.findMany({
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
    });

    // leads atribuídos no período OU ganhos no período
    const leads = await this.prisma.lead.findMany({
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
    });

    // agendamentos por vendedor no período
    const appts = await this.prisma.appointment.groupBy({
      by: ['salespersonId'],
      where: { tenantId, scheduledStart: { gte: start, lt: end } },
      _count: { _all: true },
    });
    const apptMap = new Map(appts.map((a) => [a.salespersonId, a._count._all]));

    // metas do período
    const goals = await this.prisma.salesGoal.findMany({ where: { tenantId, period } });
    const teamGoal = goals.find((g) => g.userId === null)?.target ?? null;
    const goalMap = new Map(goals.filter((g) => g.userId).map((g) => [g.userId, g.target]));

    // veículos vendidos no período (loja)
    const soldVehicles = await this.prisma.vehicle.findMany({
      where: { tenantId, status: 'sold', soldAt: { gte: start, lt: end } },
      select: { price: true },
    });

    const inPeriod = (d: Date | null) => !!d && d >= start && d < end;

    const memberStats = members.map((mem) => {
      const assigned = leads.filter((l) => l.assignedTo === mem.id && inPeriod(l.createdAt)).length;
      const wonLeads = leads.filter((l) => l.assignedTo === mem.id && l.status === 'won' && inPeriod(l.wonAt));
      const won = wonLeads.length;
      const valueSold = wonLeads.reduce((s, l) => s + Number(l.vehicle?.price ?? 0), 0);
      const conversion = assigned > 0 ? Math.round((won / assigned) * 100) : 0;
      const commissionPct =
        mem.salespersonProfile?.commissionPct != null
          ? Number(mem.salespersonProfile.commissionPct)
          : null;
      const commission = commissionPct != null ? (valueSold * commissionPct) / 100 : null;
      return {
        id: mem.id, email: mem.email, fullName: mem.fullName, role: mem.role,
        status: mem.status, lastLoginAt: mem.lastLoginAt, avatarUrl: mem.avatarUrl,
        goal: goalMap.get(mem.id) ?? null,
        assigned, won, conversion, valueSold,
        commissionPct, commission,
        appointments: apptMap.get(mem.id) ?? 0,
      };
    });

    const teamWon = leads.filter((l) => l.status === 'won' && inPeriod(l.wonAt));
    const teamAssigned = leads.filter((l) => inPeriod(l.createdAt)).length;
    const teamValue = teamWon.reduce((s, l) => s + Number(l.vehicle?.price ?? 0), 0);

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
    const existing = await this.prisma.salesGoal.findFirst({
      where: { tenantId, userId: userId ?? null, period },
    });
    if (existing) {
      return this.prisma.salesGoal.update({ where: { id: existing.id }, data: { target } });
    }
    return this.prisma.salesGoal.create({
      data: { tenantId, userId: userId ?? null, period, target },
    });
  }

  /** Define o percentual de comissão de um vendedor (cria o perfil se faltar) */
  async setCommission(tenantId: string, userId: string, pct: number | null): Promise<unknown> {
    // Garante que o usuário pertence ao tenant
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Membro não encontrado');

    return this.prisma.salespersonProfile.upsert({
      where: { userId },
      update: { commissionPct: pct },
      create: { userId, tenantId, commissionPct: pct },
      select: { userId: true, commissionPct: true },
    });
  }
}
