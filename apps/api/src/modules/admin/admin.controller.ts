import {
  Body, Controller, Delete, ForbiddenException,
  Get, Param, ParseUUIDPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import { z } from 'zod';
import { SUBSCRIPTION_PLANS } from '@autoconnect/shared';
import { AdminService, PAPEIS_FILTRAVEIS } from './admin.service';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedRequest } from '../../common/middleware/tenant.middleware';

/**
 * Todo corpo e query passa por Zod: antes vinham só anotados em TypeScript, e
 * um `plan` inexistente ia cru para o Prisma e voltava como 500.
 */
const pagina = z.coerce.number().int().min(1).max(10_000).default(1);

const criarConviteSchema = z.object({
  email: z.string().trim().email('E-mail inválido.').max(160).optional(),
  note: z.string().trim().max(300).optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

const planoSchema = z.object({ plan: z.enum(SUBSCRIPTION_PLANS) });

const estenderTrialSchema = z.object({ days: z.number().int().min(1).max(365) });

const avisoSchema = z.object({
  message: z.string().trim().min(1, 'Escreva a mensagem.').max(500),
  type: z.enum(['info', 'warning', 'critical']).default('info'),
  expiresAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida.')
    .nullish(),
});

const usuariosQuery = z.object({
  role: z.enum(PAPEIS_FILTRAVEIS).optional().or(z.literal('').transform(() => undefined)),
  search: z.string().trim().max(100).optional(),
  page: pagina,
});

const auditoriaQuery = z.object({
  action: z.string().trim().max(80).optional(),
  page: pagina,
});

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
    @Body() body: unknown,
  ) {
    this.guard(req);
    return this.admin.createInvite(criarConviteSchema.parse(body));
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
    @Body() body: unknown,
  ) {
    this.guard(req);
    return this.admin.changePlan(id, planoSchema.parse(body).plan);
  }

  @Patch('tenants/:id/extend-trial')
  extendTrial(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    this.guard(req);
    return this.admin.extendTrial(id, estenderTrialSchema.parse(body).days);
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
    @Query() query: unknown,
  ): Promise<unknown[]> {
    this.guard(req);
    return this.admin.listUsers(usuariosQuery.parse(query));
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
    @Body() body: unknown,
  ) {
    this.guard(req);
    return this.admin.createAnnouncement(avisoSchema.parse(body));
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
    @Query() query: unknown,
  ) {
    this.guard(req);
    return this.admin.getAuditLog(auditoriaQuery.parse(query));
  }

  /* ── Status do sistema ─────────────────────────────────────── */

  @Get('system')
  systemHealth(@Req() req: AuthenticatedRequest) {
    this.guard(req);
    return this.admin.getSystemHealth();
  }
}
