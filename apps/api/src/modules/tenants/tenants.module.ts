import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { MapModule } from '../map/map.module';

@Module({
  // O `MapModule` entra por causa da geocodificação: salvar o endereço da
  // filial agenda a busca da coordenada, senão o pino só se corrigiria quando
  // alguém abrisse `/buscar`.
  imports: [PrivilegedPrismaModule, MapModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
