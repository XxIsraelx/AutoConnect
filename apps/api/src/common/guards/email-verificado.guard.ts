import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedRequest } from '../middleware/tenant.middleware';

export const EMAIL_VERIFICADO_KEY = 'exigeEmailVerificado';

/**
 * Código que a tela reconhece para oferecer "reenviar e-mail" em vez de só
 * mostrar a mensagem. Vai no corpo do 403, junto da frase.
 */
export const CODIGO_EMAIL_NAO_VERIFICADO = 'email_nao_verificado';

/**
 * Exige e-mail confirmado para executar esta rota.
 *
 * ## Onde isto vale, e por quê
 *
 * Desde que o cadastro passou a ser em autosserviço (25/09/2026), a loja nasce
 * com o e-mail **por confirmar** e entra no painel na hora: explorar o produto
 * não exige nada, porque exigir confirmação antes da primeira tela é a mesma
 * porta na cara que a decisão veio derrubar — e num ambiente sem provedor de
 * e-mail configurado o link simplesmente não chega.
 *
 * O que exige confirmação é o que **sai da loja em nome dela**:
 *
 * - `POST /invitations` — convidar equipe manda e-mail a terceiros com a nossa
 *   marca. Sem endereço provado, é um relay de spam com um clique.
 * - `POST /vehicles/:id/publish` — publicar anúncio põe a loja na vitrine
 *   pública, no mapa e no catálogo, com telefone e endereço visíveis a quem
 *   não é cliente nosso.
 *
 * Tudo o mais — cadastrar veículo em rascunho, receber e atender lead, abrir
 * negócio, configurar a loja — continua liberado.
 */
export const ExigeEmailVerificado = () => SetMetadata(EMAIL_VERIFICADO_KEY, true);

@Injectable()
export class EmailVerificadoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const exige = this.reflector.getAllAndOverride<boolean>(EMAIL_VERIFICADO_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!exige) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) throw new ForbiddenException('Não autenticado');

    // Lê o banco em vez do JWT: o token vive 15 minutos e guardaria um "não
    // verificado" que já não é verdade — o dono clicaria no link do e-mail e
    // continuaria barrado até o token expirar.
    const usuario = await this.prisma.withUser(req.user.id, (tx) =>
      tx.user.findUnique({
        where: { id: req.user!.id },
        select: { emailVerifiedAt: true },
      }),
    );

    if (usuario?.emailVerifiedAt) return true;

    throw new ForbiddenException({
      statusCode: 403,
      codigo: CODIGO_EMAIL_NAO_VERIFICADO,
      message:
        'Confirme seu e-mail para liberar esta ação. Reenviamos o link a qualquer momento ' +
        'pelo aviso no topo do painel.',
    });
  }
}
