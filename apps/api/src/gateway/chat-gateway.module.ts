import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { DealsModule } from '../modules/deals/deals.module';
import { PrismaModule } from '../common/prisma/prisma.module';

@Module({
  imports: [
    DealsModule,
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
      }),
    }),
  ],
  providers: [ChatGateway],
})
export class ChatGatewayModule {}
