import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { EmailModule } from '../../common/email/email.module';
import { FipeModule } from '../fipe/fipe.module';

@Module({
  imports: [EmailModule, FipeModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
