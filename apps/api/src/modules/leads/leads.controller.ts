import {
  Body, Controller, Delete, Get, Param,
  ParseUUIDPipe, Patch, Post, Query, Req, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { LeadsService } from './leads.service';
import { createLeadSchema, updateLeadStatusSchema } from '@autoconnect/shared';
import { escopoDa } from '../../common/escopo';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  /**
   * POST /leads
   * Qualquer cliente logado pode criar um lead.
   * O tenantId vem do body (qual loja).
   */
  @Post()
  create(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    // O tenantId diz para qual loja é o lead e agora vem do schema, validado
    // como uuid — antes era lido do corpo cru com um cast.
    const parsed = createLeadSchema.parse(body);
    return this.leads.create(req.user.id, parsed.tenantId, parsed);
  }

  /**
   * GET /leads
   * Somente dealer/admin — lista leads da própria concessionária.
   */
  @Get()
  findAll(
    @Req() req: AuthRequest,
    @Query('status')    status?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('page')      page?: string,
    @Query('perPage')   perPage?: string,
  ): Promise<unknown> {
    return this.leads.findAll(escopoDa(req.user), {
      status,
      vehicleId,
      page:    page    ? parseInt(page, 10)    : undefined,
      perPage: perPage ? parseInt(perPage, 10) : undefined,
    });
  }

  /**
   * GET /leads/stats
   * Contagem por status para o dashboard.
   */
  @Get('stats')
  getStats(@Req() req: AuthRequest): Promise<unknown> {
    return this.leads.getStats(escopoDa(req.user));
  }

  /**
   * PATCH /leads/:id
   * Atualiza status de um lead (dealer/admin).
   */
  @Patch(':id')
  updateStatus(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = updateLeadStatusSchema.parse(body);
    return this.leads.updateStatus(req.user.tenantId!, id, parsed);
  }

  /**
   * DELETE /leads/:id
   * Remove um lead (dealer/admin).
   */
  @Delete(':id')
  remove(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean }> {
    return this.leads.remove(req.user.tenantId!, id);
  }

  /** GET /leads/:id/history — timeline completa */
  @Get(':id/history')
  getHistory(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.leads.getHistory(req.user.tenantId!, id);
  }

  /** PATCH /leads/:id/assign — atribui vendedor */
  @Patch(':id/assign')
  assign(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { salesPersonId: string | null },
  ): Promise<unknown> {
    return this.leads.assign(req.user.tenantId!, id, body.salesPersonId ?? null);
  }

  /** POST /leads/:id/interactions — adiciona nota/interação manual */
  @Post(':id/interactions')
  addInteraction(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { kind: string; content: string },
  ): Promise<unknown> {
    return this.leads.addInteraction(req.user.tenantId!, id, req.user.id, body.kind, body.content);
  }

  /** POST /leads/:id/trade-in/appraisal — vendedor avalia o veículo da troca */
  @Post(':id/trade-in/appraisal')
  appraiseTradeIn(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { value: number; note?: string; status?: 'offered' | 'rejected' },
  ): Promise<unknown> {
    return this.leads.setTradeInAppraisal(req.user.tenantId!, id, req.user.id, {
      value: Number(body.value),
      note: body.note,
      status: body.status,
    });
  }

  /** GET /leads/export/csv — exporta como CSV */
  @Get('export/csv')
  async exportCsv(
    @Req() req: AuthRequest,
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
  ) {
    const csv = await this.leads.exportCsv(req.user.tenantId!, { status, from, to });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_${Date.now()}.csv"`);
    res.send('﻿' + csv); // BOM para Excel reconhecer UTF-8
  }
}
