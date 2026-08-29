import { Module } from '@nestjs/common';
import { FipeController } from './fipe.controller';
import { FipeService } from './fipe.service';

@Module({
  controllers: [FipeController],
  providers: [FipeService],
  exports: [FipeService],
})
export class FipeModule {}
