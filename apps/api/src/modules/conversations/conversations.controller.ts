import {
  Body, Controller, Get, Param, ParseUUIDPipe,
  Patch, Post, Query, Req,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { escopoDa } from '../../common/escopo';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly svc: ConversationsService) {}

  /** GET /conversations — dealer lista todas; customer lista as suas */
  @Get()
  findAll(
    @Req()          req: AuthRequest,
    @Query('status') status?: string,
    @Query('page')   page?: string,
  ): Promise<unknown> {
    const { role, id } = req.user;
    if (role === 'customer') {
      return this.svc.findAllByCustomer(id, { status, page: page ? parseInt(page, 10) : 1 });
    }
    return this.svc.findAllByTenant(escopoDa(req.user), { status, page: page ? parseInt(page, 10) : 1 });
  }

  /** GET /conversations/:id/messages — mensagens */
  @Get(':id/messages')
  getMessages(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.svc.getMessages(req.user.tenantId, req.user.id, id);
  }

  /** POST /conversations — cria ou retorna conversa (customer → tenant) */
  @Post()
  getOrCreate(
    @Req() req: AuthRequest,
    @Body() body: { tenantId: string; vehicleId?: string; leadId?: string },
  ): Promise<unknown> {
    return this.svc.getOrCreate(req.user.id, body.tenantId, body.vehicleId, body.leadId);
  }

  /** POST /conversations/from-lead — lojista abre conversa com o cliente do lead */
  @Post('from-lead')
  fromLead(
    @Req() req: AuthRequest,
    @Body() body: { leadId: string },
  ): Promise<unknown> {
    return this.svc.getOrCreateFromLead(req.user.tenantId!, req.user.id, body.leadId);
  }

  /** PATCH /conversations/:id/close — fecha conversa (dealer) */
  @Patch(':id/close')
  close(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.svc.close(req.user.tenantId!, id);
  }
}
