import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista agendamentos de uma concessionária */
  async findAll(tenantId: string, opts: {
    status?: string;
    from?: string;
    to?: string;
    page?: number;
  }): Promise<unknown> {
    const { status, from, to, page = 1 } = opts;
    const take = 20;
    const skip = (page - 1) * take;

    const where = {
      tenantId,
      ...(status ? { status: status as never } : {}),
      ...(from || to ? {
        scheduledStart: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to   ? { lte: new Date(to)   } : {}),
        },
      } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        skip,
        take,
        orderBy: { scheduledStart: 'asc' },
        include: {
          customer:    { select: { id: true, fullName: true, email: true, phone: true } },
          salesperson: { select: { id: true, fullName: true, email: true } },
          vehicle:     {
            select: {
              id: true, versionName: true, yearModel: true, price: true,
              brand: { select: { name: true } },
              model: { select: { name: true } },
              images: { where: { isCover: true }, take: 1, select: { url: true } },
            },
          },
          lead: { select: { id: true, status: true } },
        },
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return { items, total, page, perPage: take };
  }

  /** Lista agendamentos do cliente logado */
  async findByCustomer(userId: string): Promise<unknown> {
    return this.prisma.appointment.findMany({
      where: { customerUserId: userId },
      orderBy: { scheduledStart: 'asc' },
      include: {
        salesperson: { select: { id: true, fullName: true } },
        vehicle: {
          select: {
            id: true, versionName: true, yearModel: true, price: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
            images: { where: { isCover: true }, take: 1, select: { url: true } },
          },
        },
        branch: { select: { id: true, name: true, city: true, state: true, phone: true } },
      },
    });
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

    return this.prisma.appointment.create({
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
        vehicle: { select: { versionName: true, yearModel: true, brand: { select: { name: true } }, model: { select: { name: true } } } },
        branch:  { select: { name: true, city: true } },
      },
    });
  }

  /** Dealer responde ao agendamento (confirma, cancela, reagenda) */
  async update(tenantId: string, id: string, data: {
    status?:        string;
    scheduledStart?: string;
    salespersonId?: string;
    notes?:         string;
  }): Promise<unknown> {
    const appt = await this.prisma.appointment.findFirst({ where: { id, tenantId } });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');

    return this.prisma.appointment.update({
      where: { id },
      data: {
        ...(data.status        ? { status:        data.status as never             } : {}),
        ...(data.scheduledStart ? {
          scheduledStart: new Date(data.scheduledStart),
          scheduledEnd:   new Date(new Date(data.scheduledStart).getTime() + 60 * 60 * 1000),
        } : {}),
        ...(data.salespersonId !== undefined ? { salespersonId: data.salespersonId } : {}),
        ...(data.notes         !== undefined ? { notes:         data.notes         } : {}),
      },
      include: {
        customer:    { select: { id: true, fullName: true, email: true } },
        salesperson: { select: { id: true, fullName: true } },
      },
    });
  }

  /** Cliente ou dealer cancela agendamento */
  async cancel(tenantId: string | null, customerUserId: string | null, id: string): Promise<unknown> {
    const where = tenantId
      ? { id, tenantId }
      : { id, customerUserId: customerUserId! };

    const appt = await this.prisma.appointment.findFirst({ where });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');

    return this.prisma.appointment.update({
      where: { id },
      data: { status: 'canceled' },
    });
  }
}
