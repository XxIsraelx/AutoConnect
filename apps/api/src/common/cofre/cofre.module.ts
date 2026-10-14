import { Module } from '@nestjs/common';
import { CofreService } from './cofre.service';

/**
 * Cofre de credenciais por loja. Não é `@Global`: quem guarda segredo de loja
 * declara que guarda, importando o módulo — e isso aparece no diff.
 */
@Module({
  providers: [CofreService],
  exports: [CofreService],
})
export class CofreModule {}
