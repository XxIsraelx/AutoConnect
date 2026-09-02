import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@autoconnect/db';

/**
 * Conexão que atravessa concessionárias — deliberadamente, e em um lugar só.
 *
 * Conecta pela `DIRECT_URL`, que é a do dono das tabelas e portanto ignora RLS.
 * Existe porque três classes de operação não têm tenant a que se restringir:
 *
 *  - **super admin** — o painel consulta todas as concessionárias por natureza;
 *  - **autenticação** — o login procura o usuário por e-mail *antes* de saber
 *    a qual concessionária ele pertence;
 *  - **convite por token** — `tenant_invites` é consultada antes de o tenant
 *    existir.
 *
 * A regra que isto sustenta: a travessia entre tenants passa a ser visível no
 * `import`, em vez de ser o comportamento padrão de todo `this.prisma`. Quem
 * revisa um PR consegue perguntar "por que este módulo precisa disto?".
 *
 * NÃO use para acesso comum a dado de concessionária. Para isso existe
 * `PrismaService.withTenant`.
 */
@Injectable()
export class PrivilegedPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrivilegedPrismaService.name);

  constructor() {
    super({
      datasources: {
        // DIRECT_URL é a conexão dona das tabelas. Quando a DATABASE_URL passar
        // a apontar para `autoconnect_app`, é esta que segue enxergando tudo.
        db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma privilegiado conectado (ignora RLS)');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
