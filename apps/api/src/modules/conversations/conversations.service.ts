import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';

/** Últimas mensagens e dados do veículo, iguais nas duas listagens. */
const RESUMO = {
  vehicle: {
    select: {
      id: true, versionName: true, yearModel: true,
      brand: { select: { name: true } },
      model: { select: { name: true } },
      images: { where: { isCover: true }, take: 1, select: { url: true } },
    },
  },
  messages: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { body: true, createdAt: true, kind: true },
  },
};

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    /** Consolidado da plataforma para o super admin. */
    private readonly privilegiado: PrivilegedPrismaService,
  ) {}

  /** Lista conversas de uma concessionária */
  async findAllByTenant(escopo: Escopo, opts: { status?: string; page?: number }): Promise<unknown> {
    const { status, page = 1 } = opts;
    const take = 20;
    const skip = (page - 1) * take;

    const where = {
      ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }),
      ...(status ? { status: status as never } : {}),
    };

    const consultar = async (tx: ScopedClient) => {
      const [items, total] = await Promise.all([
        tx.conversation.findMany({
          where,
          skip,
          take,
          orderBy: { lastMessageAt: 'desc' },
          include: {
            customer:    { select: { id: true, fullName: true, email: true, avatarUrl: true } },
            salesperson: { select: { id: true, fullName: true, email: true } },
            vehicle:     RESUMO.vehicle,
            messages:    RESUMO.messages,
          },
        }),
        tx.conversation.count({ where }),
      ]);

      return { items, total, page, perPage: take };
    };

    return ehGlobal(escopo)
      ? consultar(this.privilegiado)
      : this.prisma.withTenant(escopo.tenantId, consultar);
  }

  /** Lista conversas de um cliente (todas as lojas) */
  async findAllByCustomer(customerUserId: string, opts: { status?: string; page?: number }): Promise<unknown> {
    const { status, page = 1 } = opts;
    const take = 20;
    const skip = (page - 1) * take;

    const where = {
      customerUserId,
      ...(status ? { status: status as never } : {}),
    };

    // Atravessa concessionárias de propósito — o cliente conversa com várias
    // lojas. Quem isola é `app.user_id`, pela policy `acesso_cliente`.
    return this.prisma.withUser(customerUserId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.conversation.findMany({
          where, skip, take,
          orderBy: { lastMessageAt: 'desc' },
          include: {
            tenant:      { select: { id: true, tradeName: true, logoUrl: true } },
            salesperson: { select: { id: true, fullName: true } },
            vehicle:     RESUMO.vehicle,
            messages:    RESUMO.messages,
          },
        }),
        tx.conversation.count({ where }),
      ]);

      return { items, total, page, perPage: take };
    });
  }

  /** Mensagens de uma conversa */
  async getMessages(tenantId: string | null, userId: string, conversationId: string): Promise<unknown> {
    const buscar = async (tx: Parameters<Parameters<PrismaService['withUser']>[1]>[0]) => {
      const conv = await tx.conversation.findFirst({
        where: {
          id: conversationId,
          OR: [
            ...(tenantId ? [{ tenantId }] : []),
            { customerUserId: userId },
            { salespersonId:  userId },
          ],
        },
      });
      if (!conv) throw new NotFoundException('Conversa não encontrada');

      return tx.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
      });
    };

    // O cliente não tem tenant; o vendedor tem. Cada um entra pelo seu contexto.
    return tenantId
      ? this.prisma.withTenant(tenantId, buscar)
      : this.prisma.withUser(userId, buscar);
  }

  /** Cria ou retorna conversa existente entre customer e tenant (por veículo) */
  async getOrCreate(customerUserId: string, tenantId: string, vehicleId?: string, leadId?: string): Promise<unknown> {
    // Quem inicia é o cliente, então o contexto é o dele.
    return this.prisma.withUser(customerUserId, async (tx) => {
      const existing = await tx.conversation.findFirst({
        where: {
          customerUserId,
          tenantId,
          ...(vehicleId ? { vehicleId } : {}),
          status: { not: 'closed' },
        },
      });
      if (existing) return existing;

      return tx.conversation.create({
        data: { customerUserId, tenantId, vehicleId: vehicleId ?? null, leadId: leadId ?? null },
      });
    });
  }

  /** Lojista abre (ou retoma) conversa a partir de um lead */
  async getOrCreateFromLead(
    tenantId: string,
    salespersonId: string,
    leadId: string,
  ): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id: leadId, tenantId },
        select: { id: true, customerUserId: true, vehicleId: true },
      });
      if (!lead) throw new NotFoundException('Lead não encontrado');
      if (!lead.customerUserId) {
        throw new BadRequestException(
          'Este lead não tem um cliente cadastrado — só é possível conversar pelo chat com clientes que possuem conta.',
        );
      }

      const existing = await tx.conversation.findFirst({
        where: { customerUserId: lead.customerUserId, tenantId, status: { not: 'closed' } },
      });
      if (existing) {
        // garante que o vendedor fique atribuído
        if (!existing.salespersonId) {
          return tx.conversation.update({
            where: { id: existing.id },
            data: { salespersonId },
          });
        }
        return existing;
      }

      return tx.conversation.create({
        data: {
          customerUserId: lead.customerUserId,
          tenantId,
          vehicleId: lead.vehicleId ?? null,
          leadId: lead.id,
          salespersonId,
        },
      });
    });
  }

  /** Fecha conversa */
  async close(tenantId: string, conversationId: string): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const conv = await tx.conversation.findFirst({ where: { id: conversationId, tenantId } });
      if (!conv) throw new NotFoundException('Conversa não encontrada');
      return tx.conversation.update({ where: { id: conversationId }, data: { status: 'closed' } });
    });
  }
}
