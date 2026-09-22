import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { DealsController, VehicleCostController } from './deals.controller';
import { DealsService } from './deals.service';
import { DealStateService } from './deal-state.service';
import { MarginService } from './margin.service';
import { PropostaChatService } from './proposta-chat.service';
import { ContractsModule } from '../contracts/contracts.module';

@Module({
  // Declarado nos imports para que atravessar concessionárias apareça no diff.
  // ContractsModule: cancelar o negócio cancela o envio do contrato para
  // assinatura externa.
  imports: [PrivilegedPrismaModule, ContractsModule],
  controllers: [DealsController, VehicleCostController],
  providers: [DealsService, DealStateService, MarginService, PropostaChatService],
  // O gateway do chat usa o PropostaChatService para transformar a proposta
  // em negócio.
  exports: [DealsService, PropostaChatService],
})
export class DealsModule {}
