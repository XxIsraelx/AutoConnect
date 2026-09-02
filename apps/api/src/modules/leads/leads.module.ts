import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { EmailModule } from '../../common/email/email.module';

@Module({
  imports: [PrivilegedPrismaModule, EmailModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
