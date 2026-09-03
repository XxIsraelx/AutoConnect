import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { TIPOS_CONSULTA } from '@autoconnect/shared';
import { ConsultasService } from './consultas.service';
import { escopoDa } from '../../common/escopo';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Public } from '../../common/decorators/public.decorator';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

/**
 * Consultar custa dinheiro, então o botão não fica na mão de todo mundo:
 * `manager+`, como o custo do veículo. O relatório de gasto, idem.
 */
const CONSULTA = ['manager', 'tenant_admin', 'super_admin'];

const consultarSchema = z
  .object({
    plate: z.string().min(7).max(10).optional(),
    vin: z.string().length(17).optional(),
    kind: z.enum(TIPOS_CONSULTA),
    vehicleId: z.string().uuid().optional(),
  })
  .refine((v) => v.plate || v.vin, { message: 'Informe a placa ou o chassi.' });

@Controller()
export class ConsultasController {
  constructor(private readonly consultas: ConsultasService) {}

  @Post('vehicle-queries')
  @UseGuards(RolesGuard)
  @Roles(...CONSULTA)
  consultar(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    const { plate, vin, kind, vehicleId } = consultarSchema.parse(body);
    return this.consultas.consultar(escopoDa(req.user), { placa: plate, chassi: vin }, kind, vehicleId);
  }

  @Get('vehicles/:id/queries')
  @UseGuards(RolesGuard)
  @Roles(...CONSULTA)
  doVeiculo(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.consultas.doVeiculo(escopoDa(req.user), id);
  }

  @Get('tenant/reports/query-spend')
  @UseGuards(RolesGuard)
  @Roles(...CONSULTA)
  gasto(
    @Req() req: AuthRequest,
    @Query('from') de?: string,
    @Query('to') ate?: string,
  ): Promise<unknown> {
    const fim = ate ? new Date(ate) : new Date();
    const inicio = de ? new Date(de) : new Date(fim.getFullYear(), fim.getMonth(), 1);
    return this.consultas.gastoDoPeriodo(escopoDa(req.user), inicio, fim);
  }

  /** Selo na vitrine. Público, e devolve só rótulo — nunca custo. */
  @Get('catalog/vehicles/:id/provenance')
  @Public()
  selo(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.consultas.seloPublico(id);
  }
}
