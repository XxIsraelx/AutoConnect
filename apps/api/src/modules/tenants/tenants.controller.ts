import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { TenantsService } from './tenants.service';
import type { AuthenticatedRequest } from '../../common/middleware/tenant.middleware';

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
    return this.tenants.getStats(req.tenantId!);
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

  /** PATCH /tenant/me — atualiza dados da concessionária */
  @Patch('me')
  update(
    @Req() req: AuthenticatedRequest,
    @Body() body: {
      tradeName?: string;
      primaryPhone?: string;
      logoUrl?: string;
      brandColor?: string;
      websiteUrl?: string;
      acceptsTradeIn?: boolean;
    },
  ): Promise<unknown> {
    return this.tenants.updateTenant(req.tenantId!, body);
  }

  /** PATCH /tenant/branch/:id — atualiza dados de uma filial */
  @Patch('branch/:id')
  updateBranch(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      name?: string;
      phone?: string;
      email?: string;
      addressLine?: string;
      addressNumber?: string;
      complement?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      businessHours?: Prisma.InputJsonValue;
    },
  ): Promise<unknown> {
    return this.tenants.updateBranch(req.tenantId!, id, body);
  }
}