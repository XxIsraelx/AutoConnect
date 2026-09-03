import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import {
  createDealSchema,
  updateDealSchema,
  transitionDealSchema,
  createDealPaymentSchema,
  listDealsSchema,
  createAcquisitionSchema,
  createVehicleCostSchema,
  dadosDoCompradorSchema,
} from '@autoconnect/shared';
import { DealsService } from './deals.service';
import { escopoDa } from '../../common/escopo';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

/**
 * Quem opera negócios e quem enxerga custo.
 *
 * Custo de aquisição e margem ficam em `manager+` de propósito: é informação
 * que a maioria das lojas não mostra ao vendedor. A decisão está aqui, em duas
 * constantes, porque algumas lojas remuneram sobre a margem e vão querer o
 * contrário — e neste desenho isso é mudar uma linha, não caçar decorators.
 */
const OPERA = ['salesperson', 'manager', 'tenant_admin', 'super_admin'];
const VE_CUSTO = ['manager', 'tenant_admin', 'super_admin'];

@Controller('deals')
@UseGuards(RolesGuard)
@Roles(...OPERA)
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Post()
  create(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    return this.deals.create(escopoDa(req.user), req.user.id, createDealSchema.parse(body));
  }

  @Get()
  findAll(@Req() req: AuthRequest, @Query() query: unknown): Promise<unknown> {
    return this.deals.findAll(escopoDa(req.user), listDealsSchema.parse(query));
  }

  /** Clientes com quem a loja já se relacionou. Vem antes de `:id` na ordem
   *  das rotas, senão o Nest trataria "customers" como um id. */
  @Get('customers')
  clientes(@Req() req: AuthRequest, @Query('q') q?: string): Promise<unknown> {
    return this.deals.clientesRelacionados(escopoDa(req.user), q);
  }

  @Get(':id')
  findOne(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.deals.findOne(escopoDa(req.user), id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.deals.update(escopoDa(req.user), id, updateDealSchema.parse(body));
  }

  /** Qualificação do comprador — sem ela o contrato não é emitido. */
  @Put(':id/buyer')
  comprador(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.deals.salvarComprador(
      escopoDa(req.user), id, dadosDoCompradorSchema.parse(body),
    );
  }

  @Post(':id/transition')
  transition(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { to, reason } = transitionDealSchema.parse(body);
    return this.deals.transition(escopoDa(req.user), id, req.user.id, to, reason);
  }

  @Post(':id/payments')
  addPayment(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.deals.addPayment(escopoDa(req.user), id, createDealPaymentSchema.parse(body));
  }

  @Get(':id/margin')
  @Roles(...VE_CUSTO)
  margin(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.deals.margemDoNegocio(escopoDa(req.user), id);
  }
}

/**
 * Custo do veículo. Rotas penduradas em `/vehicles/:id` porque o custo é do
 * carro, não do negócio — o carro pode ter custo sem nunca ter sido vendido.
 */
@Controller()
@UseGuards(RolesGuard)
@Roles(...VE_CUSTO)
export class VehicleCostController {
  constructor(private readonly deals: DealsService) {}

  @Post('vehicles/:id/acquisition')
  acquisition(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.deals.registrarAquisicao(
      escopoDa(req.user), id, createAcquisitionSchema.parse(body),
    );
  }

  @Get('vehicles/:id/costs')
  listCosts(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.deals.custoDoVeiculo(escopoDa(req.user), id);
  }

  @Post('vehicles/:id/costs')
  cost(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.deals.lancarCusto(
      escopoDa(req.user), id, createVehicleCostSchema.parse(body),
    );
  }

  @Get('tenant/reports/inventory')
  inventory(@Req() req: AuthRequest): Promise<unknown> {
    return this.deals.relatorioEstoque(escopoDa(req.user));
  }

  @Get('tenant/reports/margin')
  marginReport(@Req() req: AuthRequest): Promise<unknown> {
    return this.deals.relatorioMargem(escopoDa(req.user));
  }
}
