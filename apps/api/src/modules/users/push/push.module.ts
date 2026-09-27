import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrivilegedPrismaModule } from '../../../common/prisma/privileged-prisma.module';
import { PROVEDOR_DE_PUSH, provedorDePushConfigurado } from './provedor';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/**
 * Push do vendedor (item C3). Exportado: quem cria lead (leads) e quem recebe
 * mensagem do cliente (WhatsApp, chat, visitante) avisa por aqui.
 */
@Module({
  imports: [ConfigModule, PrivilegedPrismaModule],
  controllers: [PushController],
  providers: [
    PushService,
    {
      provide: PROVEDOR_DE_PUSH,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => provedorDePushConfigurado(config),
    },
  ],
  exports: [PushService],
})
export class PushModule {}
