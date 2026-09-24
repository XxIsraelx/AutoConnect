import { Injectable, Logger } from '@nestjs/common';
import { UserRole, type Prisma } from '@autoconnect/db';
import type { LeadInteractionKind } from '@autoconnect/shared';
import type { ScopedClient } from '../../common/prisma/prisma.service';
import { CrmSettingsService, type AjustesDeCrm } from './crm-settings.service';
import { escolherProximoDoRodizio, type CandidatoDoRodizio } from './rodizio';

/** Status em que o lead ainda ocupa a agenda de alguém. */
const STATUS_ABERTOS: Prisma.LeadWhereInput['status'] = {
  in: ['new', 'contacted', 'qualified', 'negotiating'],
};

@Injectable()
export class RodizioService {
  private readonly logger = new Logger(RodizioService.name);

  constructor(private readonly ajustes: CrmSettingsService) {}

  /**
   * Quem recebe o próximo lead desta loja, e move o ponteiro.
   *
   * ⚠ `ajustes` **tem** que vir de `CrmSettingsService.lerTravando`, na mesma
   * transação que vai gravar o lead. É esse `SELECT … FOR UPDATE` que serializa
   * dois leads simultâneos, e é o commit do lead que libera a trava. Lido sem
   * a trava, ou numa transação própria, os dois leads leriam o mesmo ponteiro e
   * cairiam no mesmo vendedor — o defeito clássico de rodízio feito em memória,
   * que nem aparece numa máquina só.
   *
   * Devolve `null` quando o rodízio está desligado ou ninguém está de plantão.
   * O lead então fica **sem responsável** e aparece no filtro homônimo em
   * `/leads` — a fila visível é o que impede o lead de sumir.
   */
  async proximoVendedor(
    tx: ScopedClient,
    tenantId: string,
    ajustes: AjustesDeCrm,
    agora: Date = new Date(),
  ): Promise<string | null> {
    if (!ajustes.rodizioAtivo) return null;

    const candidatos = await this.candidatos(tx, tenantId, ajustes, agora);
    const escolhido = escolherProximoDoRodizio(candidatos, ajustes.rodizioUltimoUsuarioId);

    if (!escolhido) {
      this.logger.log(
        `Rodízio sem ninguém de plantão na loja ${tenantId}: o lead fica na fila.`,
      );
      return null;
    }

    await this.ajustes.guardarPonteiro(tx, tenantId, escolhido);
    return escolhido;
  }

  /**
   * Quem está apto a receber lead agora.
   *
   * Três condições: conta ativa, papel que atende e **plantão ligado**. Um
   * membro sem `salespersonProfile` conta como de plantão — o perfil é criado
   * sob demanda (comissão, plantão), e exigir sua existência tiraria do
   * rodízio exatamente o vendedor recém-convidado, que é quem mais precisa de
   * lead.
   */
  private async candidatos(
    tx: ScopedClient,
    tenantId: string,
    ajustes: AjustesDeCrm,
    agora: Date,
  ): Promise<CandidatoDoRodizio[]> {
    // `tenant_admin` entra junto com `manager`: numa revenda de 2 pessoas quem
    // administra a loja também atende, e deixá-lo de fora faria o interruptor
    // não ter efeito nenhum na loja em que ele mais importa.
    const papeis: UserRole[] = ajustes.rodizioIncluiGerentes
      ? [UserRole.salesperson, UserRole.manager, UserRole.tenant_admin]
      : [UserRole.salesperson];

    const emPlantao: Prisma.UserWhereInput['OR'] = [
      { salespersonProfile: { is: null } },
      {
        salespersonProfile: {
          is: {
            isAcceptingLeads: true,
            // "Ausente até" no futuro tira do rodízio sem que ninguém precise
            // lembrar de religar o interruptor na volta das férias.
            OR: [{ onDutyPausedUntil: null }, { onDutyPausedUntil: { lte: agora } }],
          },
        },
      },
    ];

    const membros = await tx.user.findMany({
      where: { tenantId, status: 'active', role: { in: papeis }, OR: emPlantao },
      select: { id: true, createdAt: true },
    });
    if (membros.length === 0) return [];

    const abertos = await tx.lead.groupBy({
      by: ['assignedTo'],
      where: { tenantId, assignedTo: { not: null }, status: STATUS_ABERTOS },
      _count: { _all: true },
    });
    const carga = new Map(abertos.map((a) => [a.assignedTo, a._count._all]));

    return membros.map((m) => ({
      userId: m.id,
      entrouEm: m.createdAt,
      leadsAbertos: carga.get(m.id) ?? 0,
    }));
  }

  /**
   * Linha da timeline: sem ela o lead aparece com dono e sem explicação.
   *
   * `occorridoEm` é explícito, e não o `DEFAULT now()` da coluna: dentro de uma
   * transação `now()` é a hora de **início** dela, igual para todas as linhas —
   * "lead criado" e "distribuído" empatariam no carimbo e a ordem da timeline
   * ficaria a critério do plano de execução.
   */
  async registrarNaTimeline(
    tx: ScopedClient,
    tenantId: string,
    leadId: string,
    userId: string | null,
    ocorridoEm: Date,
  ): Promise<void> {
    await tx.leadInteraction.create({
      data: {
        leadId,
        tenantId,
        occurredAt: ocorridoEm,
        // Sem ator: quem atribuiu foi o sistema, e carimbar um usuário aqui
        // faria a timeline dizer que um colega distribuiu o lead à mão.
        actorUserId: null,
        kind: 'rotation' satisfies LeadInteractionKind,
        content: userId
          ? 'Lead distribuído automaticamente pelo rodízio'
          : 'Ninguém de plantão — o lead ficou na fila, sem responsável',
        payload: { salesPersonId: userId } as never,
      },
    });
  }
}
