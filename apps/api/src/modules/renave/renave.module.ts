import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { RenaveController, WebhookRenaveController } from './renave.controller';
import { RenaveService } from './renave.service';
import { RenaveIntegracaoService } from './renave-integracao.service';
import { PROVEDOR_DE_RENAVE, provedorDeRenaveConfigurado } from './provedor';

/**
 * RENAVE — trilha R do plano fiscal: registro manual (R1) e a camada neutra
 * com a integradora simulada (R2). O adaptador de uma integradora real (R3) é
 * trocar a fábrica e escrever o adaptador; nenhum service conhece o formato
 * dela.
 *
 * Privilegiado: o webhook descobre de qual loja é a operação antes de ter
 * contexto — uma leitura, por chave única.
 */
@Module({
  imports: [PrivilegedPrismaModule],
  controllers: [RenaveController, WebhookRenaveController],
  providers: [
    RenaveService,
    RenaveIntegracaoService,
    {
      provide: PROVEDOR_DE_RENAVE,
      inject: [ConfigService],
      useFactory: provedorDeRenaveConfigurado,
    },
  ],
})
export class RenaveModule {}
