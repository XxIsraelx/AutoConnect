import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@autoconnect/db';

/**
 * Cliente Prisma compartilhado. Para queries com isolamento por tenant,
 * use `withTenant(tenantId)` que abre transação e seta `app.tenant_id`
 * antes de executar — RLS no Postgres filtra automaticamente.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Executa `fn` em uma transação com `SET LOCAL app.tenant_id`.
   * Toda query feita por `tx` respeita RLS automaticamente.
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
      return fn(tx);
    });
  }
}
