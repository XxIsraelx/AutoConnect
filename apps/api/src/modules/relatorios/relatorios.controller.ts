import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RelatoriosService } from './relatorios.service';
import { desempenhoQuerySchema } from './desempenho.schema';
import { escopoDa } from '../../common/escopo';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BOM } from './csv';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

/**
 * Quem abre relatório de desempenho.
 *
 * `customer` fica de fora por razão óbvia; `salesperson` entra porque ver o
 * próprio número é o que faz a meta significar alguma coisa. O que ele **não**
 * vê — a linha dos colegas, faturamento, margem e comissão — é decidido no
 * service, e o filtro vai na consulta, não na serialização.
 */
const OPERA = ['salesperson', 'manager', 'tenant_admin', 'super_admin'];

@Controller('tenant/reports')
@UseGuards(RolesGuard)
@Roles(...OPERA)
export class RelatoriosController {
  constructor(private readonly relatorios: RelatoriosService) {}

  /** GET /tenant/reports/salespeople?days=30 — desempenho por vendedor. */
  @Get('salespeople')
  desempenho(@Req() req: AuthRequest, @Query() query: unknown): Promise<unknown> {
    const { days } = desempenhoQuerySchema.parse(query);
    return this.relatorios.desempenhoPorVendedor(escopoDa(req.user), req.user, days);
  }

  /** GET /tenant/reports/salespeople.csv */
  @Get('salespeople.csv')
  async csvDesempenho(
    @Req() req: AuthRequest,
    @Res() res: Response,
    @Query() query: unknown,
  ): Promise<void> {
    const { days } = desempenhoQuerySchema.parse(query);
    const csv = await this.relatorios.csvDeDesempenho(escopoDa(req.user), req.user, days);
    this.entregar(res, `desempenho_vendedores_${Date.now()}.csv`, csv);
  }

  /** GET /tenant/reports/deals.csv */
  @Get('deals.csv')
  async csvNegocios(
    @Req() req: AuthRequest,
    @Res() res: Response,
    @Query() query: unknown,
  ): Promise<void> {
    const { days } = desempenhoQuerySchema.parse(query);
    const csv = await this.relatorios.csvDeNegocios(escopoDa(req.user), req.user, days);
    this.entregar(res, `negocios_${Date.now()}.csv`, csv);
  }

  /** GET /tenant/reports/inventory.csv — estoque atual, não o do período. */
  @Get('inventory.csv')
  async csvEstoque(@Req() req: AuthRequest, @Res() res: Response): Promise<void> {
    const csv = await this.relatorios.csvDeEstoque(escopoDa(req.user), req.user);
    this.entregar(res, `estoque_${Date.now()}.csv`, csv);
  }

  private entregar(res: Response, arquivo: string, csv: string): void {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${arquivo}"`);
    res.send(BOM + csv);
  }
}
