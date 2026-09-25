import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { EmailModule } from '../../common/email/email.module';
import { FipeModule } from '../fipe/fipe.module';
import { CrmModule } from '../crm/crm.module';

@Module({
  // `CrmModule`: o formulário público de troca cria lead, e todo lead nasce com
  // responsável (rodízio) e prazo de primeira resposta (SLA).
  imports: [EmailModule, FipeModule, CrmModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
