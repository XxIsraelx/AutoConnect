import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';

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
    private readonly email: EmailService,
  ) {}

  /** Lista agendamentos de uma concessionária */
  async findAll(tenantId: string, opts: {
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
      tenantId,
      ...(status ? { status: status as never } : {}),
      ...(salespersonId ? { salespersonId } : {}),
      ...(type ? { type: type as never } : {}),
      ...(q ? { customer: { fullName: { contains: q, mode: 'insensitive' as const } } } : {}),
      ...(from || to ? {
        scheduledStart: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to   ? { lte: new Date(to)   } : {}),
        },
      } : {}),
    };

    return this.prisma.withTenant(tenantId, async (tx) => {
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
    });
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
  async create(customerUserId: string, data: {
    tenantId:      string;
    vehicleId?:    string;
    branchId?:     string;
    leadId?:       string;
    type:          string;
    scheduledStart: string;
    notes?:        string;
  }): Promise<unknown> {
    const start = new Date(data.scheduledStart);
    const end   = new Date(start.getTime() + 60 * 60 * 1000); // +1h default

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
  async update(tenantId: string, id: string, data: {
    status?:        string;
    scheduledStart?: string;
    salespersonId?: string;
    notes?:         string;
  }): Promise<unknown> {
    const updated = await this.prisma.withTenant(tenantId, async (tx) => {
      const appt = await tx.appointment.findFirst({ where: { id, tenantId } });
      if (!appt) throw new NotFoundException('Agendamento não encontrado');

      return tx.appointment.update({
        where: { id },
        data: {
          ...(data.status ? { status: data.status as never } : {}),
          ...(data.scheduledStart ? {
            scheduledStart: new Date(data.scheduledStart),
            scheduledEnd:   new Date(new Date(data.scheduledStart).getTime() + 60 * 60 * 1000),
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

    if (status && updated.customer?.email) {
      this.email.sendAppointmentStatusUpdate({
        to: updated.customer.email,
        customerName: updated.customer.fullName,
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
    if (tenantId && updated.customer?.email) {
      this.email.sendAppointmentStatusUpdate({
        to: updated.customer.email,
        customerName: updated.customer.fullName,
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
