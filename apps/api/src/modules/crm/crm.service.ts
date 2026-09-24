import { ForbiddenException, Injectable } from '@nestjs/common';
import type { UpdateCrmSettingsInput } from '@autoconnect/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { CrmSettingsService, type AjustesDeCrm } from './crm-settings.service';

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ajustes: CrmSettingsService,
  ) {}

  /**
   * Ajuste de CRM é sempre de **uma** loja: rodízio, prazo e carteira só fazem
   * sentido dentro de uma equipe. Super admin sem loja selecionada não tem o
   * que configurar aqui — falha alto em vez de escolher uma.
   */
  private lojaDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new ForbiddenException(
        'Selecione uma concessionária para configurar o CRM.',
      );
    }
    return escopo.tenantId;
  }

  async ler(escopo: Escopo): Promise<AjustesDeCrm> {
    const tenantId = this.lojaDe(escopo);
    return this.prisma.withTenant(tenantId, (tx) => this.ajustes.ler(tx, tenantId));
  }

  async salvar(escopo: Escopo, input: UpdateCrmSettingsInput): Promise<AjustesDeCrm> {
    const tenantId = this.lojaDe(escopo);
    return this.prisma.withTenant(tenantId, (tx) =>
      this.ajustes.salvar(tx, tenantId, input),
    );
  }
}
