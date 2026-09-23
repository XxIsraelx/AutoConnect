import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { EmailService } from '../../common/email/email.service';
import {
  DURACAO_PADRAO_MINUTOS,
  type AgendamentoDaLojaInput,
  type AgendamentoDoClienteInput,
  type AtualizarAgendamentoInput,
} from '@autoconnect/shared';

const TYPE_LABELS: Record<string, string> = {
  test_drive: 'Test drive',
  evaluation: 'Avaliação',
  in_person:  'Visita',
  online:     'Atendimento online',
  delivery:   'Entrega',
  service:    'Serviço',
};

/** Colunas do agendamento que as telas da concessionária esperam. */
const INCLUDE_COMPLETO = {
  customer:    { select: { id: true, fullName: true, email: true, phone: true } },
  salesperson: { select: { id: true, fullName: true, email: true } },
  tenant:      { select: { tradeName: true } },
  vehicle: {
    select: {
      id: true, versionName: true, yearModel: true, price: true,
      brand: { select: { name: true } },
      model: { select: { name: true } },
      images: { where: { isCover: true }, take: 1, select: { url: true } },
    },
  },
  lead: { select: { id: true, status: true } },
};

function vehicleInfo(v: {
  versionName: string | null; yearModel: number;
  brand: { name: string }; model: { name: string };
} | null): string | null {
  if (!v) return null;
  return `${v.brand.name} ${v.model.name} ${v.versionName ?? ''} ${v.yearModel}`.replace(/\s+/g, ' ').trim();
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    /** Consolidado da plataforma para o super admin. */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly email: EmailService,
  ) {}

  /** Lista agendamentos de uma concessionária */
  async findAll(escopo: Escopo, opts: {
    status?: string;
    from?: string;
    to?: string;
    page?: number;
    salespersonId?: string;
    type?: string;
    q?: string;
    limit?: number;
  }): Promise<unknown> {
    const { status, from, to, page = 1, salespersonId, type, q, limit } = opts;
    const take = limit ?? 20;
    const skip = (page - 1) * take;

    // O `tenantId` no where fica junto do withTenant de propósito: é a primeira
    // linha de defesa e continua valendo enquanto o RLS não estiver sendo
    // aplicado (a aplicação ainda conecta como dona das tabelas).
    const where = {
      ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }),
      ...(status ? { status: status as never } : {}),
      ...(salespersonId ? { salespersonId } : {}),
      ...(type ? { type: type as never } : {}),
      // A busca tem que alcançar o contato avulso também: um agendamento feito
      // pela loja para quem não tem conta não tem `customer`, e antes ele
      // simplesmente sumia da busca por nome.
      ...(q ? {
        OR: [
          { customer: { fullName: { contains: q, mode: 'insensitive' as const } } },
          { contactName: { contains: q, mode: 'insensitive' as const } },
        ],
      } : {}),
      ...(from || to ? {
        scheduledStart: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to   ? { lte: new Date(to)   } : {}),
        },
      } : {}),
    };

    const consultar = async (tx: ScopedClient) => {
      const [items, total] = await Promise.all([
        tx.appointment.findMany({
          where,
          skip,
          take,
          orderBy: { scheduledStart: 'asc' },
          include: {
            customer:    INCLUDE_COMPLETO.customer,
            salesperson: INCLUDE_COMPLETO.salesperson,
            vehicle:     INCLUDE_COMPLETO.vehicle,
            lead:        INCLUDE_COMPLETO.lead,
          },
        }),
        tx.appointment.count({ where }),
      ]);

      return { items, total, page, perPage: take };
    };

    return ehGlobal(escopo)
      ? consultar(this.privilegiado)
      : this.prisma.withTenant(escopo.tenantId, consultar);
  }

  /** Lista agendamentos do cliente logado */
  async findByCustomer(userId: string): Promise<unknown> {
    // Atravessa concessionárias de propósito: o cliente agenda em várias lojas
    // e a área /perfil lista tudo junto. Quem isola aqui é `app.user_id`, pela
    // policy `acesso_cliente` de appointments.
    return this.prisma.withUser(userId, (tx) =>
      tx.appointment.findMany({
        where: { customerUserId: userId },
        orderBy: { scheduledStart: 'asc' },
        include: {
          salesperson: { select: { id: true, fullName: true } },
          vehicle:     INCLUDE_COMPLETO.vehicle,
          branch:      { select: { id: true, name: true, city: true, state: true, phone: true } },
        },
      }),
    );
  }

  /** Cliente solicita agendamento */
  async create(customerUserId: string, data: AgendamentoDoClienteInput): Promise<unknown> {
    const start = new Date(data.scheduledStart);
    const end   = new Date(start.getTime() + DURACAO_PADRAO_MINUTOS * 60 * 1000);

    // Quem cria é o cliente, não a concessionária: o contexto é o do usuário.
    const appt = await this.prisma.withUser(customerUserId, (tx) =>
      tx.appointment.create({
        data: {
          tenantId:       data.tenantId,
          customerUserId,
          vehicleId:      data.vehicleId ?? null,
          branchId:       data.branchId  ?? null,
          leadId:         data.leadId    ?? null,
          type:           data.type as never,
          status:         'scheduled',
          scheduledStart: start,
          scheduledEnd:   end,
          notes:          data.notes ?? null,
        },
        include: {
          vehicle:  { select: { versionName: true, yearModel: true, brand: { select: { name: true } }, model: { select: { name: true } } } },
          branch:   { select: { name: true, city: true } },
          customer: { select: { fullName: true } },
          tenant:   { select: { tradeName: true } },
        },
      }),
    );

    this.notifyDealerOfRequest(appt).catch(err =>
      this.logger.warn(`Falha ao notificar concessionária: ${err}`),
    );

    return appt;
  }

  /**
   * A loja marca um compromisso — inclusive para quem **não tem conta**.
   *
   * ## Por que não bastou exigir um lead
   *
   * A alternativa era tornar `leadId` obrigatório e guardar o contato só lá.
   * Foi descartada por duas razões:
   *
   *  1. nem todo agendamento é evento de funil. Entrega de carro vendido e
   *     revisão não são oportunidades novas, e criar lead para cada um sujaria
   *     o funil e a contagem do relatório;
   *  2. o contato precisa sobreviver ao lead. A deduplicação funde contatos
   *     repetidos num lead só, e o lead pode ser apagado pela tela; um
   *     agendamento que só soubesse o nome do cliente por join ficaria sem
   *     saber quem esperar.
   *
   * Por isso os três caminhos, com o contato **copiado** para o agendamento
   * quando vem de um lead. O Zod garante que um deles veio; a constraint
   * `appointments_tem_contato` garante o mesmo no banco, para o caso de algum
   * caminho futuro esquecer.
   */
  async criarPelaLoja(
    escopo: Escopo,
    criadorId: string,
    input: AgendamentoDaLojaInput,
  ): Promise<unknown> {
    if (ehGlobal(escopo)) {
      throw new ForbiddenException('Selecione uma concessionária para criar um agendamento.');
    }
    const tenantId = escopo.tenantId;

    const start = new Date(input.scheduledStart);
    const end = new Date(
      start.getTime() + (input.durationMinutes ?? DURACAO_PADRAO_MINUTOS) * 60 * 1000,
    );

    const appt = await this.prisma.withTenant(tenantId, async (tx) => {
      if (input.vehicleId) {
        const veiculo = await tx.vehicle.findFirst({
          where: { id: input.vehicleId, tenantId }, select: { id: true },
        });
        if (!veiculo) throw new NotFoundException('Veículo não encontrado');
      }

      if (input.branchId) {
        const filial = await tx.dealershipBranch.findFirst({
          where: { id: input.branchId, tenantId }, select: { id: true },
        });
        if (!filial) throw new NotFoundException('Filial não encontrada');
      }

      const salespersonId = input.salespersonId ?? criadorId;
      const vendedor = await tx.user.findFirst({
        where: { id: salespersonId, tenantId, status: 'active' }, select: { id: true },
      });
      if (!vendedor) throw new NotFoundException('Vendedor não encontrado');

      // Contato: o que o corpo trouxe, completado pelo lead quando há um.
      let contactName = input.contactName?.trim() || null;
      let contactPhone = input.contactPhone?.trim() || null;
      let contactEmail = input.contactEmail?.trim() || null;

      if (input.leadId) {
        const lead = await tx.lead.findFirst({
          where: { id: input.leadId, tenantId },
          select: { id: true, contactName: true, contactPhone: true, contactEmail: true, customerUserId: true },
        });
        if (!lead) throw new NotFoundException('Lead não encontrado');

        contactName ??= lead.contactName;
        contactPhone ??= lead.contactPhone;
        contactEmail ??= lead.contactEmail;
      }

      if (input.customerUserId) {
        // A policy `cliente_relacionado` já limita quem a loja enxerga: só
        // clientes com lead, agendamento ou conversa com ela. Um id de cliente
        // de outra loja simplesmente não aparece aqui.
        const cliente = await tx.user.findFirst({
          where: { id: input.customerUserId, role: 'customer' },
          select: { id: true, fullName: true, phone: true, email: true },
        });
        if (!cliente) throw new NotFoundException('Cliente não encontrado');

        contactName ??= cliente.fullName;
        contactPhone ??= cliente.phone;
        contactEmail ??= cliente.email;
      }

      // O Zod já cobre o corpo; isto pega o caso em que o lead escolhido não
      // tem contato nenhum — aí o agendamento nasceria sem saber quem esperar.
      if (!input.customerUserId && !contactName) {
        throw new BadRequestException(
          'O lead escolhido não tem nome de contato. Informe nome e telefone.',
        );
      }

      return tx.appointment.create({
        data: {
          tenantId,
          customerUserId: input.customerUserId ?? null,
          leadId: input.leadId ?? null,
          contactName,
          contactPhone,
          contactEmail,
          salespersonId,
          vehicleId: input.vehicleId ?? null,
          branchId: input.branchId ?? null,
          type: input.type,
          status: 'scheduled',
          scheduledStart: start,
          scheduledEnd: end,
          notes: input.notes ?? null,
        },
        include: INCLUDE_COMPLETO,
      });
    });

    // A timeline do lead tem que mostrar o agendamento no momento em que ele é
    // marcado — é o evento mais importante do atendimento.
    if (input.leadId) {
      await this.prisma
        .withTenant(tenantId, (tx) =>
          tx.leadInteraction.create({
            data: {
              leadId: input.leadId!,
              tenantId,
              actorUserId: criadorId,
              kind: 'visit',
              content: `Agendamento marcado para ${start.toLocaleString('pt-BR')}`,
              payload: { appointmentId: appt.id, type: input.type } as never,
            },
          }),
        )
        .catch((err) => this.logger.warn(`Falha ao registrar na timeline do lead: ${err}`));
    }

    return appt;
  }

  /** Email para os admins do tenant quando um cliente solicita agendamento */
  private async notifyDealerOfRequest(appt: {
    tenantId: string;
    type: string;
    scheduledStart: Date;
    customer: { fullName: string } | null;
    tenant: { tradeName: string };
    vehicle: { versionName: string | null; yearModel: number; brand: { name: string }; model: { name: string } } | null;
  }): Promise<void> {
    const admins = await this.prisma.withTenant(appt.tenantId, (tx) =>
      tx.user.findMany({
        where: { tenantId: appt.tenantId, role: { in: ['tenant_admin', 'manager'] }, status: 'active' },
        select: { email: true },
      }),
    );

    await Promise.all(admins.map(a =>
      this.email.sendAppointmentRequested({
        to: a.email,
        dealerName: appt.tenant.tradeName,
        customerName: appt.customer?.fullName ?? 'Cliente',
        typeLabel: TYPE_LABELS[appt.type] ?? 'Agendamento',
        vehicleInfo: vehicleInfo(appt.vehicle),
        when: appt.scheduledStart,
      }),
    ));
  }

  /** Dealer responde ao agendamento (confirma, cancela, reagenda) */
  async update(tenantId: string, id: string, data: AtualizarAgendamentoInput): Promise<unknown> {
    const updated = await this.prisma.withTenant(tenantId, async (tx) => {
      const appt = await tx.appointment.findFirst({ where: { id, tenantId } });
      if (!appt) throw new NotFoundException('Agendamento não encontrado');

      return tx.appointment.update({
        where: { id },
        data: {
          ...(data.status ? { status: data.status as never } : {}),
          ...(data.scheduledStart ? {
            scheduledStart: new Date(data.scheduledStart),
            scheduledEnd:   new Date(
              new Date(data.scheduledStart).getTime() + DURACAO_PADRAO_MINUTOS * 60 * 1000,
            ),
          } : {}),
          ...(data.salespersonId !== undefined ? { salespersonId: data.salespersonId } : {}),
          ...(data.notes         !== undefined ? { notes:         data.notes         } : {}),
        },
        include: INCLUDE_COMPLETO,
      });
    });

    // Notifica o cliente sobre confirmação, cancelamento ou reagendamento
    const rescheduled = !!data.scheduledStart && !data.status;
    const status =
      data.status === 'confirmed' ? 'confirmed' as const :
      data.status === 'canceled'  ? 'canceled'  as const :
      rescheduled                 ? 'rescheduled' as const : null;

    // Contato avulso não tem `customer`: o e-mail vive no próprio agendamento.
    // Sem este fallback, quem a loja agendou pelo balcão nunca era avisado.
    const paraOCliente = updated.customer?.email ?? updated.contactEmail;
    if (status && paraOCliente) {
      this.email.sendAppointmentStatusUpdate({
        to: paraOCliente,
        customerName: updated.customer?.fullName ?? updated.contactName ?? 'cliente',
        dealerName: updated.tenant.tradeName,
        status,
        typeLabel: TYPE_LABELS[updated.type] ?? 'Agendamento',
        vehicleInfo: vehicleInfo(updated.vehicle),
        when: updated.scheduledStart,
      }).catch(err => this.logger.warn(`Falha ao notificar cliente: ${err}`));
    }

    return updated;
  }

  /** Cliente ou dealer cancela agendamento */
  async cancel(tenantId: string | null, customerUserId: string | null, id: string): Promise<unknown> {
    // A mesma ação com dois donos possíveis, cada um com seu contexto: a
    // concessionária cancela o que é dela, o cliente cancela o que é dele.
    const cancelar = async (tx: ScopedClient) => {
      const where = tenantId ? { id, tenantId } : { id, customerUserId: customerUserId! };

      const appt = await tx.appointment.findFirst({ where });
      if (!appt) throw new NotFoundException('Agendamento não encontrado');

      return tx.appointment.update({
        where: { id },
        data: { status: 'canceled' },
        include: INCLUDE_COMPLETO,
      });
    };

    const updated = tenantId
      ? await this.prisma.withTenant(tenantId, cancelar)
      : await this.prisma.withUser(customerUserId!, cancelar);

    // Se foi a concessionária que cancelou, avisa o cliente
    const paraOCliente = updated.customer?.email ?? updated.contactEmail;
    if (tenantId && paraOCliente) {
      this.email.sendAppointmentStatusUpdate({
        to: paraOCliente,
        customerName: updated.customer?.fullName ?? updated.contactName ?? 'cliente',
        dealerName: updated.tenant.tradeName,
        status: 'canceled',
        typeLabel: TYPE_LABELS[updated.type] ?? 'Agendamento',
        vehicleInfo: vehicleInfo(updated.vehicle),
        when: updated.scheduledStart,
      }).catch(err => this.logger.warn(`Falha ao notificar cliente: ${err}`));
    }

    return updated;
  }
}
