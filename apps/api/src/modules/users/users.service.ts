import {
  Injectable, BadRequestException, UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  listByTenant(tenantId: string): Promise<
    Array<{
      id: string;
      email: string;
      fullName: string | null;
      role: string;
      status: string;
      lastLoginAt: Date | null;
      createdAt: Date;
    }>
  > {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.user.findMany({
        where: { tenantId, status: { not: 'deleted' } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
    );
  }

  me(userId: string): Promise<unknown> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        tenantId: true,
        avatarUrl: true,
        phone: true,
        createdAt: true,
        customerProfile: {
          select: {
            documentNumber: true,
            city: true,
            state: true,
            postalCode: true,
            birthDate: true,
          },
        },
      },
    });
  }

  /** Atualiza dados do próprio perfil */
  async updateProfile(
    userId: string,
    data: {
      fullName?: string;
      phone?: string;
      avatarUrl?: string;
      documentNumber?: string;
      city?: string;
      state?: string;
      postalCode?: string;
    },
  ): Promise<unknown> {
    const userData: Record<string, unknown> = {};
    if (data.fullName !== undefined)  userData.fullName  = data.fullName.trim();
    if (data.phone !== undefined)     userData.phone     = data.phone || null;
    if (data.avatarUrl !== undefined) userData.avatarUrl = data.avatarUrl || null;

    if (Object.keys(userData).length) {
      await this.prisma.user.update({ where: { id: userId }, data: userData });
    }

    // upsert no CustomerProfile (cidade/estado/CPF/CEP)
    const hasProfileFields =
      data.documentNumber !== undefined || data.city !== undefined ||
      data.state !== undefined || data.postalCode !== undefined;

    if (hasProfileFields) {
      const profile = {
        ...(data.documentNumber !== undefined ? { documentNumber: data.documentNumber || null } : {}),
        ...(data.city !== undefined           ? { city: data.city || null } : {}),
        ...(data.state !== undefined          ? { state: data.state || null } : {}),
        ...(data.postalCode !== undefined     ? { postalCode: data.postalCode || null } : {}),
      };
      await this.prisma.customerProfile.upsert({
        where: { userId },
        update: profile,
        create: { userId, ...profile },
      });
    }

    return this.me(userId);
  }

  /** Altera a função de um membro da equipe (admin) */
  async changeRole(tenantId: string, memberId: string, role: string): Promise<unknown> {
    const allowed = ['tenant_admin', 'manager', 'salesperson'];
    if (!allowed.includes(role)) throw new BadRequestException('Função inválida.');
    const member = await this.prisma.user.findFirst({ where: { id: memberId, tenantId } });
    if (!member) throw new BadRequestException('Membro não encontrado.');
    return this.prisma.user.update({
      where: { id: memberId },
      data: { role: role as never },
      select: { id: true, role: true, fullName: true },
    });
  }

  /** Ativa/suspende (remove) um membro (admin) */
  async setStatus(
    tenantId: string,
    memberId: string,
    actorId: string,
    status: 'active' | 'suspended',
  ): Promise<unknown> {
    if (memberId === actorId) {
      throw new BadRequestException('Você não pode desativar a própria conta.');
    }
    const member = await this.prisma.user.findFirst({ where: { id: memberId, tenantId } });
    if (!member) throw new BadRequestException('Membro não encontrado.');
    return this.prisma.user.update({
      where: { id: memberId },
      data: { status: status as never },
      select: { id: true, status: true, fullName: true },
    });
  }

  /** Troca a senha do usuário */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user.passwordHash) {
      throw new BadRequestException(
        'Esta conta usa login social e não possui senha definida.',
      );
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Senha atual incorreta.');
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('A nova senha deve ter pelo menos 6 caracteres.');
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    return { ok: true };
  }
}
