import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { EmailModule } from '../../common/email/email.module';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { ContractsModule } from '../contracts/contracts.module';
import { ConsultasModule } from '../consultas/consultas.module';
import { CobrancaModule } from '../cobranca/cobranca.module';

@Module({
  imports: [
    EmailModule,
    PrivilegedPrismaModule,
    // Só para o painel de sistema saber qual provedor está montado.
    ContractsModule,
    ConsultasModule,
    // Trocar plano e estender trial precisam derrubar o cache do guard de
    // somente leitura na hora: o super admin desbloqueia uma loja justamente
    // quando alguém está do outro lado da linha esperando voltar a trabalhar.
    CobrancaModule,
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
