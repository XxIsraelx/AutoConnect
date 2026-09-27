import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { ChatEventosModule } from '../../gateway/chat-eventos.service';
import { LeadsModule } from '../leads/leads.module';
import { CrmModule } from '../crm/crm.module';
import { PROVEDOR_DE_WHATSAPP, provedorDeWhatsAppConfigurado } from './provedor';
import { WhatsappService } from './whatsapp.service';
import { WebhookWhatsappController, WhatsappController } from './whatsapp.controller';

/**
 * WhatsApp oficial. O provedor sai da configuração (`WHATSAPP_FORNECEDOR`) e
 * é um só por processo — o simulado guarda o que "enviou" em memória, e os
 * testes o leem pelo mesmo token de injeção.
 */
@Module({
  imports: [ConfigModule, PrivilegedPrismaModule, ChatEventosModule, LeadsModule, CrmModule],
  controllers: [WhatsappController, WebhookWhatsappController],
  providers: [
    WhatsappService,
    {
      provide: PROVEDOR_DE_WHATSAPP,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => provedorDeWhatsAppConfigurado(config),
    },
  ],
  // O gateway do chat envia a mensagem livre por aqui.
  exports: [WhatsappService],
})
export class WhatsappModule {}
