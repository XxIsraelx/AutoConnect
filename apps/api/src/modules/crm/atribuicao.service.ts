import { Injectable } from '@nestjs/common';
import type { ScopedClient } from '../../common/prisma/prisma.service';
import { CrmSettingsService } from './crm-settings.service';
import { RodizioService } from './rodizio.service';
import { SlaService } from './sla.service';

export interface LeadDistribuido {
  assignedTo: string | null;
  firstResponseDueAt: Date | null;
  /** Houve rodízio a registrar na timeline? */
  viaRodizio: boolean;
}

/**
 * Dono e relógio de um lead que vai nascer — **um** lugar só.
 *
 * Isto morava dentro do `LeadsService`, privado, e por isso valia só para os
 * caminhos que passavam por ele. O formulário de troca (`POST /catalog/trade-in`)
 * criava lead direto do `CatalogService` e entrava sem responsável, sem prazo e
 * sem aparecer no rodízio: não estourava nunca, então o gerente jamais era
 * avisado de que a proposta de troca mais valiosa da semana estava dormindo.
 *
 * A Onda 1 diz "aplicado nos três caminhos de criação"; a troca era um quarto.
 * Com o serviço aqui, o quinto caminho que aparecer tem um só lugar para
 * chamar, e esquecê-lo passa a ser visível.
 *
 * ⚠ Roda **dentro** da transação que grava o lead. `lerTravando` trava a linha
 * de ajustes da loja, e é essa trava que impede dois leads simultâneos de
 * caírem no mesmo vendedor; é o commit do lead que a libera. Uma leitura só
 * serve aos dois usos — o prazo sai do mesmo `ajustes`, sem segunda ida ao
 * banco (API e banco estão em regiões diferentes; cada consulta custa ~0,6s).
 */
@Injectable()
export class AtribuicaoDeLead {
  constructor(
    private readonly ajustes: CrmSettingsService,
    private readonly rodizio: RodizioService,
    private readonly sla: SlaService,
  ) {}

  /**
   * `responsavelFixo` é quem a tela já escolheu (cadastro manual com vendedor
   * indicado). Nesse caso não há rodízio a aplicar, mas o prazo continua
   * valendo — o relógio é do lead, não da forma como ele chegou.
   */
  async distribuirEAgendar(
    tx: ScopedClient,
    tenantId: string,
    opcoes: { branchId?: string | null; responsavelFixo?: string | null; criadoEm: Date },
  ): Promise<LeadDistribuido> {
    const ajustes = await this.ajustes.lerTravando(tx, tenantId);

    const viaRodizio = !opcoes.responsavelFixo && ajustes.rodizioAtivo;
    const assignedTo =
      opcoes.responsavelFixo ??
      (await this.rodizio.proximoVendedor(tx, tenantId, ajustes, opcoes.criadoEm));

    const firstResponseDueAt = await this.sla.prazoDePrimeiroContato(tx, tenantId, {
      branchId: opcoes.branchId ?? null,
      minutos: ajustes.slaPrimeiroContatoMinutos,
      criadoEm: opcoes.criadoEm,
    });

    return { assignedTo, firstResponseDueAt, viaRodizio };
  }

  /**
   * A linha "Lead criado — …" e, quando houve rodízio, a linha da atribuição.
   *
   * Os dois registros andam juntos em todo caminho de criação; deixá-los aqui
   * evita que o próximo caminho grave um e esqueça o outro.
   */
  async registrarNaTimeline(
    tx: ScopedClient,
    tenantId: string,
    leadId: string,
    opcoes: {
      actorUserId?: string | null;
      comoChegou: string;
      criadoEm: Date;
      distribuicao: LeadDistribuido;
    },
  ): Promise<void> {
    await tx.leadInteraction.create({
      data: {
        leadId,
        tenantId,
        actorUserId: opcoes.actorUserId ?? null,
        occurredAt: opcoes.criadoEm,
        kind: 'created',
        content: `Lead criado — ${opcoes.comoChegou}`,
      },
    });

    if (opcoes.distribuicao.viaRodizio) {
      // Um milissegundo depois, para que a ordem da timeline não dependa do
      // desempate entre duas linhas com o mesmo instante.
      await this.rodizio.registrarNaTimeline(
        tx,
        tenantId,
        leadId,
        opcoes.distribuicao.assignedTo,
        new Date(opcoes.criadoEm.getTime() + 1),
      );
    }
  }
}
