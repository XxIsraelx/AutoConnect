import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractPdfService } from './contract-pdf.service';
import { AssinaturaExternaService } from './assinatura/assinatura-externa.service';
import {
  AssinaturaExternaController, WebhookAssinaturaController,
} from './assinatura/assinatura-externa.controller';
import { PROVEDOR_DE_ASSINATURA, provedorConfigurado } from './assinatura/provedor';
import { DealEstadoModule } from '../deals/deal-estado.module';

@Module({
  // Privilegiado: super admin lê contratos de qualquer loja, e o webhook de
  // assinatura descobre de qual loja é o envelope antes de ter contexto.
  // DealEstadoModule: emitir o contrato move o negócio para "contrato
  // emitido", pela mesma máquina de estados que o resto do sistema usa.
  imports: [PrivilegedPrismaModule, DealEstadoModule],
  controllers: [ContractsController, AssinaturaExternaController, WebhookAssinaturaController],
  providers: [
    ContractsService,
    ContractPdfService,
    AssinaturaExternaService,
    {
      // Camada de anticorrupção: plugar a Clicksign é trocar esta fábrica e
      // escrever o adaptador. Nenhum service conhece o formato do provedor.
      provide: PROVEDOR_DE_ASSINATURA,
      inject: [ConfigService],
      useFactory: provedorConfigurado,
    },
  ],
  exports: [ContractsService, AssinaturaExternaService, PROVEDOR_DE_ASSINATURA],
})
export class ContractsModule {}
