import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { DealsController, VehicleCostController } from './deals.controller';
import { DealsService } from './deals.service';
import { DealStateService } from './deal-state.service';
import { MarginService } from './margin.service';
import { PropostaChatService } from './proposta-chat.service';

@Module({
  // Declarado nos imports para que atravessar concessionárias apareça no diff.
  imports: [PrivilegedPrismaModule],
  controllers: [DealsController, VehicleCostController],
  providers: [DealsService, DealStateService, MarginService, PropostaChatService],
  // O gateway do chat usa o PropostaChatService para transformar a proposta
  // em negócio.
  exports: [DealsService, PropostaChatService],
})
export class DealsModule {}
