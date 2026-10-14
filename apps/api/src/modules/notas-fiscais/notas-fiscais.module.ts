import { Module } from '@nestjs/common';
import { NotasFiscaisController } from './notas-fiscais.controller';
import { PerfilFiscalService } from './perfil-fiscal.service';

/**
 * Trilha N do plano fiscal (`docs/planos/plano-fiscal-renave-nfe.md`).
 *
 * Lê negócio, comprador e veículo; não escreve em nenhum deles. A emissão
 * (N2) e o provedor (N3) entram aqui, sem dependência no sentido contrário.
 */
@Module({
  controllers: [NotasFiscaisController],
  providers: [PerfilFiscalService],
})
export class NotasFiscaisModule {}
