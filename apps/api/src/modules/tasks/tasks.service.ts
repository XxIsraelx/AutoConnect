import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';

const TYPE_LABELS: Record<string, string> = {
  test_drive: 'Test drive',
  evaluation: 'Avaliação',
  in_person:  'Visita',
  online:     'Atendimento online',
  delivery:   'Entrega',
  service:    'Serviço',
};

function vehicleInfo(v: {
  versionName: string | null; yearModel: number;
  brand: { name: string }; model: { name: string };
} | null): string | null {
  if (!v) return null;
  return `${v.brand.name} ${v.model.name} ${v.versionName ?? ''} ${v.yearModel}`.replace(/\s+/g, ' ').trim();
}

/**
 * Jobs em segundo plano (cron in-process via @nestjs/schedule):
 *  - Lembrete de agendamento ~24h antes
 *  - Re-engajamento de leads frios (alerta in-app ao vendedor)
 *
 * Rodam globais (todas as concessionárias) — sem contexto de tenant.
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  // dias sem interação para considerar um lead "frio", por status
  private readonly COLD_DAYS: Record<string, number> = { new: 3, contacted: 7 };

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /* ── Lembretes de agendamento ─────────────────────────────── */

  @Cron(CronExpression.EVERY_HOUR, { name: 'appointment-reminders' })
  async sendAppointmentReminders(): Promise<void> {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const appts = await this.prisma.appointment.findMany({
      where: {
        status: { in: ['scheduled', 'confirmed'] },
        reminderSentAt: null,
        scheduledStart: { gt: now, lte: in24h },
      },
      include: {
        customer: { select: { email: true, fullName: true } },
        tenant:   { select: { tradeName: true } },
        vehicle:  {
          select: {
            versionName: true, yearModel: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
          },
        },
      },
    });

    if (appts.length === 0) return;
    this.logger.log(`Enviando ${appts.length} lembrete(s) de agendamento`);

    for (const appt of appts) {
      try {
        if (appt.customer?.email) {
          await this.email.sendAppointmentReminder({
            to: appt.customer.email,
            customerName: appt.customer.fullName ?? 'cliente',
            dealerName: appt.tenant.tradeName,
            typeLabel: TYPE_LABELS[appt.type] ?? 'Agendamento',
            vehicleInfo: vehicleInfo(appt.vehicle),
            when: appt.scheduledStart,
          });
        }
        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: { reminderSentAt: new Date() },
        });
      } catch (err) {
        this.logger.warn(`Falha no lembrete do agendamento ${appt.id}: ${err}`);
      }
    }
  }

  /* ── Re-engajamento de leads frios ────────────────────────── */

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { name: 'cold-leads' })
  async reengageColdLeads(): Promise<void> {
    const now = Date.now();
    let created = 0;

    for (const [status, days] of Object.entries(this.COLD_DAYS)) {
      const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);

      const leads = await this.prisma.lead.findMany({
        where: {
          status: status as never,
          assignedTo: { not: null },
          lastActivityAt: { lt: cutoff },
        },
        select: {
          id: true, tenantId: true, assignedTo: true, contactName: true,
          lastActivityAt: true,
          vehicle: { select: { brand: { select: { name: true } }, model: { select: { name: true } } } },
        },
      });

      for (const lead of leads) {
        // Evita repetir o alerta do mesmo lead nos últimos 6 dias
        const recent = await this.prisma.notification.findFirst({
          where: {
            userId: lead.assignedTo!,
            data: { path: ['leadId'], equals: lead.id },
            createdAt: { gt: new Date(now - 6 * 24 * 60 * 60 * 1000) },
          },
          select: { id: true },
        });
        if (recent) continue;

        const daysCold = Math.floor((now - new Date(lead.lastActivityAt).getTime()) / (24 * 60 * 60 * 1000));
        const who = lead.contactName ?? 'Um lead';
        const veh = lead.vehicle ? ` (${lead.vehicle.brand.name} ${lead.vehicle.model.name})` : '';

        try {
          await this.prisma.notification.create({
            data: {
              tenantId: lead.tenantId,
              userId: lead.assignedTo!,
              channel: 'in_app',
              status: 'sent',
              sentAt: new Date(),
              title: 'Lead esfriando 🧊',
              body: `${who}${veh} está sem contato há ${daysCold} dia${daysCold !== 1 ? 's' : ''}. Que tal retomar?`,
              data: { kind: 'cold_lead', leadId: lead.id, daysCold },
            },
          });
          created++;
        } catch (err) {
          this.logger.warn(`Falha ao criar notificação do lead ${lead.id}: ${err}`);
        }
      }
    }

    if (created > 0) this.logger.log(`Re-engajamento: ${created} alerta(s) de lead frio criados`);
  }
}
