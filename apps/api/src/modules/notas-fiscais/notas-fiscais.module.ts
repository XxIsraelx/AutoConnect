import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { NotasFiscaisController, WebhookNotaFiscalController } from './notas-fiscais.controller';
import { PerfilFiscalService } from './perfil-fiscal.service';
import { EmissaoDeNotaService } from './emissao.service';
import { RelatorioFiscalService } from './relatorio-fiscal.service';
import { ConferenciaFiscalService } from './conferencia-fiscal.service';
import { PROVEDOR_DE_NOTA_FISCAL, emissorConfigurado } from './emissor/provedor';

/**
 * Trilha N do plano fiscal (`docs/planos/plano-fiscal-renave-nfe.md`).
 *
 * Lê negócio, comprador e veículo; não escreve em nenhum deles. O emissor
 * entra por `PROVEDOR_DE_NOTA_FISCAL` — simulado até a N3.
 *
 * `PrivilegedPrismaModule` existe aqui por um motivo só: achar a loja dona da
 * nota no webhook, que chega sem usuário e sem loja.
 */
@Module({
  imports: [PrivilegedPrismaModule],
  controllers: [NotasFiscaisController, WebhookNotaFiscalController],
  providers: [
    PerfilFiscalService,
    EmissaoDeNotaService,
    RelatorioFiscalService,
    ConferenciaFiscalService,
    { provide: PROVEDOR_DE_NOTA_FISCAL, inject: [ConfigService], useFactory: emissorConfigurado },
  ],
})
export class NotasFiscaisModule {}
