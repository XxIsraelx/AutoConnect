import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { EmailModule } from '../../common/email/email.module';
import { SomenteLeituraGuard } from '../../common/guards/somente-leitura.guard';
import { CobrancaController, WebhookCobrancaController } from './cobranca.controller';
import { CobrancaService } from './cobranca.service';
import { EstadoDaLojaService } from './estado-da-loja.service';
import { PROVEDOR_DE_COBRANCA, cobrancaConfigurada } from './provedor';
import { VencimentosCron } from './vencimentos.cron';

/**
 * Cobrança da assinatura da loja.
 *
 * Privilegiado: o webhook descobre de qual loja é a assinatura antes de ter
 * contexto de tenant, e o guard de somente leitura lê a assinatura da loja do
 * próprio usuário antes de qualquer consulta com contexto.
 *
 * O `SomenteLeituraGuard` é registrado aqui, e não no `AppModule`, porque é
 * aqui que o `EstadoDaLojaService` de que ele depende existe — mas ele vale
 * **globalmente**, para toda rota da API: é o que faz uma rota nova nascer
 * bloqueada sem ninguém precisar lembrar dela.
 */
@Module({
  imports: [PrivilegedPrismaModule, EmailModule],
  controllers: [CobrancaController, WebhookCobrancaController],
  providers: [
    CobrancaService,
    EstadoDaLojaService,
    VencimentosCron,
    {
      // Camada de anticorrupção: plugar outro gateway é trocar esta fábrica e
      // escrever o adaptador. Nenhum service conhece o formato da Asaas.
      provide: PROVEDOR_DE_COBRANCA,
      inject: [ConfigService],
      useFactory: cobrancaConfigurada,
    },
    { provide: APP_GUARD, useClass: SomenteLeituraGuard },
  ],
  exports: [CobrancaService, EstadoDaLojaService, VencimentosCron, PROVEDOR_DE_COBRANCA],
})
export class CobrancaModule {}
