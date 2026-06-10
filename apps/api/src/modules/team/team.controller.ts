import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
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
}
