import {
  CanActivate, ExecutionContext, HttpException, Injectable, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { EstadoDaLojaService } from '../../modules/cobranca/estado-da-loja.service';
import type { AuthenticatedRequest } from '../middleware/tenant.middleware';

export const LIBERADO_NO_BLOQUEIO_KEY = 'liberadoNoBloqueio';

/**
 * Código que a tela reconhece para levar o usuário à página de plano em vez de
 * só mostrar a mensagem. Vai no corpo do 402, junto da frase.
 */
export const CODIGO_SOMENTE_LEITURA = 'assinatura_somente_leitura';

/** Status HTTP do bloqueio: 402 Payment Required, que é literalmente o caso. */
export const STATUS_SOMENTE_LEITURA = 402;

/**
 * Esta rota continua funcionando com a loja bloqueada.
 *
 * A lista é curta de propósito, e cada item tem um porquê:
 *
 * - **Cobrança** (`/cobranca/*`): pagar é como se sai do bloqueio. Uma tela de
 *   pagamento bloqueada pelo não pagamento é uma armadilha fechada.
 * - **Autenticação** (`/auth/*`): entrar, sair, trocar senha e confirmar
 *   e-mail não são escrita de dado da loja.
 * - **Despublicar anúncio**: tirar do ar nunca pode ficar travado — é a mesma
 *   regra que já valia para o e-mail não verificado. Uma loja que fechou tem
 *   de conseguir sumir da vitrine mesmo devendo.
 * - **Presença e leitura de notificação**: são efeito de a tela estar aberta,
 *   não decisão do usuário. Um 402 aqui pintaria a interface inteira de
 *   vermelho a cada 30 segundos.
 */
export const LiberadoNoBloqueio = () => SetMetadata(LIBERADO_NO_BLOQUEIO_KEY, true);

/**
 * Modo somente leitura por trial vencido ou fatura em aberto.
 *
 * ## O desenho, e por que ele é uma trava e não uma checagem
 *
 * Bloquear rota a rota é a forma garantida de esquecer uma: foram seis vezes
 * nesta base que endpoint e tela não se encontraram. Aqui é o contrário — o
 * guard é **global** e a regra é "toda escrita passa por mim". Rota nova nasce
 * bloqueada sem ninguém lembrar dela; o que precisa de exceção pede
 * `@LiberadoNoBloqueio()`, e isso aparece no diff.
 *
 * ## O que ele **não** faz
 *
 * Não apaga, não esconde e não desativa nada. `GET` passa sempre: a loja
 * continua vendo o estoque, os leads, os negócios, os contratos e os
 * relatórios, e continua exportando tudo. A vitrine pública também continua no
 * ar (rotas `@Public()` não passam por aqui) — ver a decisão em
 * `docs/decisoes/2026-09-25 cobranca e bloqueio por vencimento.md`.
 *
 * Super admin passa sempre, senão estender o trial de uma loja bloqueada seria
 * impossível justamente quando é preciso.
 */
@Injectable()
export class SomenteLeituraGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly estado: EstadoDaLojaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Só HTTP: o gateway de WebSocket tem o próprio caminho e não passa aqui.
    if (ctx.getType() !== 'http') return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const metodo = req.method?.toUpperCase();
    if (metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS') return true;

    const publico = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (publico) return true;

    const liberado = this.reflector.getAllAndOverride<boolean>(LIBERADO_NO_BLOQUEIO_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (liberado) return true;

    const usuario = req.user;
    if (!usuario) return true; // sem usuário, quem recusa é o JwtAuthGuard
    if (usuario.role === 'super_admin') return true;
    if (!usuario.tenantId) return true; // consumidor final não tem assinatura

    const estado = await this.estado.estado(usuario.tenantId);
    if (!estado.veredito.somenteLeitura) return true;

    throw new HttpException(
      {
        statusCode: STATUS_SOMENTE_LEITURA,
        codigo: CODIGO_SOMENTE_LEITURA,
        situacao: estado.veredito.situacao,
        message:
          `${estado.veredito.aviso ?? 'Sua assinatura está vencida.'} ` +
          'Escolha um plano em Configurações › Plano e cobrança para voltar a editar.',
      },
      STATUS_SOMENTE_LEITURA,
    );
  }
}

/** Reexportado para quem precisa montar a mesma recusa fora do guard. */
export function recusaPorAssinatura(mensagem: string): HttpException {
  return new HttpException(
    { statusCode: STATUS_SOMENTE_LEITURA, codigo: CODIGO_SOMENTE_LEITURA, message: mensagem },
    STATUS_SOMENTE_LEITURA,
  );
}
