import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: { id: string }) {
    return this.users.me(user.id);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('tenant_admin', 'manager')
  list(@TenantId() tenantId: string) {
    return this.users.listByTenant(tenantId);
  }
}
