import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { EmailService } from '../../common/email/email.service';

@Injectable()
export class AdminService {
  /**
   * Usa a conexão privilegiada de propósito: o painel do super admin consulta
   * todas as concessionárias por natureza, e `withTenant` não faria sentido
   * aqui. A travessia fica declarada no tipo, não escondida num `this.privilegiado`
   * igual ao de todo mundo.
   */
  constructor(
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly jwt:    JwtService,
    private readonly email:  EmailService,
  ) {}

  /* ── KPIs ──────────────────────────────────────────────────────────── */

  async getStats() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const [
      totalTenants, activeTenants, inactiveTenants,
      trialTenants, paidTenants,
      newTenantsMonth,
      totalUsers, totalVehicles, totalLeads, totalLeadsNew,
      activeInvites,
    ] = await Promise.all([
      this.privilegiado.tenant.count(),
      this.privilegiado.tenant.count({ where: { isActive: true } }),
      this.privilegiado.tenant.count({ where: { isActive: false } }),
      this.privilegiado.tenantSubscription.count({ where: { plan: 'trial' } }),
      this.privilegiado.tenantSubscription.count({ where: { plan: { not: 'trial' } } }),
      this.privilegiado.tenant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.privilegiado.user.count({ where: { role: { not: 'super_admin' } } }),
      this.privilegiado.vehicle.count(),
      this.privilegiado.lead.count(),
      this.privilegiado.lead.count({ where: { status: 'new' } }),
      this.privilegiado.tenantInvite.count({
        where: { usedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);

    return {
      totalTenants, activeTenants, inactiveTenants,
      trialTenants, paidTenants, newTenantsMonth,
      totalUsers, totalVehicles, totalLeads, totalLeadsNew,
      activeInvites,
    };
  }

  /* ── Convites ──────────────────────────────────────────────────────── */

  async createInvite(data: { email?: string; note?: string; expiresInDays?: number }) {
    const token     = randomBytes(32).toString('hex');
    const days      = data.expiresInDays ?? 7;
    const expiresAt = new Date(Date.now() + days * 86_400_000);

    const invite = await this.privilegiado.tenantInvite.create({
      data: { token, email: data.email ?? null, note: data.note ?? null, expiresAt },
    });

    await this.writeAudit({
      action: 'invite_created',
      entityType: 'tenant_invite',
      entityId: invite.id,
      diff: { email: data.email, note: data.note, expiresAt },
    });

    return invite;
  }

  listInvites() {
    return this.privilegiado.tenantInvite.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async revokeInvite(id: string) {
    const invite = await this.privilegiado.tenantInvite.findUnique({ where: { id } });
    if (!invite) throw new NotFoundException('Convite não encontrado');
    return this.privilegiado.tenantInvite.update({ where: { id }, data: { usedAt: new Date() } });
  }

  async deleteInvite(id: string) {
    const invite = await this.privilegiado.tenantInvite.findUnique({ where: { id } });
    if (!invite) throw new NotFoundException('Convite não encontrado');
    await this.privilegiado.tenantInvite.delete({ where: { id } });
    return { deleted: true };
  }

  /** Validação de convite usada pelo AuthService */
  async validateAndConsumeInvite(token: string, tenantId: string) {
    const invite = await this.privilegiado.tenantInvite.findUnique({ where: { token } });
    if (!invite)                   throw new BadRequestException('Convite inválido');
    if (invite.usedAt)             throw new BadRequestException('Este convite já foi utilizado');
    if (invite.expiresAt < new Date()) throw new BadRequestException('Convite expirado');
    await this.privilegiado.tenantInvite.update({
      where: { id: invite.id },
      data:  { usedAt: new Date(), usedBy: tenantId },
    });
  }

  /* ── Tenants ───────────────────────────────────────────────────────── */

  listTenants(): Promise<unknown[]> {
    return this.privilegiado.tenant.findMany({
      include: { subscription: true, branches: { take: 1 } },
      orderBy: { createdAt: 'desc' },
    }) as Promise<unknown[]>;
  }

  async getTenantDetail(tenantId: string): Promise<unknown> {
    const tenant = await this.privilegiado.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscription: true,
        branches: true,
        users: {
          select: {
            id: true, fullName: true, email: true,
            role: true, status: true, lastLoginAt: true, createdAt: true,
          },
          where: { role: { not: 'customer' } },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');

    const [vehicleCount, leadCount, leadNewCount] = await Promise.all([
      this.privilegiado.vehicle.count({ where: { tenantId } }),
      this.privilegiado.lead.count({ where: { tenantId } }),
      this.privilegiado.lead.count({ where: { tenantId, status: 'new' } }),
    ]);

    return { ...tenant, vehicleCount, leadCount, leadNewCount };
  }

  async changePlan(tenantId: string, plan: string): Promise<unknown> {
    const tenant = await this.privilegiado.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');

    const sub = await this.privilegiado.tenantSubscription.upsert({
      where:  { tenantId },
      update: { plan: plan as never, status: 'active' },
      create: { tenantId, plan: plan as never, status: 'active' },
    });

    await this.writeAudit({
      action: 'plan_changed',
      entityType: 'tenant',
      entityId: tenantId,
      diff: { plan },
    });

    return sub;
  }

  async extendTrial(tenantId: string, days: number): Promise<unknown> {
    const sub = await this.privilegiado.tenantSubscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundException('Assinatura não encontrada');

    const current = sub.trialEndsAt ?? new Date();
    const newEnd  = new Date(Math.max(current.getTime(), Date.now()) + days * 86_400_000);

    await this.writeAudit({
      action: 'trial_extended',
      entityType: 'tenant',
      entityId: tenantId,
      diff: { days, newTrialEndsAt: newEnd },
    });

    return this.privilegiado.tenantSubscription.update({
      where: { tenantId },
      data:  { trialEndsAt: newEnd },
    });
  }

  async toggleTenantActive(tenantId: string): Promise<unknown> {
    const tenant = await this.privilegiado.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');

    const updated = await this.privilegiado.tenant.update({
      where: { id: tenantId },
      data:  { isActive: !tenant.isActive },
    });

    await this.writeAudit({
      action: updated.isActive ? 'tenant_activated' : 'tenant_deactivated',
      entityType: 'tenant',
      entityId: tenantId,
    });

    return updated;
  }

  /** Gera token temporário para impersonar o admin de um tenant */
  async impersonate(tenantId: string): Promise<{ token: string; user: unknown }> {
    const tenant = await this.privilegiado.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');

    const user = await this.privilegiado.user.findFirst({
      where: { tenantId, role: 'tenant_admin', status: 'active' },
    });
    if (!user) throw new BadRequestException('Nenhum admin ativo nesta concessionária');

    // JWT com 2h de validade — para que o admin consiga navegar o dashboard
    const token = this.jwt.sign(
      { sub: user.id, role: user.role, tenantId: user.tenantId },
      { expiresIn: '2h' },
    );

    await this.writeAudit({
      action: 'impersonation',
      entityType: 'tenant',
      entityId: tenantId,
      diff: { targetUserId: user.id, targetEmail: user.email },
    });

    return {
      token,
      user: {
        id: user.id, email: user.email,
        fullName: user.fullName, role: user.role,
        tenantId: user.tenantId,
      },
    };
  }

  /* ── Usuários ──────────────────────────────────────────────────────── */

  async listUsers(opts: { role?: string; search?: string; page?: number }): Promise<unknown[]> {
    const page  = opts.page ?? 1;
    const take  = 30;
    const skip  = (page - 1) * take;

    return this.privilegiado.user.findMany({
      where: {
        role: opts.role ? (opts.role as never) : { not: 'super_admin' },
        ...(opts.search ? {
          OR: [
            { fullName: { contains: opts.search, mode: 'insensitive' } },
            { email:    { contains: opts.search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: {
        id: true, fullName: true, email: true, phone: true,
        role: true, status: true, jobTitle: true,
        lastLoginAt: true, createdAt: true,
        tenant: { select: { id: true, tradeName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take, skip,
    }) as Promise<unknown[]>;
  }

  async toggleUserSuspend(userId: string): Promise<unknown> {
    const user = await this.privilegiado.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.role === 'super_admin') throw new BadRequestException('Não é possível suspender super_admin');

    const newStatus = user.status === 'suspended' ? 'active' : 'suspended';

    await this.writeAudit({
      action: newStatus === 'suspended' ? 'user_suspended' : 'user_activated',
      entityType: 'user',
      entityId: userId,
    });

    return this.privilegiado.user.update({
      where: { id: userId },
      data:  { status: newStatus },
    });
  }

  async sendPasswordReset(userId: string): Promise<{ message: string }> {
    const user = await this.privilegiado.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const token = this.jwt.sign(
      { sub: user.id, purpose: 'password-reset' },
      { expiresIn: '1h' },
    );

    this.email.sendPasswordReset(user.email, user.fullName, token).catch(() => null);

    await this.writeAudit({
      action: 'admin_password_reset_sent',
      entityType: 'user',
      entityId: userId,
    });

    return { message: `Link de redefinição enviado para ${user.email}` };
  }

  /* ── Avisos globais ────────────────────────────────────────────────── */

  async createAnnouncement(data: {
    message: string;
    type?: string;
    expiresAt?: string | null;
  }): Promise<unknown> {
    // Desativa avisos anteriores do mesmo tipo
    await this.privilegiado.announcement.updateMany({
      where: { isActive: true },
      data:  { isActive: false },
    });

    return this.privilegiado.announcement.create({
      data: {
        message:   data.message,
        type:      data.type ?? 'info',
        isActive:  true,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });
  }

  listAnnouncements(): Promise<unknown[]> {
    return this.privilegiado.announcement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    }) as Promise<unknown[]>;
  }

  /** Endpoint público — chamado pelo dashboard de todos os tenants */
  async getActiveAnnouncement(): Promise<unknown | null> {
    return this.privilegiado.announcement.findFirst({
      where: {
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deactivateAnnouncement(id: string): Promise<unknown> {
    const ann = await this.privilegiado.announcement.findUnique({ where: { id } });
    if (!ann) throw new NotFoundException('Aviso não encontrado');
    return this.privilegiado.announcement.update({ where: { id }, data: { isActive: false } });
  }

  /* ── Auditoria ─────────────────────────────────────────────────────── */

  async getAuditLog(opts: { page?: number; action?: string }): Promise<unknown> {
    const page = opts.page ?? 1;
    const take = 30;
    const skip = (page - 1) * take;

    const where = opts.action ? { action: { contains: opts.action } } : {};

    const [entries, total] = await Promise.all([
      this.privilegiado.auditLog.findMany({
        where,
        include: { actor: { select: { fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take, skip,
      }),
      this.privilegiado.auditLog.count({ where }),
    ]);

    return { entries, total, page, pages: Math.ceil(total / take) };
  }

  async writeAudit(data: {
    action: string;
    entityType: string;
    entityId?: string;
    actorUserId?: string;
    diff?: Record<string, unknown>;
  }): Promise<void> {
    void this.privilegiado.auditLog.create({
      data: {
        action:      data.action,
        entityType:  data.entityType,
        entityId:    data.entityId   ?? null,
        actorUserId: data.actorUserId ?? null,
        diff:        (data.diff ?? {}) as never,
      },
    }).catch(() => undefined); // nunca bloqueia a operação principal
  }

  /* ── Status do sistema ─────────────────────────────────────────────── */

  async getSystemHealth(): Promise<unknown> {
    const results: Record<string, { status: 'up' | 'down'; latencyMs?: number }> = {};

    // Banco de dados
    try {
      const t0 = Date.now();
      await this.privilegiado.$queryRaw`SELECT 1`;
      results.database = { status: 'up', latencyMs: Date.now() - t0 };
    } catch {
      results.database = { status: 'down' };
    }

    // BrasilAPI (CNPJ)
    try {
      const t0 = Date.now();
      const r  = await fetch('https://brasilapi.com.br/api/cnpj/v1/00000000000000', { signal: AbortSignal.timeout(3000) });
      results.brasilapi = { status: r.status < 500 ? 'up' : 'down', latencyMs: Date.now() - t0 };
    } catch {
      results.brasilapi = { status: 'down' };
    }

    // ViaCEP
    try {
      const t0 = Date.now();
      const r  = await fetch('https://viacep.com.br/ws/01310100/json/', { signal: AbortSignal.timeout(3000) });
      results.viacep = { status: r.ok ? 'up' : 'down', latencyMs: Date.now() - t0 };
    } catch {
      results.viacep = { status: 'down' };
    }

    // Cloudinary
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    if (cloudName) {
      try {
        const t0 = Date.now();
        const r  = await fetch(`https://res.cloudinary.com/${cloudName}/image/upload/sample`, { signal: AbortSignal.timeout(3000) });
        results.cloudinary = { status: r.status < 500 ? 'up' : 'down', latencyMs: Date.now() - t0 };
      } catch {
        results.cloudinary = { status: 'down' };
      }
    }

    return results;
  }
}
