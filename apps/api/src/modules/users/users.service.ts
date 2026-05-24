import { Injectable } from '@nestjs/common';
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

  me(userId: string): Promise<{
    id: string;
    email: string;
    fullName: string | null;
    role: string;
    tenantId: string | null;
    avatarUrl: string | null;
  }> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        tenantId: true,
        avatarUrl: true,
      },
    });
  }
}