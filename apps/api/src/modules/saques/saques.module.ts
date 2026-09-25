import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { SaquesAdminController, WebhookSaqueController } from './saques.controller';
import { SaquesService } from './saques.service';

/**
 * Validação de saque na conta da plataforma no gateway.
 *
 * Módulo separado da cobrança de propósito, embora o gateway seja o mesmo: a
 * cobrança é dinheiro **entrando** das lojas, com `tenant_id` em toda linha;
 * isto é dinheiro **saindo** da conta do dono, sem loja nenhuma envolvida.
 * Misturar os dois faria uma tabela da plataforma herdar, por vizinhança, o
 * desenho multi-tenant que ela justamente não tem.
 *
 * Privilegiado: as duas tabelas negam tudo ao papel da aplicação no RLS.
 */
@Module({
  imports: [PrivilegedPrismaModule],
  controllers: [SaquesAdminController, WebhookSaqueController],
  providers: [SaquesService],
  exports: [SaquesService],
})
export class SaquesModule {}
