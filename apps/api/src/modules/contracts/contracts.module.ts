import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractPdfService } from './contract-pdf.service';

@Module({
  imports: [PrivilegedPrismaModule],
  controllers: [ContractsController],
  providers: [ContractsService, ContractPdfService],
  exports: [ContractsService],
})
export class ContractsModule {}
