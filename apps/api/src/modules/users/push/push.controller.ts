import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { inscricaoDePushSchema, removerInscricaoDePushSchema } from '@autoconnect/shared';
import { escopoDa, ehGlobal } from '../../../common/escopo';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { LiberadoNoBloqueio } from '../../../common/guards/somente-leitura.guard';
import { PushService } from './push.service';

interface AuthRequest extends Request {
  user: { id: string; role: string; tenantId: string | null };
}

/**
 * Notificação no aparelho de quem atende. `@LiberadoNoBloqueio` nas escritas:
 * é preferência do usuário sobre o próprio aparelho, como o `/users/me` — não
 * muda dado nenhum da loja, e desinscrever ao sair da conta precisa funcionar
 * sempre.
 */
@Controller('push')
@UseGuards(RolesGuard)
@Roles('salesperson', 'manager', 'tenant_admin', 'super_admin')
export class PushController {
  constructor(private readonly push: PushService) {}

  private loja(req: AuthRequest): string {
    const escopo = escopoDa(req.user);
    if (ehGlobal(escopo)) throw new BadRequestException('Notificações são por loja: selecione uma concessionária.');
    return escopo.tenantId;
  }

  @Get('capacidade')
  capacidade(@Req() req: AuthRequest): Promise<unknown> {
    return this.push.capacidade(this.loja(req), req.user.id);
  }

  @Post('inscricoes')
  @LiberadoNoBloqueio()
  inscrever(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    const agente = req.headers['user-agent'];
    return this.push.inscrever(
      this.loja(req), req.user.id, inscricaoDePushSchema.parse(body), typeof agente === 'string' ? agente : null,
    );
  }

  @Post('inscricoes/remover')
  @LiberadoNoBloqueio()
  desinscrever(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    const { endpoint } = removerInscricaoDePushSchema.parse(body);
    return this.push.desinscrever(this.loja(req), req.user.id, endpoint);
  }

  @Post('teste')
  @LiberadoNoBloqueio()
  teste(@Req() req: AuthRequest): Promise<unknown> {
    return this.push.teste(this.loja(req), req.user.id);
  }
}
