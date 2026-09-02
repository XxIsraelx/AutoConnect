import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { MapController } from './map.controller';
import { MapService } from './map.service';

@Module({
  imports: [PrivilegedPrismaModule],
  controllers: [MapController],
  providers: [MapService],
})
export class MapModule {}
