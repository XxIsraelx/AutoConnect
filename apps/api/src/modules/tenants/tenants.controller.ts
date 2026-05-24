import { Controller, Get, Req } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import type { AuthenticatedRequest } from '../../common/middleware/tenant.middleware';

@Controller('tenant')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('me')
  async me(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ tenant: unknown | null }> {
    if (!req.tenantId) {
      return { tenant: null };
    }

    return {
      tenant: await this.tenants.findById(req.tenantId),
    };
  }
}