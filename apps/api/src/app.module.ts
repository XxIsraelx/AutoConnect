import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { HealthModule } from './modules/health/health.module';
import { ChatGatewayModule } from './gateway/chat-gateway.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { MapModule } from './modules/map/map.module';
import { LeadsModule } from './modules/leads/leads.module';
import { DealsModule } from './modules/deals/deals.module';
import { AdminModule } from './modules/admin/admin.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { UsersModule } from './modules/users/users.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { TeamModule } from './modules/team/team.module';
import { FipeModule } from './modules/fipe/fipe.module';
import { TasksModule } from './modules/tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // CWD é apps/api/ no monorepo — procura .env local primeiro, depois na raiz
      envFilePath: ['.env', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    TenantsModule,
    HealthModule,
    ChatGatewayModule,
    CatalogModule,
    VehiclesModule,
    MapModule,
    LeadsModule,
    DealsModule,
    AdminModule,
    AppointmentsModule,
    UsersModule,
    TeamModule,
    InvitationsModule,
    ConversationsModule,
    FipeModule,
    TasksModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
