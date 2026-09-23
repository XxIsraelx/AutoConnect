import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LimitePorIp } from './limite-por-ip';
import { EmailModule } from '../../common/email/email.module';

@Module({
  imports: [PrivilegedPrismaModule, EmailModule],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    // `useValue`: o construtor recebe números (teto e janela), que o contêiner
    // não sabe injetar. Uma instância por processo é exatamente o que se quer.
    { provide: LimitePorIp, useValue: new LimitePorIp() },
  ],
})
export class LeadsModule {}
