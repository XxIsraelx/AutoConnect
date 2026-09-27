import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param,
  ParseUUIDPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ehPortal, simularLeadDePortalSchema, type ChaveDoPortal } from '@autoconnect/shared';
import { escopoDa, ehGlobal } from '../../common/escopo';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PortaisService } from './portais.service';

interface AuthRequest extends Request {
  user: { id: string; role: string; tenantId: string | null };
}

function portalDa(param: string): ChaveDoPortal {
  if (!ehPortal(param)) throw new NotFoundException('Portal desconhecido.');
  return param;
}

@Controller('portais')
@UseGuards(RolesGuard)
@Roles('salesperson', 'manager', 'tenant_admin', 'super_admin')
export class PortaisController {
  constructor(private readonly portais: PortaisService) {}

  private loja(req: AuthRequest): string {
    const escopo = escopoDa(req.user);
    if (ehGlobal(escopo)) throw new BadRequestException('Selecione uma concessionária.');
    return escopo.tenantId;
  }

  /** Estado de cada portal: conectado, o que chegou no mês e as entregas recentes. */
  @Get()
  listar(@Req() req: AuthRequest): Promise<unknown> {
    return this.portais.listar(this.loja(req));
  }

  /** O endereço de entrada sai uma vez, aqui. Conectar é do dono. */
  @Post(':portal/conectar')
  @Roles('tenant_admin', 'super_admin')
  conectar(@Req() req: AuthRequest, @Param('portal') portal: string): Promise<unknown> {
    return this.portais.conectar(this.loja(req), req.user.id, portalDa(portal));
  }

  /** Endereço novo; o anterior para de valer. */
  @Post(':portal/regenerar')
  @Roles('tenant_admin', 'super_admin')
  regenerar(@Req() req: AuthRequest, @Param('portal') portal: string): Promise<unknown> {
    return this.portais.regenerar(this.loja(req), portalDa(portal));
  }

  @Delete(':portal')
  @Roles('tenant_admin', 'super_admin')
  desconectar(@Req() req: AuthRequest, @Param('portal') portal: string): Promise<unknown> {
    return this.portais.desconectar(this.loja(req), portalDa(portal));
  }

  /** Relê uma entrega "não entendida" com o leitor de hoje. */
  @Post('entregas/:id/reprocessar')
  @Roles('manager', 'tenant_admin', 'super_admin')
  reprocessar(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.portais.reprocessar(this.loja(req), id);
  }

  /** Só fora de produção (404 em produção). */
  @Post(':portal/simular')
  simular(@Req() req: AuthRequest, @Param('portal') portal: string, @Body() body: unknown): Promise<unknown> {
    return this.portais.simular(this.loja(req), portalDa(portal), simularLeadDePortalSchema.parse(body));
  }
}

/**
 * Entradas públicas. Quem chama é o portal (ou a integração) e o provedor de
 * e-mail, não um usuário: a autenticação é o token do endereço, na URL ou no
 * destinatário, e — no e-mail — também o Basic auth do provedor.
 *
 * Corpo **cru** nas duas (ver `corpoCru` no `app.setup.ts`): é ele que fica
 * guardado para reprocessar, e o SHA-256 dele é a chave de idempotência do
 * webhook.
 */
@Controller('webhooks')
export class WebhookPortaisController {
  constructor(private readonly portais: PortaisService) {}

  @Public()
  @Post('portais/:token')
  @HttpCode(200)
  webhook(@Param('token') token: string, @Req() req: Request): Promise<unknown> {
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return this.portais.receberWebhook(token, corpo);
  }

  @Public()
  @Post('email-de-entrada')
  @HttpCode(200)
  email(@Req() req: Request): Promise<unknown> {
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return this.portais.receberEmail(req.headers, corpo);
  }
}
