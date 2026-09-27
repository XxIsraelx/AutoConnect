import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe,
  Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  abrirConversaDeWhatsAppSchema,
  conectarWhatsAppSchema,
  enviarModeloDeWhatsAppSchema,
  simularWhatsAppSchema,
  type ChaveDoModelo,
} from '@autoconnect/shared';
import { escopoDa, ehGlobal } from '../../common/escopo';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WhatsappService } from './whatsapp.service';

interface AuthRequest extends Request {
  user: { id: string; role: string; tenantId: string | null };
}

/** Quem atende: os mesmos papéis que usam o chat. */
const ATENDE = ['salesperson', 'manager', 'tenant_admin', 'super_admin'];

@Controller('whatsapp')
@UseGuards(RolesGuard)
@Roles(...ATENDE)
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  private loja(req: AuthRequest): string {
    const escopo = escopoDa(req.user);
    if (ehGlobal(escopo)) {
      throw new BadRequestException('Selecione uma concessionária para usar o WhatsApp.');
    }
    return escopo.tenantId;
  }

  /** Se há provedor e se a loja tem número conectado — a tela se monta por aqui. */
  @Get('capacidade')
  capacidade(@Req() req: AuthRequest): Promise<unknown> {
    return this.whatsapp.capacidade(this.loja(req));
  }

  /** Conectar o número é decisão do dono: é a voz da loja no WhatsApp. */
  @Post('conta')
  @Roles('tenant_admin', 'super_admin')
  conectar(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    return this.whatsapp.conectar(this.loja(req), req.user.id, conectarWhatsAppSchema.parse(body));
  }

  @Delete('conta')
  @Roles('tenant_admin', 'super_admin')
  desconectar(@Req() req: AuthRequest): Promise<unknown> {
    return this.whatsapp.desconectar(this.loja(req));
  }

  /** Abre (ou retoma) a conversa de WhatsApp de um lead. */
  @Post('conversas')
  abrir(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    const { leadId } = abrirConversaDeWhatsAppSchema.parse(body);
    return this.whatsapp.abrirConversaDoLead(this.loja(req), req.user, leadId);
  }

  /**
   * Envia um modelo aprovado. A mensagem livre sai pelo socket do chat, como
   * no chat interno; o modelo é REST porque é escolha de menu, não digitação —
   * e porque passa pelo guard de somente leitura: modelo custa, e loja com a
   * assinatura bloqueada não gera custo novo.
   */
  @Post('conversas/:id/modelo')
  modelo(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { modelo } = enviarModeloDeWhatsAppSchema.parse(body);
    return this.whatsapp.enviarModelo(this.loja(req), req.user, id, modelo as ChaveDoModelo);
  }

  @Get('uso')
  uso(@Req() req: AuthRequest): Promise<unknown> {
    return this.whatsapp.uso(this.loja(req));
  }

  /** Só com o provedor simulado, fora de produção (404 no resto). */
  @Post('simular')
  simular(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    const dados = simularWhatsAppSchema.parse(body);
    const tenantId = this.loja(req);
    return dados.acao === 'mensagem'
      ? this.whatsapp.simularMensagem(tenantId, dados)
      : this.whatsapp.simularStatus(tenantId, {
          mensagemId: dados.mensagemId,
          status: dados.status as 'enviada' | 'entregue' | 'lida' | 'falhou',
        });
  }
}

/**
 * Entrada do provedor. Pública porque quem chama é a Meta, não um usuário: a
 * autenticação é o HMAC do corpo cru, conferido pelo adaptador. Rota pública
 * não passa pelo guard de somente leitura — o cliente do cliente é atendido
 * mesmo com a assinatura da loja vencida, como a vitrine.
 *
 * O corpo chega **cru** (`Buffer`) — ver `corpoCru` no `app.setup.ts`.
 */
@Controller('webhooks')
export class WebhookWhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  /** Desafio do cadastro do webhook no painel da Meta: devolve o `challenge` cru. */
  @Public()
  @Get('whatsapp')
  desafio(@Query() consulta: Record<string, unknown>, @Res() res: Response): void {
    const desafio = this.whatsapp.responderDesafio(consulta);
    if (desafio === null) {
      res.status(403).type('text/plain').send('Token de verificação não confere.');
      return;
    }
    res.status(200).type('text/plain').send(desafio);
  }

  @Public()
  @Post('whatsapp')
  @HttpCode(200)
  receber(@Req() req: Request): Promise<unknown> {
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return this.whatsapp.receberWebhook(req.headers, corpo);
  }
}
