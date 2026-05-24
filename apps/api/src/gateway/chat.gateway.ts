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
import { Server, Socket } from 'socket.io';

/**
 * Gateway base do chat em tempo real.
 * Sprint 4 vai expandir: autenticação via JWT no handshake,
 * persistência via PrismaService.withTenant, presença, typing, etc.
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: process.env.WEB_URL ?? 'http://localhost:3000', credentials: true },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`socket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('conversation:join')
  onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    client.join(`conversation:${data.conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('conversation:send')
  onSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; body: string },
  ) {
    // TODO Sprint 4: persistir mensagem via prisma + emitir versão completa
    this.server.to(`conversation:${data.conversationId}`).emit('conversation:message', {
      tempId: Date.now(),
      body: data.body,
      senderSocketId: client.id,
      createdAt: new Date().toISOString(),
    });
    return { ok: true };
  }
}
