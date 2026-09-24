import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { LeadInteractionKind } from '@autoconnect/shared';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { EmailService } from '../../common/email/email.service';
import { executarEmUmaReplica } from './execucao-unica';

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
 *
 * Cada execução passa por `executarEmUmaReplica`: com mais de uma réplica, o
 * cron dispara em todas, mas só uma executa (advisory lock no Postgres). Os
 * corpos continuam idempotentes de propósito — ver o comentário do helper.
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  // dias sem interação para considerar um lead "frio", por status
  private readonly COLD_DAYS: Record<string, number> = { new: 3, contacted: 7 };

  constructor(
    /** Privilegiada: o cron percorre todas as concessionárias — não há um tenant a que se restringir. */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly email: EmailService,
  ) {}

  /* ── Lembretes de agendamento ─────────────────────────────── */

  @Cron(CronExpression.EVERY_HOUR, { name: 'appointment-reminders' })
  async sendAppointmentReminders(): Promise<boolean> {
    return executarEmUmaReplica(this.privilegiado, 'appointment-reminders', this.logger, () =>
      this.enviarLembretes(),
    );
  }

  private async enviarLembretes(): Promise<void> {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const appts = await this.privilegiado.appointment.findMany({
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
        // Agendamento feito pela loja para quem não tem conta não tem
        // `customer`: o contato vive no próprio agendamento. E pode não haver
        // e-mail nenhum — o vendedor anotou só o telefone. Nesse caso o
        // lembrete é pulado e `reminderSentAt` é marcado do mesmo jeito, que é
        // o que mantém o job idempotente: sem isso o agendamento sem e-mail
        // seria relido a cada hora, para sempre.
        const destinatario = appt.customer?.email ?? appt.contactEmail;
        if (destinatario) {
          await this.email.sendAppointmentReminder({
            to: destinatario,
            customerName: appt.customer?.fullName ?? appt.contactName ?? 'cliente',
            dealerName: appt.tenant.tradeName,
            typeLabel: TYPE_LABELS[appt.type] ?? 'Agendamento',
            vehicleInfo: vehicleInfo(appt.vehicle),
            when: appt.scheduledStart,
          });
        }
        await this.privilegiado.appointment.update({
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
  async reengageColdLeads(): Promise<boolean> {
    return executarEmUmaReplica(this.privilegiado, 'cold-leads', this.logger, () =>
      this.alertarLeadsFrios(),
    );
  }

  private async alertarLeadsFrios(): Promise<void> {
    const now = Date.now();
    let created = 0;

    for (const [status, days] of Object.entries(this.COLD_DAYS)) {
      const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);

      const leads = await this.privilegiado.lead.findMany({
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
        const recent = await this.privilegiado.notification.findFirst({
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
          await this.privilegiado.notification.create({
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

  /* ── Estouro do prazo de primeiro contato ─────────────────── */

  /**
   * A cada 5 minutos, porque o prazo padrão é de 15: varrer de hora em hora
   * faria o gerente saber do estouro quando ele já tem 45 minutos, e um alerta
   * atrasado não muda o desfecho do lead.
   */
  @Cron('*/5 * * * *', { name: 'sla-primeiro-contato' })
  async alertarSlaEstourado(): Promise<boolean> {
    return executarEmUmaReplica(this.privilegiado, 'sla-primeiro-contato', this.logger, () =>
      this.processarEstouros(),
    );
  }

  /**
   * Quem passou do prazo sem primeira resposta.
   *
   * **Idempotente por `slaBreachedAt`**: sem essa marca o gerente receberia o
   * mesmo alerta a cada 5 minutos, para sempre — e um alarme que repete é um
   * alarme que se aprende a ignorar. É o mesmo desenho do `reminderSentAt` dos
   * lembretes.
   *
   * Roda pela conexão privilegiada porque atravessa todas as concessionárias:
   * não há um tenant a que se restringir, e é isso que o nome `privilegiado`
   * torna visível na chamada.
   */
  private async processarEstouros(): Promise<void> {
    const agora = new Date();

    const estourados = await this.privilegiado.lead.findMany({
      where: {
        firstResponseDueAt: { lte: agora },
        firstRespondedAt: null,
        slaBreachedAt: null,
        status: { in: ['new', 'contacted'] },
      },
      select: {
        id: true, tenantId: true, assignedTo: true, contactName: true,
        firstResponseDueAt: true,
        assignee: { select: { fullName: true } },
      },
      // Teto por rodada: uma loja que acabou de ligar o prazo pode ter
      // centenas de leads vencendo ao mesmo tempo, e travar o cron por 20
      // minutos atrasaria a rodada seguinte. O que sobrar sai na próxima.
      take: 200,
    });

    if (estourados.length === 0) return;

    // Configuração da loja lida uma vez por loja, não por lead.
    const lojas = [...new Set(estourados.map((l) => l.tenantId))];
    const ajustes = new Map(
      (
        await this.privilegiado.tenantCrmSettings.findMany({
          where: { tenantId: { in: lojas } },
          select: { tenantId: true, slaDevolveParaFila: true },
        })
      ).map((a) => [a.tenantId, a.slaDevolveParaFila]),
    );

    const gerentes = await this.privilegiado.user.findMany({
      where: { tenantId: { in: lojas }, status: 'active', role: { in: ['manager', 'tenant_admin'] } },
      select: { id: true, tenantId: true },
    });

    for (const lead of estourados) {
      try {
        // Devolução à fila é **desligada por padrão**: tirar o lead de um
        // vendedor é decisão de gestão, não efeito colateral de um alarme.
        const devolve = (ajustes.get(lead.tenantId) ?? false) && lead.assignedTo != null;
        const quem = lead.contactName ?? 'Um lead';

        await this.privilegiado.lead.update({
          where: { id: lead.id },
          data: { slaBreachedAt: agora, ...(devolve ? { assignedTo: null } : {}) },
        });

        await this.privilegiado.leadInteraction.create({
          data: {
            leadId: lead.id,
            tenantId: lead.tenantId,
            actorUserId: null,
            kind: 'sla_breach' satisfies LeadInteractionKind,
            content: devolve
              ? 'Prazo de primeiro contato estourado — lead devolvido à fila'
              : 'Prazo de primeiro contato estourado',
            payload: {
              prazo: lead.firstResponseDueAt?.toISOString() ?? null,
              devolvidoAFila: devolve,
            },
          },
        });

        // O alerta vai ao gerente e ao administrador — não ao vendedor: quem
        // precisa agir sobre um prazo estourado é quem redistribui. O vendedor
        // já vê a etiqueta vermelha na própria lista.
        const destinatarios = gerentes.filter((g) => g.tenantId === lead.tenantId);
        for (const gerente of destinatarios) {
          await this.privilegiado.notification.create({
            data: {
              tenantId: lead.tenantId,
              userId: gerente.id,
              channel: 'in_app',
              status: 'sent',
              sentAt: agora,
              title: 'Prazo de primeiro contato estourado ⏰',
              body: `${quem} não recebeu contato dentro do prazo${
                lead.assignee ? ` (responsável: ${lead.assignee.fullName})` : ' e estava na fila'
              }.${devolve ? ' O lead voltou para a fila.' : ''}`,
              data: { kind: 'sla_breach', leadId: lead.id },
            },
          });
        }
      } catch (err) {
        this.logger.warn(`Falha ao processar estouro do lead ${lead.id}: ${err}`);
      }
    }

    this.logger.log(`Prazo de primeiro contato: ${estourados.length} estouro(s) processados`);
  }
}
