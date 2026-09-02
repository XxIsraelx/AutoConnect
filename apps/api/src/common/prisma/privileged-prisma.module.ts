import { Module } from '@nestjs/common';
import { PrivilegedPrismaService } from './privileged-prisma.service';

/**
 * Deliberadamente **não** é `@Global`, ao contrário do `PrismaModule`.
 *
 * Quem precisa atravessar concessionárias tem que declarar este import, e isso
 * aparece no diff do PR. Se fosse global, a travessia voltaria a ser invisível
 * — que é exatamente o problema que este desenho resolve.
 */
@Module({
  providers: [PrivilegedPrismaService],
  exports: [PrivilegedPrismaService],
})
export class PrivilegedPrismaModule {}
