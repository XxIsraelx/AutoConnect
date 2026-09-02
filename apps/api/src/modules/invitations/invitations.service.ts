import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { EmailService } from '../../common/email/email.service';
import type { InviteUserInput } from '@autoconnect/shared';

const ROLE_LABELS: Record<string, string> = {
  tenant_admin: 'Administrador',
  manager: 'Gerente',
  salesperson: 'Vendedor',
  receptionist: 'Recepcionista',
};

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    /**
     * Privilegiada para os dois caminhos que acontecem antes de existir tenant:
     * o aceite do convite (busca por token) e a checagem de e-mail já cadastrado,
     * que é global — o mesmo e-mail não pode existir em duas concessionárias.
     */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  private acceptUrl(token: string): string {
    return `${process.env.WEB_URL ?? 'http://localhost:3000'}/invite/${token}`;
  }

  private async sendInviteEmail(tenantId: string, email: string, role: string, token: string) {
    const tenant = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { tradeName: true } }),
    );
    this.email.sendTeamInvite({
      to: email,
      inviteUrl: this.acceptUrl(token),
      roleLabel: ROLE_LABELS[role] ?? role,
      tenantName: tenant?.tradeName ?? 'concessionária',
    }).catch(() => { /* não bloqueia a criação do convite */ });
  }

  async create(
    tenantId: string,
    invitedBy: string,
    input: InviteUserInput,
  ) {
    const existing = await this.privilegiado.user.findUnique({
      where: { email: input.email },
    });
    if (existing && existing.tenantId === tenantId) {
      throw new ConflictException('usuário já faz parte do tenant');
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

    const invitation = await this.prisma.withTenant(tenantId, (tx) => tx.userInvitation.create({
      data: {
        tenantId,
        email: input.email,
        role: input.role,
        tokenHash,
        invitedBy,
        expiresAt,
      },
    }));

    // envia o e-mail de convite (não bloqueia a resposta)
    await this.sendInviteEmail(tenantId, input.email, input.role, token);

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      acceptUrl: this.acceptUrl(token),
    };
  }

  /** Reenvia um convite pendente (gera novo token + renova validade) */
  async resend(tenantId: string, invitationId: string) {
    const inv = await this.prisma.withTenant(tenantId, (tx) => tx.userInvitation.findFirst({
      where: { id: invitationId, tenantId, acceptedAt: null },
    }));
    if (!inv) throw new NotFoundException('Convite não encontrado.');

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.withTenant(tenantId, (tx) => tx.userInvitation.update({
      where: { id: invitationId },
      data: { tokenHash, expiresAt },
    }));

    await this.sendInviteEmail(tenantId, inv.email, inv.role, token);

    return { id: invitationId, email: inv.email, role: inv.role, expiresAt, acceptUrl: this.acceptUrl(token) };
  }

  async listByTenant(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.userInvitation.findMany({
      where: { tenantId, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
      },
    }));
  }

  async revoke(tenantId: string, invitationId: string) {
    const inv = await this.prisma.withTenant(tenantId, (tx) => tx.userInvitation.findFirst({
      where: { id: invitationId, tenantId },
    }));
    if (!inv) throw new NotFoundException();
    await this.prisma.withTenant(tenantId, (tx) => tx.userInvitation.delete({ where: { id: invitationId } }));
    return { ok: true };
  }

  async accept(
    token: string,
    input: { fullName: string; password: string; phone?: string },
  ) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invitation = await this.privilegiado.userInvitation.findUnique({
      where: { tokenHash },
    });
    if (!invitation) throw new NotFoundException('convite inválido');
    if (invitation.acceptedAt)
      throw new BadRequestException('convite já utilizado');
    if (invitation.expiresAt.getTime() < Date.now())
      throw new BadRequestException('convite expirado');

    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await this.privilegiado.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          tenantId: invitation.tenantId,
          email: invitation.email,
          fullName: input.fullName,
          phone: input.phone,
          passwordHash,
          role: invitation.role,
          status: 'active',
          emailVerifiedAt: new Date(),
        },
      });

      if (invitation.role === 'salesperson') {
        await tx.salespersonProfile.create({
          data: { userId: u.id, tenantId: invitation.tenantId },
        });
      }

      await tx.userInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      return u;
    });

    const accessToken = this.jwt.sign({
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
    });
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }
}
