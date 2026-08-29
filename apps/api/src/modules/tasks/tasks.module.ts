import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { EmailModule } from '../../common/email/email.module';

@Module({
  imports: [EmailModule],
  providers: [TasksService],
})
export class TasksModule {}
