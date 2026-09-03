import {
  Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ContractsService } from './contracts.service';
import { escopoDa } from '../../common/escopo';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

interface AuthRequest extends Request {
  user: { id: string; role: string; tenantId: string | null };
}

const OPERA = ['salesperson', 'manager', 'tenant_admin', 'super_admin'];
/** Anular contrato emitido é decisão de gerência, não do vendedor. */
const ANULA = ['manager', 'tenant_admin', 'super_admin'];

const assinarSchema = z.object({
  role: z.enum(['customer', 'dealer']),
  signerName: z.string().min(3).max(160),
  signerDocument: z.string().max(20).optional(),
});

const anularSchema = z.object({ reason: z.string().min(5).max(500) });

@Controller()
@UseGuards(RolesGuard)
@Roles(...OPERA)
export class ContractsController {
  constructor(private readonly contratos: ContractsService) {}

  @Post('deals/:id/contract')
  emitir(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.contratos.emitir(escopoDa(req.user), id, req.user.id);
  }

  @Get('deals/:id/contracts')
  listar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.contratos.doNegocio(escopoDa(req.user), id);
  }

  /** O PDF é regerado do snapshot e conferido contra o hash antes de sair. */
  @Get('contracts/:id/pdf')
  @Header('Content-Type', 'application/pdf')
  async baixar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { pdf, contrato } = await this.contratos.baixar(escopoDa(req.user), id);

    res.setHeader(
      'Content-Disposition',
      `inline; filename="contrato-${contrato.id.slice(0, 8)}.pdf"`,
    );
    // Documento com efeito jurídico não fica em cache de proxy.
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(pdf);
  }

  /** Link assinado de validade curta, quando o contrato está arquivado. */
  @Get('contracts/:id/link')
  link(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.contratos.linkTemporario(escopoDa(req.user), id);
  }

  @Post('contracts/:id/sign')
  assinar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const dados = assinarSchema.parse(body);

    return this.contratos.assinar(escopoDa(req.user), id, {
      ...dados,
      signerUserId: req.user.id,
      // Trilha de evidências: é o mesmo conjunto que qualquer provedor externo
      // pede quando a assinatura deixar de ser interna.
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('contracts/:id/void')
  @Roles(...ANULA)
  anular(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { reason } = anularSchema.parse(body);
    return this.contratos.anular(escopoDa(req.user), id, reason);
  }
}
