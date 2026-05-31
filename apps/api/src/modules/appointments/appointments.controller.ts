import {
  Body, Controller, Get, Param, ParseUUIDPipe,
  Patch, Post, Query, Req,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly svc: AppointmentsService) {}

  /**
   * GET /appointments
   * Dealer/admin lista todos da concessionária.
   * Cliente lista apenas os seus.
   */
  @Get()
  findAll(
    @Req()            req: AuthRequest,
    @Query('status')  status?: string,
    @Query('from')    from?: string,
    @Query('to')      to?: string,
    @Query('page')    page?: string,
  ): Promise<unknown> {
    const { role, tenantId, id } = req.user;
    if (role === 'customer') {
      return this.svc.findByCustomer(id);
    }
    return this.svc.findAll(tenantId!, { status, from, to, page: page ? parseInt(page, 10) : 1 });
  }

  /** POST /appointments — cliente solicita agendamento */
  @Post()
  create(
    @Req()  req: AuthRequest,
    @Body() body: {
      tenantId:       string;
      vehicleId?:     string;
      branchId?:      string;
      leadId?:        string;
      type:           string;
      scheduledStart: string;
      notes?:         string;
    },
  ): Promise<unknown> {
    return this.svc.create(req.user.id, body);
  }

  /** PATCH /appointments/:id — dealer atualiza (confirma / reagenda / atribui) */
  @Patch(':id')
  update(
    @Req()                          req: AuthRequest,
    @Param('id', ParseUUIDPipe)     id: string,
    @Body()                         body: {
      status?:         string;
      scheduledStart?: string;
      salespersonId?:  string;
      notes?:          string;
    },
  ): Promise<unknown> {
    return this.svc.update(req.user.tenantId!, id, body);
  }

  /** PATCH /appointments/:id/cancel — cancela */
  @Patch(':id/cancel')
  cancel(
    @Req()                      req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    const { role, tenantId, id: userId } = req.user;
    return this.svc.cancel(
      role === 'customer' ? null : tenantId,
      role === 'customer' ? userId : null,
      id,
    );
  }
}
