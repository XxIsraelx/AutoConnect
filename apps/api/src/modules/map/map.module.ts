import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { MapController } from './map.controller';
import { MapService } from './map.service';
import { GeocodificacaoService } from './geocodificacao.service';

@Module({
  imports: [PrivilegedPrismaModule],
  controllers: [MapController],
  providers: [MapService, GeocodificacaoService],
  // O salvamento da filial em `/configuracoes` agenda uma geocodificação: sem
  // isso, a coordenada do endereço só apareceria quando alguém abrisse o mapa.
  exports: [GeocodificacaoService],
})
export class MapModule {}
