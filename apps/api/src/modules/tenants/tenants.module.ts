import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [PrivilegedPrismaModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
