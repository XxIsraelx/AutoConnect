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
import {
  EmailVerificadoGuard,
  ExigeEmailVerificado,
} from '../../common/guards/email-verificado.guard';

export const acceptInviteSchema = z.object({
  token: z.string().min(10),
  fullName: z.string().min(2).max(200),
  password: z.string().min(8).max(128),
  phone: z.string().optional(),
});

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly svc: InvitationsService) {}

  /**
   * Convidar equipe manda e-mail a terceiros com a nossa marca — por isso é uma
   * das duas ações que exigem e-mail confirmado desde que o cadastro passou a
   * ser em autosserviço. Reenviar e revogar não exigem: quem já convidou
   * precisa poder corrigir.
   */
  @Post()
  @UseGuards(RolesGuard, EmailVerificadoGuard)
  @Roles('tenant_admin', 'manager')
  @ExigeEmailVerificado()
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

  @Post(':id/resend')
  @UseGuards(RolesGuard)
  @Roles('tenant_admin', 'manager')
  async resend(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.svc.resend(tenantId, id);
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
