import {
  Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { SIGNER_ROLES } from '@autoconnect/shared';
import { escopoDa } from '../../../common/escopo';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AssinaturaExternaService } from './assinatura-externa.service';

interface AuthRequest extends Request {
  user: { id: string; role: string; tenantId: string | null };
}

/** Os mesmos papéis que emitem e assinam contrato hoje. */
const OPERA = ['salesperson', 'manager', 'tenant_admin', 'super_admin'];

const enviarSchema = z.object({
  /** Prazo para as partes assinarem. A Clicksign aceita até 90 dias. */
  prazoDias: z.number().int().min(1).max(90).default(30),
});

const cancelarSchema = z.object({ motivo: z.string().min(3).max(300).optional() });

export const simularSchema = z.object({
  acao: z.enum(['assinar', 'recusar', 'expirar']),
  papel: z.enum(SIGNER_ROLES).optional(),
});

@Controller()
@UseGuards(RolesGuard)
@Roles(...OPERA)
export class AssinaturaExternaController {
  constructor(private readonly assinatura: AssinaturaExternaService) {}

  /** Se há provedor configurado — a tela esconde a opção quando não há. */
  @Get('contracts/assinatura-externa/capacidade')
  capacidade(): unknown {
    return this.assinatura.capacidade();
  }

  @Get('contracts/:id/assinatura-externa')
  status(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.assinatura.status(escopoDa(req.user), id);
  }

  @Post('contracts/:id/assinatura-externa')
  enviar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { prazoDias } = enviarSchema.parse(body ?? {});
    return this.assinatura.enviar(escopoDa(req.user), id, req.user.id, prazoDias);
  }

  @Post('contracts/:id/assinatura-externa/cancelar')
  cancelar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { motivo } = cancelarSchema.parse(body ?? {});
    return this.assinatura.cancelar(escopoDa(req.user), id, req.user.id, motivo);
  }

  /** PDF devolvido pelo provedor, conferido contra o hash da conclusão. */
  @Get('contracts/:id/assinatura-externa/pdf')
  @Header('Content-Type', 'application/pdf')
  async pdf(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { pdf } = await this.assinatura.pdfAssinado(escopoDa(req.user), id);
    res.setHeader('Content-Disposition', `inline; filename="contrato-${id.slice(0, 8)}-assinado.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(pdf);
  }

  /**
   * Só com o provedor simulado, fora de produção (404 no resto). Gera o
   * webhook que o provedor mandaria e o entrega pelo caminho real.
   */
  @Post('contracts/:id/assinatura-externa/simular')
  simular(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { acao, papel } = simularSchema.parse(body);
    return this.assinatura.simular(escopoDa(req.user), id, acao, papel);
  }
}

/**
 * Entrada do provedor. Pública porque quem chama é o provedor, não um
 * usuário: a autenticação é o HMAC do corpo, conferido pelo adaptador.
 *
 * O corpo chega **cru** (`Buffer`) — ver `corpoCru` no `app.setup.ts`. Não
 * passa por Zod aqui porque não é o domínio que o lê: o adaptador traduz o
 * payload do provedor, e o que sai dele já é o evento normalizado.
 */
@Controller('webhooks')
export class WebhookAssinaturaController {
  constructor(private readonly assinatura: AssinaturaExternaService) {}

  @Public()
  @Post('assinatura')
  @HttpCode(200)
  receber(@Req() req: Request): Promise<unknown> {
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return this.assinatura.receberWebhook(req.headers, corpo);
  }
}
