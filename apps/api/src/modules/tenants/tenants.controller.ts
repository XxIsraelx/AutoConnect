import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import type { AuthenticatedRequest } from '../../common/middleware/tenant.middleware';
import { escopoDa } from '../../common/escopo';
import { novaFilialSchema, updateTenantSchema, updateBranchSchema } from '@autoconnect/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('tenant')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('me')
  async me(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ tenant: unknown | null }> {
    if (!req.tenantId) return { tenant: null };
    return { tenant: await this.tenants.findById(req.tenantId) };
  }

  /** GET /tenant/stats — veículos disponíveis, leads hoje, leads novos */
  @Get('stats')
  stats(@Req() req: AuthenticatedRequest): Promise<unknown> {
    // Super admin sem concessionária selecionada recebe o consolidado da
    // plataforma; qualquer outro papel sem tenant é recusado por escopoDa.
    return this.tenants.getStats(escopoDa(req.user!));
  }

  /** GET /tenant/reports — relatórios de leads por período */
  @Get('reports')
  reports(
    @Req() req: AuthenticatedRequest,
    @Query('days') days?: string,
  ): Promise<unknown> {
    return this.tenants.getReports(req.tenantId!, days ? parseInt(days, 10) : 30);
  }

  /** GET /tenant/users-proximity — distância dos clientes cadastrados */
  @Get('users-proximity')
  usersProximity(@Req() req: AuthenticatedRequest): Promise<unknown> {
    return this.tenants.getUsersProximity(req.tenantId!);
  }

  /**
   * PATCH /tenant/me — atualiza dados da concessionária.
   *
   * O corpo passa pelo Zod, e não só por anotação de tipo. Antes ele ia cru
   * para o `tenant.update` do Prisma: um `tenant_admin` que mandasse
   * `{ "isActive": false }` desativava a própria loja, e o mesmo valeria para
   * `slug` (a URL pública), `taxId` ou `settings`. Tipo de TypeScript não
   * existe em tempo de execução; o Zod descarta o que não está no schema.
   */
  @Patch('me')
  update(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.tenants.updateTenant(req.tenantId!, updateTenantSchema.parse(body));
  }

  /**
   * PATCH /tenant/branch/:id — atualiza dados de uma filial.
   *
   * Também passava o corpo cru para o Prisma. O Zod descarta o que não está no
   * schema, e `isHeadquarters` ficou de fora de propósito: trocar a matriz
   * merece rota própria.
   */
  /**
   * POST /tenant/branch — nova filial. Só o administrador da loja: é ela que
   * mexe no plano, e o teto de filiais é do plano (1 / 2 / 5). Acima do teto,
   * 422 dizendo qual plano comporta.
   */
  @Post('branch')
  @UseGuards(RolesGuard)
  @Roles('tenant_admin')
  createBranch(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.tenants.createBranch(req.tenantId!, novaFilialSchema.parse(body));
  }

  @Patch('branch/:id')
  updateBranch(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.tenants.updateBranch(req.tenantId!, id, updateBranchSchema.parse(body));
  }

}