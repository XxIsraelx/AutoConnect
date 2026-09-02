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
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../common/prisma/prisma.service';

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


  /**
   * A proposta do chat vira um `Deal` em `proposal`.
   *
   * Antes disto a proposta morria como JSON dentro da mensagem: o vendedor
   * combinava preço, entrada e parcelas no chat e nada disso chegava ao funil,
   * à margem ou ao contrato. Agora o card do chat é a ponta visível de um
   * negócio de verdade.
   *
   * Nunca derruba o envio da mensagem: se o negócio não puder ser aberto — a
   * conversa não tem veículo, ou o carro já tem outro negócio vivo — a
   * proposta é enviada mesmo assim, apenas sem vínculo. Bloquear o chat por
   * causa disso seria pior do que a falta do vínculo.
   */
  private async negocioDaProposta(
    tenantId: string,
    vendedorId: string,
    conv: { id: string; vehicleId: string | null; customerUserId: string | null },
    proposta: Record<string, unknown>,
  ): Promise<string | null> {
    if (!conv.vehicleId) return null;

    const preco = Number(proposta.price);
    if (!Number.isFinite(preco) || preco <= 0) return null;

    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const vivo = await tx.deal.findFirst({
          where: { vehicleId: conv.vehicleId!, status: { notIn: ['canceled', 'rescinded'] } },
          select: { id: true },
        });
        // Já existe negócio para este carro: a proposta se pendura nele em vez
        // de tentar abrir um segundo, que o banco recusaria.
        if (vivo) return vivo.id;

        const veiculo = await tx.vehicle.findFirst({
          where: { id: conv.vehicleId!, tenantId },
          select: { price: true },
        });
        if (!veiculo) return null;

        const venda = new Prisma.Decimal(preco.toFixed(2));
        const tabela = veiculo.price.greaterThan(venda) ? veiculo.price : venda;

        const negocio = await tx.deal.create({
          data: {
            tenantId,
            vehicleId: conv.vehicleId!,
            customerUserId: conv.customerUserId,
            salespersonId: vendedorId,
            status: 'proposal',
            listPrice: tabela,
            discount: tabela.minus(venda),
            saleValue: venda,
          },
          select: { id: true },
        });

        await tx.vehicle.update({
          where: { id: conv.vehicleId! },
          data: { status: 'reserved' },
        });

        // A composição vem pronta da proposta: entrada e o financiado.
        const entrada = new Prisma.Decimal(Number(proposta.downPayment || 0).toFixed(2));
        if (entrada.greaterThan(0)) {
          await tx.dealPayment.create({
            data: { tenantId, dealId: negocio.id, kind: 'down_payment', value: entrada },
          });
        }
        const financiado = venda.minus(entrada);
        if (financiado.greaterThan(0)) {
          await tx.dealPayment.create({
            data: {
              tenantId,
              dealId: negocio.id,
              kind: 'financing',
              value: financiado,
              installments: Number(proposta.installments) || null,
              installmentValue: proposta.installmentValue
                ? new Prisma.Decimal(Number(proposta.installmentValue).toFixed(2))
                : null,
            },
          });
        }

        await tx.dealStatusEvent.create({
          data: {
            tenantId,
            dealId: negocio.id,
            fromStatus: 'draft',
            toStatus: 'proposal',
            actorUserId: vendedorId,
            reason: 'Proposta enviada pelo chat',
          },
        });

        return negocio.id;
      });
    } catch (e) {
      // Vínculo é acessório; a mensagem não pode falhar por causa dele.
      this.logger.warn(`Proposta sem negócio vinculado: ${(e as Error).message}`);
      return null;
    }
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

    // Propostas só podem ser enviadas pela equipe da concessionária
    if (data.metadata?.proposal && client.role === 'customer') {
      return { ok: false, error: 'Apenas a concessionária envia propostas' };
    }

    // Proposta enviada pela loja abre o negócio antes de gravar a mensagem,
    // para que o id entre no metadata e o card fique ligado ao funil.
    let metadata = data.metadata;
    if (data.metadata?.proposal && client.tenantId && client.userId) {
      const dealId = await this.negocioDaProposta(
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

    const msg = await this.noContexto(client, (tx) => tx.message.create({
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
    }));

    await this.noContexto(client, (tx) =>
      tx.conversation.update({
        where: { id: data.conversationId },
        data:  { lastMessageAt: new Date() },
      }),
    );

    this.server.to(`conversation:${data.conversationId}`).emit('conversation:message', msg);
    return { ok: true, messageId: msg.id };
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
      try {
        await this.prisma.withTenant(msg.tenantId, async (tx) => {
          const negocio = await tx.deal.findFirst({ where: { id: dealId }, select: { status: true } });
          if (negocio?.status !== 'proposal') return;
          await tx.deal.update({ where: { id: dealId }, data: { status: 'negotiating' } });
          await tx.dealStatusEvent.create({
            data: {
              tenantId: msg.tenantId,
              dealId,
              fromStatus: 'proposal',
              toStatus: 'negotiating',
              actorUserId: client.userId!,
              reason: 'Cliente aceitou a proposta no chat',
            },
          });
        });
      } catch (e) {
        this.logger.warn(`Aceite sem avanço do negócio: ${(e as Error).message}`);
      }
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
