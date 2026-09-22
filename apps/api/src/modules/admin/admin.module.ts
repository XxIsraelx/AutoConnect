import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { EmailModule } from '../../common/email/email.module';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { ContractsModule } from '../contracts/contracts.module';
import { ConsultasModule } from '../consultas/consultas.module';

@Module({
  imports: [
    EmailModule,
    PrivilegedPrismaModule,
    // Só para o painel de sistema saber qual provedor está montado.
    ContractsModule,
    ConsultasModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
        signOptions: { expiresIn: cfg.get<string>('JWT_EXPIRES_IN') ?? '15m' },
      }),
    }),
  ],
  controllers: [AdminController],
  providers:   [AdminService],
  exports:     [AdminService],
})
export class AdminModule {}
