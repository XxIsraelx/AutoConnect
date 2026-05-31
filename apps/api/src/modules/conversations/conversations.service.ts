import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista conversas de uma concessionária */
  async findAllByTenant(tenantId: string, opts: { status?: string; page?: number }): Promise<unknown> {
    const { status, page = 1 } = opts;
    const take = 20;
    const skip = (page - 1) * take;

    const where = {
      tenantId,
      ...(status ? { status: status as never } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        skip,
        take,
        orderBy: { lastMessageAt: 'desc' },
        include: {
          customer:    { select: { id: true, fullName: true, email: true, avatarUrl: true } },
          salesperson: { select: { id: true, fullName: true, email: true } },
          vehicle: {
            select: {
              id: true, versionName: true, yearModel: true,
              brand: { select: { name: true } },
              model: { select: { name: true } },
              images: { where: { isCover: true }, take: 1, select: { url: true } },
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, createdAt: true, kind: true },
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return { items, total, page, perPage: take };
  }

  /** Mensagens de uma conversa */
  async getMessages(tenantId: string | null, userId: string, conversationId: string): Promise<unknown> {
    const conv = await this.prisma.conversation.findFirst({
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

    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
    });
  }

  /** Cria ou retorna conversa existente entre customer e tenant (por veículo) */
  async getOrCreate(customerUserId: string, tenantId: string, vehicleId?: string, leadId?: string): Promise<unknown> {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        customerUserId,
        tenantId,
        ...(vehicleId ? { vehicleId } : {}),
        status: { not: 'closed' },
      },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: { customerUserId, tenantId, vehicleId: vehicleId ?? null, leadId: leadId ?? null },
    });
  }

  /** Lojista abre (ou retoma) conversa a partir de um lead */
  async getOrCreateFromLead(
    tenantId: string,
    salespersonId: string,
    leadId: string,
  ): Promise<unknown> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select: { id: true, customerUserId: true, vehicleId: true },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (!lead.customerUserId) {
      throw new BadRequestException(
        'Este lead não tem um cliente cadastrado — só é possível conversar pelo chat com clientes que possuem conta.',
      );
    }

    const existing = await this.prisma.conversation.findFirst({
      where: { customerUserId: lead.customerUserId, tenantId, status: { not: 'closed' } },
    });
    if (existing) {
      // garante que o vendedor fique atribuído
      if (!existing.salespersonId) {
        return this.prisma.conversation.update({
          where: { id: existing.id },
          data: { salespersonId },
        });
      }
      return existing;
    }

    return this.prisma.conversation.create({
      data: {
        customerUserId: lead.customerUserId,
        tenantId,
        vehicleId: lead.vehicleId ?? null,
        leadId: lead.id,
        salespersonId,
      },
    });
  }

  /** Fecha conversa */
  async close(tenantId: string, conversationId: string): Promise<unknown> {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    return this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'closed' } });
  }
}
