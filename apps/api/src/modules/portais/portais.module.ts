import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { LimitePorIp } from '../../common/limite-por-ip';
import { LeadsModule } from '../leads/leads.module';
import { PROVEDOR_DE_EMAIL_DE_ENTRADA, emailDeEntradaConfigurado } from './email-de-entrada';
import { PortaisController, WebhookPortaisController } from './portais.controller';
import {
  JANELA_POR_CONEXAO_MS, LIMITE_DE_PORTAL, LIMITE_POR_CONEXAO, PortaisService,
} from './portais.service';

/** Leads dos portais (item C2): endereço de entrada por loja, webhook e e-mail. */
@Module({
  imports: [ConfigModule, PrivilegedPrismaModule, LeadsModule],
  controllers: [PortaisController, WebhookPortaisController],
  providers: [
    PortaisService,
    {
      provide: PROVEDOR_DE_EMAIL_DE_ENTRADA,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => emailDeEntradaConfigurado(config),
    },
    // `useValue`: os números do construtor não são injetáveis. Uma janela por
    // processo — com duas réplicas, o teto dobra (a mesma ressalva do lead público).
    { provide: LIMITE_DE_PORTAL, useValue: new LimitePorIp(LIMITE_POR_CONEXAO, JANELA_POR_CONEXAO_MS) },
  ],
})
export class PortaisModule {}
