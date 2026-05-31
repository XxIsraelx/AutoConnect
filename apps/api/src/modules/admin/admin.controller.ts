import {
  Body, Controller, Delete, ForbiddenException,
  Get, Param, ParseUUIDPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedRequest } from '../../common/middleware/tenant.middleware';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Verifica se o request vem de um super_admin */
  private guard(req: AuthenticatedRequest) {
    if (req.user?.role !== 'super_admin') {
      throw new ForbiddenException('Acesso restrito a administradores');
    }
  }

  /* ── KPIs ──────────────────────────────────────────────────── */

  @Get('stats')
  stats(@Req() req: AuthenticatedRequest) {
    this.guard(req);
    return this.admin.getStats();
  }

  /* ── Convites ──────────────────────────────────────────────── */

  @Post('invites')
  createInvite(
    @Req() req: AuthenticatedRequest,
    @Body() body: { email?: string; note?: string; expiresInDays?: number },
  ) {
    this.guard(req);
    return this.admin.createInvite(body);
  }

  @Get('invites')
  listInvites(@Req() req: AuthenticatedRequest) {
    this.guard(req);
    return this.admin.listInvites();
  }

  @Patch('invites/:id/revoke')
  revokeInvite(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(req);
    return this.admin.revokeInvite(id);
  }

  @Delete('invites/:id')
  deleteInvite(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(req);
    return this.admin.deleteInvite(id);
  }

  /* ── Tenants ───────────────────────────────────────────────── */

  @Get('tenants')
  listTenants(@Req() req: AuthenticatedRequest): Promise<unknown[]> {
    this.guard(req);
    return this.admin.listTenants();
  }

  @Get('tenants/:id')
  getTenant(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(req);
    return this.admin.getTenantDetail(id);
  }

  @Patch('tenants/:id/plan')
  changePlan(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { plan: string },
  ) {
    this.guard(req);
    return this.admin.changePlan(id, body.plan);
  }

  @Patch('tenants/:id/extend-trial')
  extendTrial(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { days: number },
  ) {
    this.guard(req);
    return this.admin.extendTrial(id, body.days);
  }

  @Patch('tenants/:id/toggle')
  toggleTenant(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    this.guard(req);
    return this.admin.toggleTenantActive(id);
  }

  @Post('impersonate/:tenantId')
  impersonate(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    this.guard(req);
    return this.admin.impersonate(tenantId);
  }

  /* ── Usuários ──────────────────────────────────────────────── */

  @Get('users')
  listUsers(
    @Req() req: AuthenticatedRequest,
    @Query('role') role?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ): Promise<unknown[]> {
    this.guard(req);
    return this.admin.listUsers({ role, search, page: page ? +page : 1 });
  }

  @Patch('users/:id/suspend')
  toggleSuspend(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(req);
    return this.admin.toggleUserSuspend(id);
  }

  @Post('users/:id/reset-password')
  resetPassword(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(req);
    return this.admin.sendPasswordReset(id);
  }

  /* ── Avisos globais ────────────────────────────────────────── */

  @Post('announcements')
  createAnnouncement(
    @Req() req: AuthenticatedRequest,
    @Body() body: { message: string; type?: string; expiresAt?: string | null },
  ) {
    this.guard(req);
    return this.admin.createAnnouncement(body);
  }

  @Get('announcements')
  listAnnouncements(@Req() req: AuthenticatedRequest): Promise<unknown[]> {
    this.guard(req);
    return this.admin.listAnnouncements();
  }

  /** Endpoint público — usado pelo dashboard de todos os tenants */
  @Public()
  @Get('announcements/active')
  getActiveAnnouncement() {
    return this.admin.getActiveAnnouncement();
  }

  @Patch('announcements/:id/deactivate')
  deactivateAnnouncement(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.guard(req);
    return this.admin.deactivateAnnouncement(id);
  }

  /* ── Auditoria ─────────────────────────────────────────────── */

  @Get('audit')
  getAudit(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('action') action?: string,
  ) {
    this.guard(req);
    return this.admin.getAuditLog({ page: page ? +page : 1, action });
  }

  /* ── Status do sistema ─────────────────────────────────────── */

  @Get('system')
  systemHealth(@Req() req: AuthenticatedRequest) {
    this.guard(req);
    return this.admin.getSystemHealth();
  }
}
