import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '@autoconnect/db';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  findById(
    tenantId: string,
  ): Promise<
    Prisma.TenantGetPayload<{
      include: {
        subscription: true;
        branches: true;
      };
    }>
  > {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        include: { subscription: true, branches: true },
      }),
    );
  }
}