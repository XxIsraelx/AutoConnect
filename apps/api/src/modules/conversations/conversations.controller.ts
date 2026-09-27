import {
  Body, ConflictException, Controller, Get, Param, ParseUUIDPipe,
  Patch, Post, Query, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ConversationsService } from './conversations.service';
import { escopoDa } from '../../common/escopo';
import { Public } from '../../common/decorators/public.decorator';
import { LiberadoNoBloqueio } from '../../common/guards/somente-leitura.guard';
import {
  conversaDoLeadSchema,
  iniciarConversaSchema,
  mensagemDeVisitanteSchema,
} from '@autoconnect/shared';
import { LimiteDeVisitante } from './limite-de-visitante';

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
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = iniciarConversaSchema.parse(body);
    return this.svc.getOrCreate(req.user.id, parsed.tenantId, parsed.vehicleId, parsed.leadId);
  }

  /**
   * POST /conversations/from-lead — lojista abre conversa a partir do lead.
   *
   * Vale para lead **com e sem conta**: sem conta, a resposta traz o
   * `guestUrl`, que é a única vez que o link cru existe.
   */
  @Post('from-lead')
  fromLead(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = conversaDoLeadSchema.parse(body);
    return this.svc.getOrCreateFromLead(req.user.tenantId!, req.user.id, parsed.leadId);
  }

  /**
   * POST /conversations/:id/guest-link — gera um link novo para o visitante.
   *
   * O anterior deixa de valer: o banco guarda o hash, então o link não pode ser
   * mostrado duas vezes. Mesmo comportamento do "reenviar convite" da equipe.
   */
  @Post(':id/guest-link')
  novoLink(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.svc.novoLinkDeVisitante(req.user.tenantId!, id);
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

/**
 * A conversa vista de fora: **sem conta e sem token de sessão**, só com o link.
 *
 * É o outro lado do B11. A loja abre a conversa com o lead anônimo e manda o
 * link; esta é a porta por onde ele entra, lê e responde. Não há WebSocket aqui
 * de propósito — o visitante não tem JWT, e autenticar socket por link exigiria
 * um segundo mecanismo de identidade. A página dele pergunta de novo a cada
 * poucos segundos; a loja, que tem socket, recebe a mensagem na hora
 * (`ChatEventosService`).
 *
 * `@LiberadoNoBloqueio` porque é o cliente do cliente: uma loja com fatura
 * vencida não deve deixar a conversa do consumidor sem resposta — a mesma razão
 * por que a vitrine pública fica no ar.
 */
@Controller('public/conversations')
export class PublicConversationsController {
  constructor(
    private readonly svc: ConversationsService,
    private readonly limite: LimiteDeVisitante,
  ) {}

  @Public()
  @LiberadoNoBloqueio()
  @Get(':token')
  ler(@Param('token') token: string): Promise<unknown> {
    return this.svc.visitanteLe(token);
  }

  @Public()
  @LiberadoNoBloqueio()
  @Post(':token/messages')
  escrever(
    @Req() req: Request,
    @Param('token') token: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    // Teto por IP na memória do processo, como no formulário público de lead:
    // sem ele, um link vazado é um canal de despejo direto no painel da loja.
    if (!this.limite.permitir(req.ip ?? 'desconhecido')) {
      throw new ConflictException('Muitas mensagens em pouco tempo. Aguarde alguns minutos.');
    }
    const parsed = mensagemDeVisitanteSchema.parse(body);
    return this.svc.visitanteEscreve(token, parsed.body);
  }
}
