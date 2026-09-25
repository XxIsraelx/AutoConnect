import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { DealsController, VehicleCostController } from './deals.controller';
import { DealsService } from './deals.service';
import { PropostaChatService } from './proposta-chat.service';
import { ContractsModule } from '../contracts/contracts.module';
import { DealEstadoModule } from './deal-estado.module';

@Module({
  // Declarado nos imports para que atravessar concessionárias apareça no diff.
  // ContractsModule: cancelar o negócio cancela o envio do contrato para
  // assinatura externa.
  // DealEstadoModule: a máquina de estados e a margem vivem num módulo folha
  // porque a emissão do contrato também precisa delas — ver o comentário lá.
  imports: [PrivilegedPrismaModule, ContractsModule, DealEstadoModule],
  controllers: [DealsController, VehicleCostController],
  providers: [DealsService, PropostaChatService],
  // O gateway do chat usa o PropostaChatService para transformar a proposta
  // em negócio.
  exports: [DealsService, PropostaChatService],
})
export class DealsModule {}
