import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmSettingsService } from './crm-settings.service';
import { RodizioService } from './rodizio.service';
import { SlaService } from './sla.service';

/**
 * Distribuição de leads e prazo de primeiro contato.
 *
 * Os três serviços operam sobre um `tx` recebido de quem chama — o rodízio
 * precisa rodar **dentro** da transação que cria o lead, senão a trava que
 * serializa dois leads simultâneos não cobre a gravação.
 */
@Module({
  controllers: [CrmController],
  providers: [CrmService, CrmSettingsService, RodizioService, SlaService],
  exports: [CrmSettingsService, RodizioService, SlaService],
})
export class CrmModule {}
