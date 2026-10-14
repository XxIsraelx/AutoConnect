import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import { escopoDa } from '../../common/escopo';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  cancelarRenaveSchema, chaveNfeRenaveSchema, confirmarRenaveSchema,
  recusarRenaveSchema, registrarRenaveSchema,
} from '@autoconnect/shared';
import { PAPEIS_DA_EQUIPE, PAPEIS_FISCAIS, RenaveService } from './renave.service';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

/**
 * RENAVE — registro manual (R1 do plano fiscal).
 *
 * Ler é da equipe: o vendedor precisa saber que "falta registrar a saída" para
 * não prometer a documentação ao cliente. Escrever é da gerência, como o
 * financeiro (regra 6 do plano fiscal).
 *
 * Toda escrita passa pelo `SomenteLeituraGuard` global, sem exceção nova: a
 * loja bloqueada continua vendo as pendências, e registra quando voltar.
 */
@Controller('renave')
@UseGuards(RolesGuard)
@Roles(...PAPEIS_FISCAIS)
export class RenaveController {
  constructor(private readonly renave: RenaveService) {}

  /** GET /renave/pendencias — a lista da gerência. */
  @Get('pendencias')
  pendencias(@Req() req: AuthRequest): Promise<unknown> {
    return this.renave.pendencias(escopoDa(req.user));
  }

  /** GET /renave/veiculos/:id — o cartão do veículo e do negócio. */
  @Get('veiculos/:id')
  @Roles(...PAPEIS_DA_EQUIPE)
  doVeiculo(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.renave.doVeiculo(escopoDa(req.user), id);
  }

  /** POST /renave/registros — com protocolo nasce confirmado; sem, aguardando. */
  @Post('registros')
  registrar(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    return this.renave.registrar(escopoDa(req.user), registrarRenaveSchema.parse(body), req.user);
  }

  @Post('registros/:id/confirmar')
  confirmar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.renave.confirmar(escopoDa(req.user), id, confirmarRenaveSchema.parse(body));
  }

  @Post('registros/:id/recusar')
  recusar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { motivo } = recusarRenaveSchema.parse(body);
    return this.renave.recusar(escopoDa(req.user), id, motivo);
  }

  @Post('registros/:id/cancelar')
  cancelar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.renave.cancelar(escopoDa(req.user), id, cancelarRenaveSchema.parse(body));
  }

  @Post('registros/:id/nfe')
  informarNfe(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { chaveNfe } = chaveNfeRenaveSchema.parse(body);
    return this.renave.informarNfe(escopoDa(req.user), id, chaveNfe);
  }
}
