import { Module } from '@nestjs/common';
import { PrivilegedPrismaModule } from '../../common/prisma/privileged-prisma.module';
import { InvitationsController, PublicInvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../../common/email/email.module';

/**
 * ⚠ Os **dois** controllers precisam estar aqui.
 *
 * O `PublicInvitationsController` ficou de fora desta lista e
 * `POST /public/invitations/accept` respondeu 404 enquanto a tela
 * `/invite/[token]` a chamava: o convite era criado, o e-mail saía, o link
 * abria — e nenhum vendedor entrava na loja. Um CRM em que só o dono entra não
 * é um CRM. Controller declarado e não registrado não é erro de compilação:
 * quem o pega é o e2e do aceite (`convite-equipe.e2e-spec.ts`), que bate na
 * rota HTTP e não no serviço.
 */
@Module({
  imports: [PrivilegedPrismaModule, AuthModule, EmailModule],
  controllers: [InvitationsController, PublicInvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
