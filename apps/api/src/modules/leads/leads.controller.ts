import {
  Body, Controller, Delete, Get, Param,
  ParseUUIDPipe, Patch, Post, Query, Req, Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LeadsService } from './leads.service';
import {
  assignLeadSchema,
  createLeadSchema,
  exportLeadsSchema,
  leadManualSchema,
  leadPublicoSchema,
  listLeadsSchema,
  slaStatsSchema,
  updateLeadSchema,
  createLeadInteractionSchema,
} from '@autoconnect/shared';
import { escopoDa } from '../../common/escopo';
import { Public } from '../../common/decorators/public.decorator';
import type { Ator } from './carteira';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

/** Quem está pedindo — o que a carteira do vendedor consulta. */
const atorDa = (req: AuthRequest): Ator => ({ id: req.user.id, role: req.user.role });

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
   * POST /leads/public
   * Formulário do catálogo e da página da loja — **sem conta**.
   *
   * É a rota que fecha o furo principal do funil: até aqui o visitante que
   * queria falar sobre um carro tinha que criar conta primeiro, e a maioria
   * não criava. Quem está logado continua usando `POST /leads`, que vincula o
   * lead à conta; a tela escolhe a rota pelo token que tem em mãos.
   */
  @Public()
  @Post('public')
  criarPublico(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = leadPublicoSchema.parse(body);
    // `req.ip` respeita o `trust proxy` configurado no app.setup: atrás do
    // proxy do Railway ele é o IP do visitante, não o da borda — sem isso o
    // limite por IP bloquearia a internet inteira depois do quinto envio.
    return this.leads.criarPublico(parsed, req.ip ?? 'desconhecido');
  }

  /**
   * POST /leads/manual
   * O vendedor cadastra quem chegou por telefone, WhatsApp ou balcão.
   */
  @Post('manual')
  criarManual(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = leadManualSchema.parse(body);
    return this.leads.criarManual(escopoDa(req.user), atorDa(req), parsed);
  }

  /**
   * GET /leads
   * Somente dealer/admin — lista leads da própria concessionária.
   *
   * A query passa por Zod: `page` e `perPage` vinham de `parseInt` solto, e
   * `perPage=100000` era uma varredura da tabela inteira a um clique.
   */
  @Get()
  findAll(
    @Req() req: AuthRequest,
    @Query() query: Record<string, string>,
  ): Promise<unknown> {
    return this.leads.findAll(escopoDa(req.user), atorDa(req), listLeadsSchema.parse(query));
  }

  /**
   * GET /leads/stats
   * Contagem por status e por motivo de perda, para o painel.
   */
  @Get('stats')
  getStats(@Req() req: AuthRequest): Promise<unknown> {
    return this.leads.getStats(escopoDa(req.user), atorDa(req));
  }

  /**
   * GET /leads/sla-stats?days=30
   * Prazo de primeiro contato por vendedor — o que o relatório consome.
   */
  @Get('sla-stats')
  slaStats(
    @Req() req: AuthRequest,
    @Query() query: Record<string, string>,
  ): Promise<unknown> {
    return this.leads.slaStats(escopoDa(req.user), slaStatsSchema.parse(query));
  }

  /**
   * PATCH /leads/:id
   * Move o status e/ou corrige o veículo de interesse (dealer/admin).
   *
   * O veículo entrou aqui porque o lead de balcão nasce sem um: sem veículo
   * não há botão de negócio, e até então não existia rota nenhuma para
   * vinculá-lo depois.
   */
  @Patch(':id')
  atualizar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = updateLeadSchema.parse(body);
    return this.leads.atualizar(req.user.tenantId!, id, atorDa(req), parsed);
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
    return this.leads.remove(req.user.tenantId!, id, atorDa(req));
  }

  /** GET /leads/:id/history — timeline completa */
  @Get(':id/history')
  getHistory(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.leads.getHistory(req.user.tenantId!, id, atorDa(req));
  }

  /** PATCH /leads/:id/assign — atribui vendedor */
  @Patch(':id/assign')
  assign(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    // O corpo era só anotado: `salesPersonId` chegava como qualquer coisa e ia
    // direto para o `where` da busca do vendedor.
    const { salesPersonId } = assignLeadSchema.parse(body);
    return this.leads.assign(req.user.tenantId!, id, atorDa(req), salesPersonId);
  }

  /**
   * POST /leads/:id/interactions — nota, ligação, WhatsApp, visita.
   *
   * É também o que o clique em `wa.me` e `tel:` no painel chama: o vendedor
   * abre a conversa e a timeline registra que houve contato, sem ele digitar
   * nada. `kind` passa por Zod — era `string` livre e qualquer palavra virava
   * um item sem rótulo na tela.
   */
  @Post(':id/interactions')
  addInteraction(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = createLeadInteractionSchema.parse(body);
    return this.leads.addInteraction(
      req.user.tenantId!, id, atorDa(req), parsed.kind, parsed.content ?? null,
    );
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
    @Query() query: Record<string, string>,
  ) {
    const csv = await this.leads.exportCsv(
      escopoDa(req.user), atorDa(req), exportLeadsSchema.parse(query),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_${Date.now()}.csv"`);
    res.send('﻿' + csv); // BOM para Excel reconhecer UTF-8
  }
}
