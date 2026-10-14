import { Module } from '@nestjs/common';
import { RenaveController } from './renave.controller';
import { RenaveService } from './renave.service';

/**
 * RENAVE — trilha R do plano fiscal. Por enquanto só o registro manual (R1);
 * a camada neutra `ProvedorDeRenave` e o simulado entram em R2.
 */
@Module({
  controllers: [RenaveController],
  providers: [RenaveService],
})
export class RenaveModule {}
