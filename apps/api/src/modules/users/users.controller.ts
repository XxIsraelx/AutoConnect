import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
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

  /** PATCH /users/me — atualiza o próprio perfil */
  @Patch('me')
  updateMe(
    @CurrentUser() user: { id: string },
    @Body() body: {
      fullName?: string; phone?: string; avatarUrl?: string;
      documentNumber?: string; city?: string; state?: string; postalCode?: string;
    },
  ) {
    return this.users.updateProfile(user.id, body);
  }

  /** POST /users/me/password — troca a senha */
  @Post('me/password')
  changePassword(
    @CurrentUser() user: { id: string },
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.users.changePassword(user.id, body.currentPassword, body.newPassword);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('tenant_admin', 'manager')
  list(@TenantId() tenantId: string) {
    return this.users.listByTenant(tenantId);
  }
}
