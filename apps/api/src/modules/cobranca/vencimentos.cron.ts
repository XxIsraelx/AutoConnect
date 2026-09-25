import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { avaliarCobranca, DIAS_DE_AVISO_ANTES, somarDias } from '@autoconnect/shared';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { EmailService } from '../../common/email/email.service';
import { executarEmUmaReplica } from '../tasks/execucao-unica';
import { EstadoDaLojaService } from './estado-da-loja.service';

/**
 * O marco em que a situação atual começou.
 *
 * É o que torna o aviso idempotente **sem coluna nova por tipo de aviso**:
 * manda quando `lastNoticeAt` é anterior ao marco, e grava `lastNoticeAt`
 * depois. Cada marco gera exatamente um e-mail, e a loja em somente leitura
 * não recebe o mesmo aviso todo dia — que é o jeito mais rápido de um aviso
 * virar spam e deixar de ser lido.
 */
function marcoDaSituacao(
  situacao: string,
  trialEndsAt: Date | null,
  graceUntil: Date | null,
  prazoAte: Date | null,
): Date | null {
  switch (situacao) {
    case 'trial_terminando':
      return trialEndsAt ? somarDias(trialEndsAt, -DIAS_DE_AVISO_ANTES) : null;
    case 'em_carencia':
      // O vencimento da fatura: o começo da carência.
      return graceUntil ? somarDias(graceUntil, -7) : null;
    case 'somente_leitura':
      return prazoAte ?? trialEndsAt;
    default:
      return null;
  }
}

/**
 * Varredura diária de vencimentos.
 *
 * O bloqueio em si **não depende deste cron**: quem decide é
 * `avaliarCobranca`, no guard, a cada escrita — uma loja cujo trial venceu às
 * 3h da manhã já está em somente leitura às 3h01, tenha o cron rodado ou não.
 * O que este job faz é o que só ele pode fazer: **avisar**. Um bloqueio que
 * chega sem aviso é um bloqueio que vira chamado.
 *
 * Roda sob `executarEmUmaReplica` como os demais, e é idempotente por
 * `lastNoticeAt` comparado ao marco da situação — o mesmo desenho do
 * `reminderSentAt` dos lembretes e do `slaBreachedAt` do prazo de contato.
 */
@Injectable()
export class VencimentosCron {
  private readonly logger = new Logger(VencimentosCron.name);

  constructor(
    /** Privilegiada: a varredura percorre todas as concessionárias. */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly email: EmailService,
    private readonly estadoDaLoja: EstadoDaLojaService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM, { name: 'vencimentos-de-assinatura' })
  async varrer(): Promise<boolean> {
    return executarEmUmaReplica(this.privilegiado, 'vencimentos-de-assinatura', this.logger, () =>
      this.processar(),
    );
  }

  async processar(agora: Date = new Date()): Promise<void> {
    const assinaturas = await this.privilegiado.tenantSubscription.findMany({
      where: {
        // Só quem tem algum prazo: assinatura paga e em dia não tem o que avisar.
        OR: [
          { trialEndsAt: { lte: somarDias(agora, DIAS_DE_AVISO_ANTES) } },
          { graceUntil: { not: null } },
        ],
        tenant: { isActive: true },
      },
      select: {
        id: true, tenantId: true, plan: true, status: true,
        trialEndsAt: true, currentPeriodEnd: true, graceUntil: true, lastNoticeAt: true,
        tenant: { select: { tradeName: true, primaryEmail: true } },
      },
      // Teto por rodada, como no cron de SLA: o que sobrar sai amanhã.
      take: 500,
    });

    let enviados = 0;

    for (const a of assinaturas) {
      try {
        const veredito = avaliarCobranca(a, agora);
        const marco = marcoDaSituacao(veredito.situacao, a.trialEndsAt, a.graceUntil, veredito.prazoAte);

        if (!marco || marco.getTime() > agora.getTime()) continue;
        if (a.lastNoticeAt && a.lastNoticeAt.getTime() >= marco.getTime()) continue;

        const urgente = veredito.situacao === 'somente_leitura';
        const titulo = urgente
          ? 'Sua loja está em modo somente leitura'
          : veredito.situacao === 'em_carencia'
            ? 'Sua fatura do AutoConnect está vencida'
            : 'Seu período de teste está acabando';

        // Sem e-mail não há como avisar — mas `lastNoticeAt` é gravado do mesmo
        // jeito, que é o que mantém o job idempotente. Sem isso, a loja sem
        // e-mail seria relida e reprocessada todo dia, para sempre. É a mesma
        // regra do `reminderSentAt` do lembrete de agendamento.
        if (a.tenant.primaryEmail) {
          await this.email.sendAvisoDeAssinatura({
            to: a.tenant.primaryEmail,
            dealerName: a.tenant.tradeName,
            titulo,
            corpo: veredito.aviso ?? titulo,
            urgente,
          });
          enviados++;
        }

        await this.privilegiado.tenantSubscription.update({
          where: { id: a.id },
          data: { lastNoticeAt: agora },
        });

        // O veredito mudou de marco: o cache do guard pode estar com o estado
        // anterior, e meia hora de "tudo certo" depois do bloqueio é meia hora
        // de dado gravado que a loja acha que pagou para gravar.
        this.estadoDaLoja.invalidar(a.tenantId);
      } catch (err) {
        this.logger.warn(`Falha no aviso de assinatura da loja ${a.tenantId}: ${err}`);
      }
    }

    if (enviados > 0) this.logger.log(`Vencimentos: ${enviados} aviso(s) de assinatura enviados`);
  }
}
