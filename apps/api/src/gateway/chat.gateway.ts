import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../common/prisma/prisma.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  tenantId?: string | null;
  role?: string;
}

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: process.env.WEB_URL ?? 'http://localhost:3000', credentials: true },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

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

      this.logger.log(`socket connected: ${client.id} (user: ${payload.sub})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('conversation:join')
  async onJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!client.userId) return { ok: false };

    const conv = await this.prisma.conversation.findFirst({
      where: {
        id: data.conversationId,
        OR: [
          { customerUserId: client.userId },
          { salespersonId:  client.userId },
          ...(client.tenantId ? [{ tenantId: client.tenantId }] : []),
        ],
      },
    });
    if (!conv) return { ok: false, error: 'Sem acesso' };

    client.join(`conversation:${data.conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('conversation:send')
  async onSend(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; body: string; kind?: string },
  ) {
    if (!client.userId) return { ok: false };

    const conv = await this.prisma.conversation.findFirst({
      where: {
        id: data.conversationId,
        OR: [
          { customerUserId: client.userId },
          { salespersonId:  client.userId },
          ...(client.tenantId ? [{ tenantId: client.tenantId }] : []),
        ],
      },
    });
    if (!conv) return { ok: false, error: 'Sem acesso' };

    const msg = await this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        tenantId:       conv.tenantId,
        senderUserId:   client.userId,
        body:           data.body,
        kind:           (data.kind ?? 'text') as never,
      },
      include: {
        sender: { select: { id: true, fullName: true, avatarUrl: true } },
      },
    });

    await this.prisma.conversation.update({
      where: { id: data.conversationId },
      data:  { lastMessageAt: new Date() },
    });

    this.server.to(`conversation:${data.conversationId}`).emit('conversation:message', msg);
    return { ok: true, messageId: msg.id };
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
    await this.prisma.message.updateMany({
      where: { conversationId: data.conversationId, senderUserId: { not: client.userId }, readAt: null },
      data:  { readAt: new Date() },
    });
    client.to(`conversation:${data.conversationId}`).emit('conversation:read', { userId: client.userId });
    return { ok: true };
  }
}
