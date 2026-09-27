import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import {
  ConversationsController,
  PublicConversationsController,
} from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { LimiteDeVisitante } from './limite-de-visitante';
import { ChatEventosModule } from '../../gateway/chat-eventos.service';
import { EmailModule } from '../../common/email/email.module';

@Module({
  imports: [PrivilegedPrismaModule, PrismaModule, ChatEventosModule, EmailModule],
  controllers: [ConversationsController, PublicConversationsController],
  providers: [ConversationsService, LimiteDeVisitante],
  exports: [ConversationsService],
})
export class ConversationsModule {}
