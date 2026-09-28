import { Module } from '@nestjs/common';
import { DealStateService } from './deal-state.service';
import { MarginService } from './margin.service';
import { FinanceiroModule } from '../financeiro/financeiro.module';

/**
 * A máquina de estados do negócio e o cálculo de margem, isolados num módulo
 * sem dependências.
 *
 * Existe por um motivo só: `DealsModule` importa `ContractsModule` (cancelar o
 * negócio cancela o envio para assinatura) e a emissão do contrato passou a
 * precisar mover o negócio para "contrato emitido". Importar `DealsModule` de
 * volta fecharia um ciclo; declarar os mesmos providers nos dois módulos
 * criaria duas instâncias da mesma regra, que é como as duas pontas começam a
 * divergir. Um módulo folha, importado pelos dois, resolve sem nenhuma das
 * duas coisas.
 */
@Module({
  // O financeiro entra aqui, e não o contrário: é o negócio faturado que gera
  // conta a receber, e o financeiro não sabe o que é um negócio.
  imports: [FinanceiroModule],
  providers: [DealStateService, MarginService],
  exports: [DealStateService, MarginService],
})
export class DealEstadoModule {}
