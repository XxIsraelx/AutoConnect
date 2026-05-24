import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { inviteUserSchema } from '@autoconnect/shared';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Public } from '../../common/decorators/public.decorator';

const acceptInviteSchema = z.object({
  token: z.string().min(10),
  fullName: z.string().min(2).max(200),
  password: z.string().min(8).max(128),
  phone: z.string().optional(),
});

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly svc: InvitationsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('tenant_admin', 'manager')
  async create(
    @Body() body: unknown,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    const parsed = inviteUserSchema.parse(body);
    if (!tenantId) throw new BadRequestException('tenant não identificado');
    return this.svc.create(tenantId, user.id, parsed);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('tenant_admin', 'manager')
  async list(@TenantId() tenantId: string) {
    return this.svc.listByTenant(tenantId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('tenant_admin', 'manager')
  async revoke(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.svc.revoke(tenantId, id);
  }
}

@Public()
@Controller('public/invitations')
export class PublicInvitationsController {
  constructor(private readonly svc: InvitationsService) {}

  @Post('accept')
  async accept(@Body() body: unknown) {
    const parsed = acceptInviteSchema.parse(body);
    return this.svc.accept(parsed.token, parsed);
  }
}
