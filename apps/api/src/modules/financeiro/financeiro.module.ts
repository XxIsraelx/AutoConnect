import { Module } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';
import { FinanceiroService } from './financeiro.service';
import { GeracaoFinanceiraService } from './geracao.service';
import { ConciliacaoService } from './conciliacao.service';

/**
 * `GeracaoFinanceiraService` é exportado porque o módulo de negócios o chama:
 * é o negócio faturado, a compra do veículo e a preparação que geram o
 * lançamento. A dependência aponta nesse sentido de propósito — o financeiro
 * não sabe o que é um negócio, e quem sabe pede a geração.
 */
@Module({
  controllers: [FinanceiroController],
  providers: [FinanceiroService, GeracaoFinanceiraService, ConciliacaoService],
  exports: [GeracaoFinanceiraService],
})
export class FinanceiroModule {}
