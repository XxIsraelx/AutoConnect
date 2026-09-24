import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { plantaoSchema } from '@autoconnect/shared';
import { TeamService } from './team.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

@Controller('team')
@UseGuards(RolesGuard)
@Roles('tenant_admin', 'manager')
export class TeamController {
  constructor(private readonly svc: TeamService) {}

  /** GET /team/overview?period=YYYY-MM */
  @Get('overview')
  overview(@Req() req: AuthRequest, @Query('period') period?: string) {
    return this.svc.overview(req.user.tenantId!, period || currentPeriod());
  }

  /** POST /team/goals — define meta (userId null = equipe) */
  @Post('goals')
  setGoal(
    @Req() req: AuthRequest,
    @Body() body: { userId?: string | null; period?: string; target: number },
  ) {
    return this.svc.setGoal(
      req.user.tenantId!,
      body.userId ?? null,
      body.period || currentPeriod(),
      Number(body.target),
    );
  }

  /**
   * PATCH /team/members/:id/plantao — liga/desliga o rodízio para o membro.
   *
   * Gerente também pode: remanejar plantão é rotina de gestão do dia, não
   * mudança de contrato como a comissão.
   */
  @Patch('members/:id/plantao')
  setPlantao(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.setPlantao(req.user.tenantId!, id, plantaoSchema.parse(body));
  }

  /** PATCH /team/members/:id/commission — define % de comissão (só admin) */
  @Patch('members/:id/commission')
  @Roles('tenant_admin')
  setCommission(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { commissionPct: number | string | null },
  ) {
    const raw = body.commissionPct;
    const pct =
      raw === null || raw === '' || raw === undefined
        ? null
        : Math.min(100, Math.max(0, Number(raw)));
    return this.svc.setCommission(req.user.tenantId!, id, pct);
  }
}
