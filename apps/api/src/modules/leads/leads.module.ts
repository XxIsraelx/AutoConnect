import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LimitePorIp } from './limite-por-ip';
import { EmailModule } from '../../common/email/email.module';
import { CrmModule } from '../crm/crm.module';
import { PushModule } from '../users/push/push.module';

@Module({
  imports: [PrivilegedPrismaModule, EmailModule, CrmModule, PushModule],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    // `useValue`: o construtor recebe números (teto e janela), que o contêiner
    // não sabe injetar. Uma instância por processo é exatamente o que se quer.
    { provide: LimitePorIp, useValue: new LimitePorIp() },
  ],
  // O WhatsApp oficial (e, depois, os portais) criam lead pelo mesmo caminho
  // do formulário público: deduplicação, rodízio e prazo num lugar só.
  exports: [LeadsService],
})
export class LeadsModule {}
