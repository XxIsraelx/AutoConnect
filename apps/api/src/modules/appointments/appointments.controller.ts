import {
  Body, Controller, Get, Param, ParseUUIDPipe,
  Patch, Post, Query, Req,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { escopoDa } from '../../common/escopo';
import {
  agendamentoDaLojaSchema,
  agendamentoDoClienteSchema,
  atualizarAgendamentoSchema,
} from '@autoconnect/shared';

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
    @Req()                  req: AuthRequest,
    @Query('status')        status?: string,
    @Query('from')          from?: string,
    @Query('to')            to?: string,
    @Query('page')          page?: string,
    @Query('salespersonId') salespersonId?: string,
    @Query('type')          type?: string,
    @Query('q')             q?: string,
    @Query('limit')         limit?: string,
  ): Promise<unknown> {
    const { role, id } = req.user;
    if (role === 'customer') {
      return this.svc.findByCustomer(id);
    }
    return this.svc.findAll(escopoDa(req.user), {
      status, from, to,
      page: page ? parseInt(page, 10) : 1,
      salespersonId, type, q,
      limit: limit ? Math.min(parseInt(limit, 10), 500) : undefined,
    });
  }

  /** POST /appointments — cliente solicita agendamento */
  @Post()
  create(
    @Req()  req: AuthRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = agendamentoDoClienteSchema.parse(body);
    return this.svc.create(req.user.id, parsed);
  }

  /**
   * POST /appointments/dealer — a loja marca o compromisso.
   *
   * Separada de `POST /appointments` porque o corpo é outro: aqui quem
   * identifica o cliente é a loja, e ele pode não ter conta nenhuma. Misturar
   * os dois num schema só significaria aceitar `customerUserId` do cliente
   * logado — ou seja, agendar em nome de outra pessoa.
   */
  @Post('dealer')
  criarPelaLoja(
    @Req()  req: AuthRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = agendamentoDaLojaSchema.parse(body);
    return this.svc.criarPelaLoja(escopoDa(req.user), req.user.id, parsed);
  }

  /** PATCH /appointments/:id — dealer atualiza (confirma / reagenda / atribui) */
  @Patch(':id')
  update(
    @Req()                          req: AuthRequest,
    @Param('id', ParseUUIDPipe)     id: string,
    @Body()                         body: unknown,
  ): Promise<unknown> {
    const parsed = atualizarAgendamentoSchema.parse(body);
    return this.svc.update(req.user.tenantId!, id, parsed);
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
