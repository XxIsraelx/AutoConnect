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
import type { InviteUserInput } from '@autoconnect/shared';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async create(
    tenantId: string,
    invitedBy: string,
    input: InviteUserInput,
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing && existing.tenantId === tenantId) {
      throw new ConflictException('usuário já faz parte do tenant');
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

    const invitation = await this.prisma.userInvitation.create({
      data: {
        tenantId,
        email: input.email,
        role: input.role,
        tokenHash,
        invitedBy,
        expiresAt,
      },
    });

    // TODO Sprint 1.5: enfileirar email via BullMQ + Resend
    // por enquanto, devolvemos o token pra dev/debug
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      acceptUrl: `${process.env.WEB_URL ?? 'http://localhost:3000'}/invite/${token}`,
    };
  }

  async listByTenant(tenantId: string) {
    return this.prisma.userInvitation.findMany({
      where: { tenantId, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  async revoke(tenantId: string, invitationId: string) {
    const inv = await this.prisma.userInvitation.findFirst({
      where: { id: invitationId, tenantId },
    });
    if (!inv) throw new NotFoundException();
    await this.prisma.userInvitation.delete({ where: { id: invitationId } });
    return { ok: true };
  }

  async accept(
    token: string,
    input: { fullName: string; password: string; phone?: string },
  ) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invitation = await this.prisma.userInvitation.findUnique({
      where: { tokenHash },
    });
    if (!invitation) throw new NotFoundException('convite inválido');
    if (invitation.acceptedAt)
      throw new BadRequestException('convite já utilizado');
    if (invitation.expiresAt.getTime() < Date.now())
      throw new BadRequestException('convite expirado');

    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
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
