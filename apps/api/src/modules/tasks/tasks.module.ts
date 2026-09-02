import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { TasksService } from './tasks.service';
import { EmailModule } from '../../common/email/email.module';

@Module({
  imports: [EmailModule, PrivilegedPrismaModule],
  providers: [TasksService],
})
export class TasksModule {}
