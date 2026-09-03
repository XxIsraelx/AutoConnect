import { Global, Module } from '@nestjs/common';
import { DocumentosStorage } from './documentos.storage';

/**
 * Global porque o armazenamento privado vai ser usado por contrato, documento
 * de identidade e, na Fase 4, comprovante de renda — todos com a mesma regra.
 */
@Global()
@Module({
  providers: [DocumentosStorage],
  exports: [DocumentosStorage],
})
export class ArmazenamentoModule {}
