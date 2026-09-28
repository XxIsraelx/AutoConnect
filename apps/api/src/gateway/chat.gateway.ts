import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { HttpException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService, type ScopedClient } from '../common/prisma/prisma.service';
import { PropostaChatService } from '../modules/deals/proposta-chat.service';
import { ChatEventosService } from './chat-eventos.service';
import { WhatsappService } from '../modules/whatsapp/whatsapp.service';
import { PushService } from '../modules/users/push/push.service';
import { SlaService } from '../modules/crm/sla.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  tenantId?: string | null;
  role?: string;
}

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: process.env.WEB_URL ?? 'http://localhost:3000', credentials: true },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly proposta: PropostaChatService,
    private readonly eventos: ChatEventosService,
    private readonly whatsapp: WhatsappService,
    private readonly push: PushService,
    private readonly sla: SlaService,
  ) {}

  /** O texto que a tela mostra quando o envio é recusado. */
  private motivo(err: unknown): string {
    if (err instanceof HttpException) {
      const r = err.getResponse();
      if (typeof r === 'string') return r;
      const m = (r as { message?: unknown }).message;
      if (typeof m === 'string') return m;
    }
    this.logger.error(`Envio pelo chat quebrou: ${err}`);
    return 'Não foi possível enviar a mensagem.';
  }

  /**
   * Entrega o servidor para quem emite de fora do socket — hoje, a mensagem do
   * visitante sem conta, que entra por rota REST pública. Sem isto o vendedor
   * com a conversa aberta só veria a resposta ao recarregar a página.
   */
  afterInit(servidor: Server) {
    this.eventos.registrar(servidor);
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ??
        (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');

      if (!token) { client.disconnect(); return; }

      const payload = this.jwt.verify<{ sub: string; role: string; tenantId: string | null }>(token);
      client.userId   = payload.sub;
      client.tenantId = payload.tenantId;
      client.role     = payload.role;
      // A equipe da loja escuta a loja inteira: é por aqui que a lista de
      // conversas descobre uma conversa nova (o cliente que escreveu no
      // WhatsApp agora) sem precisar recarregar.
      if (payload.tenantId) client.join(`tenant:${payload.tenantId}`);

      this.logger.log(`socket connected: ${client.id} (user: ${payload.sub})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`socket disconnected: ${client.id}`);
  }


  /**
   * O socket é de um vendedor (tem tenantId) ou de um cliente (não tem). Cada
   * um entra pelo seu contexto de isolamento — as policies `tenant_isolation` e
   * `acesso_cliente` de conversations/messages leem variáveis diferentes.
   */
  private noContexto<T>(
    client: AuthenticatedSocket,
    fn: (tx: ScopedClient) => Promise<T>,
  ): Promise<T> {
    return client.tenantId
      ? this.prisma.withTenant(client.tenantId, fn)
      : this.prisma.withUser(client.userId!, fn);
  }


  @SubscribeMessage('conversation:join')
  async onJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!client.userId) return { ok: false };

    const conv = await this.noContexto(client, (tx) =>
      tx.conversation.findFirst({
        where: {
          id: data.conversationId,
          OR: [
            { customerUserId: client.userId },
            { salespersonId:  client.userId },
            ...(client.tenantId ? [{ tenantId: client.tenantId }] : []),
          ],
        },
      }),
    );
    if (!conv) return { ok: false, error: 'Sem acesso' };

    client.join(`conversation:${data.conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('conversation:send')
  async onSend(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: {
      conversationId: string;
      body: string;
      kind?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    if (!client.userId) return { ok: false };

    const conv = await this.noContexto(client, (tx) =>
      tx.conversation.findFirst({
        where: {
          id: data.conversationId,
          OR: [
            { customerUserId: client.userId },
            { salespersonId:  client.userId },
            ...(client.tenantId ? [{ tenantId: client.tenantId }] : []),
          ],
        },
      }),
    );
    if (!conv) return { ok: false, error: 'Sem acesso' };

    // Conversa de WhatsApp: a mensagem sai pelo número oficial da loja, e quem
    // grava, avisa a tela e confere a janela de 24 h é o serviço do WhatsApp.
    if (conv.channel === 'whatsapp') {
      if (!client.tenantId || client.role === 'customer') return { ok: false, error: 'Sem acesso' };
      if (data.metadata?.proposal) {
        return {
          ok: false,
          error: 'A proposta com botão de aceite é do chat do sistema. No WhatsApp, mande os valores por mensagem.',
        };
      }
      try {
        const enviada = await this.whatsapp.enviarTexto(
          client.tenantId,
          { id: client.userId, role: client.role ?? 'salesperson' },
          conv.id,
          data.body ?? '',
        );
        return { ok: true, messageId: enviada.id, deliveryStatus: enviada.deliveryStatus };
      } catch (err) {
        return { ok: false, error: this.motivo(err) };
      }
    }

    // Propostas só podem ser enviadas pela equipe da concessionária
    if (data.metadata?.proposal && client.role === 'customer') {
      return { ok: false, error: 'Apenas a concessionária envia propostas' };
    }

    // Proposta enviada pela loja abre o negócio antes de gravar a mensagem,
    // para que o id entre no metadata e o card fique ligado ao funil.
    let metadata = data.metadata;
    if (data.metadata?.proposal && client.tenantId && client.userId) {
      const dealId = await this.proposta.abrirNegocio(
        client.tenantId,
        client.userId,
        conv,
        data.metadata.proposal as Record<string, unknown>,
      );
      if (dealId) {
        metadata = {
          ...data.metadata,
          proposal: { ...(data.metadata.proposal as object), dealId },
        };
      }
    }

    const agora = new Date();
    const daEquipe = !!client.tenantId && client.role !== 'customer';
    const msg = await this.noContexto(client, async (tx) => {
      const criada = await tx.message.create({
        data: {
          conversationId: data.conversationId,
          tenantId:       conv.tenantId,
          senderUserId:   client.userId,
          body:           data.body,
          kind:           (data.kind ?? 'text') as never,
          ...(metadata ? { metadata: metadata as never } : {}),
        },
        include: {
          sender: { select: { id: true, fullName: true, avatarUrl: true } },
        },
      });

      await tx.conversation.update({
        where: { id: data.conversationId },
        data:  {
          lastMessageAt: agora,
          // Última mensagem do cliente: a mesma coluna que abre a janela do
          // WhatsApp, preenchida em todo canal para a tela ler de um jeito só.
          ...(client.role === 'customer' ? { customerLastMessageAt: agora } : {}),
        },
      });

      if (daEquipe && conv.leadId) {
        await this.respondeuOLead(tx, conv, criada.id, client.userId!, agora);
      }
      return criada;
    });

    this.server.to(`conversation:${data.conversationId}`).emit('conversation:message', msg);
    // O cliente com conta escreveu: o vendedor pode estar com o painel fechado.
    if (client.role === 'customer') {
      this.push.avisarMensagem(conv.tenantId, {
        conversationId: conv.id,
        salespersonId: conv.salespersonId,
        nome: msg.sender?.fullName ?? null,
        canal: 'Chat',
        texto: data.body ?? '',
      });
    }
    return { ok: true, messageId: msg.id };
  }

  /**
   * A equipe escreveu numa conversa ligada a um lead: é falar com o cliente, e
   * conta no prazo de primeiro contato — como a resposta pelo WhatsApp
   * (`WhatsappService.gravarSaida`). Sem isto, quem respondia pelo chat do
   * sistema aparecia com o prazo estourado e contava contra no relatório.
   *
   * A primeira mensagem da equipe na conversa vira a interação `chat` na linha
   * do tempo; as seguintes não, senão cada mensagem viraria uma linha.
   */
  private async respondeuOLead(
    tx: ScopedClient,
    conv: { id: string; leadId: string | null; customerUserId: string | null },
    mensagemId: string,
    autorId: string,
    agora: Date,
  ) {
    const lead = await tx.lead.findFirst({
      where: { id: conv.leadId! },
      select: { id: true, tenantId: true, firstRespondedAt: true },
    });
    if (!lead) return;

    // Da equipe = com autor e sem ser o cliente (o visitante escreve sem autor).
    const anteriores = await tx.message.count({
      where: {
        conversationId: conv.id,
        id: { not: mensagemId },
        AND: [
          { senderUserId: { not: null } },
          ...(conv.customerUserId ? [{ senderUserId: { not: conv.customerUserId } }] : []),
        ],
      },
    });
    if (anteriores === 0) {
      await tx.leadInteraction.create({
        data: {
          leadId: lead.id,
          tenantId: lead.tenantId,
          actorUserId: autorId,
          kind: 'chat',
          content: 'Conversa pelo chat do sistema',
          occurredAt: agora,
        },
      });
    }
    await this.sla.registrarPrimeiraResposta(tx, lead, 'chat', agora);
    await tx.lead.update({ where: { id: lead.id }, data: { lastActivityAt: agora } });
  }

  /** Cliente aceita ou recusa uma proposta enviada pela concessionária */
  @SubscribeMessage('proposal:respond')
  async onProposalRespond(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; accept: boolean },
  ) {
    if (!client.userId) return { ok: false };

    const msg = await this.noContexto(client, (tx) =>
      tx.message.findFirst({
        where: { id: data.messageId },
        include: { conversation: { select: { id: true, customerUserId: true } } },
      }),
    );
    if (!msg || msg.conversation.customerUserId !== client.userId) {
      return { ok: false, error: 'Sem acesso' };
    }

    const meta = (msg.metadata ?? {}) as Record<string, unknown>;
    const proposal = meta.proposal as Record<string, unknown> | undefined;
    if (!proposal) return { ok: false, error: 'Mensagem não é uma proposta' };
    if (proposal.status !== 'pending') return { ok: false, error: 'Proposta já respondida' };

    const updated = await this.noContexto(client, (tx) => tx.message.update({
      where: { id: msg.id },
      data: {
        metadata: {
          ...meta,
          proposal: {
            ...proposal,
            status: data.accept ? 'accepted' : 'declined',
            respondedAt: new Date().toISOString(),
          },
        } as never,
      },
      include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
    }));

    // Aceitar a proposta move o negócio adiante. Recusar não o cancela: o
    // vendedor costuma reenviar outra proposta na mesma conversa, e cancelar
    // aqui exigiria reabrir o negócio a cada rodada de negociação.
    const dealId = typeof proposal.dealId === 'string' ? proposal.dealId : null;
    if (data.accept && dealId && msg.tenantId) {
      await this.proposta.aceitar(msg.tenantId, dealId, client.userId!);
    }

    this.server
      .to(`conversation:${msg.conversation.id}`)
      .emit('conversation:message:update', updated);
    return { ok: true };
  }

  @SubscribeMessage('conversation:typing')
  onTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; isTyping: boolean },
  ) {
    if (!client.userId) return;
    client.to(`conversation:${data.conversationId}`).emit('conversation:typing', {
      userId: client.userId, isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('conversation:read')
  async onRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!client.userId) return;
    await this.noContexto(client, (tx) =>
      tx.message.updateMany({
        where: { conversationId: data.conversationId, senderUserId: { not: client.userId }, readAt: null },
        data:  { readAt: new Date() },
      }),
    );
    client.to(`conversation:${data.conversationId}`).emit('conversation:read', { userId: client.userId });
    return { ok: true };
  }
}
