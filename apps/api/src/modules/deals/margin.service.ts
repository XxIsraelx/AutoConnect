import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import type { ScopedClient } from '../../common/prisma/prisma.service';

/** Demonstrativo de margem de um veículo, com tudo já em string decimal. */
export interface DemonstrativoMargem {
  vehicleId: string;
  /** Valor pago na entrada do veículo no estoque. */
  purchaseValue: string;
  /** Soma dos lançamentos de preparação e despesas. */
  costsTotal: string;
  /** purchaseValue + costsTotal — é o que o carro custou de fato. */
  totalCost: string;
  /** Valor da venda, quando há negócio. `null` se o carro ainda está parado. */
  saleValue: string | null;
  /** saleValue − totalCost. Negativo é prejuízo, e aparece como tal. */
  grossMargin: string | null;
  /** Margem sobre a venda, em pontos percentuais com 2 casas. */
  marginPercent: string | null;
  /** Dias entre a entrada no estoque e a venda (ou hoje, se não vendeu). */
  daysInStock: number | null;
}

/**
 * Custo e margem.
 *
 * Todo cálculo aqui usa `Prisma.Decimal`. A tentação é `Number(venda) -
 * Number(custo)`, e é assim que aparece um centavo do nada numa comissão —
 * `0.1 + 0.2` não é `0.3` em ponto flutuante. Os valores saem como string,
 * que é o formato em que o `Decimal` atravessa o JSON.
 */
@Injectable()
export class MarginService {
  /**
   * Custo total do veículo: aquisição + soma dos lançamentos.
   *
   * `tenantId` é filtro explícito e não confia no RLS: a aplicação ainda
   * conecta como dona das tabelas, que ignora policy — o isolamento real hoje
   * é este `where`.
   */
  async custoDoVeiculo(tx: ScopedClient, vehicleId: string, tenantId?: string) {
    const escopo = tenantId ? { tenantId } : {};
    const [aquisicao, custos] = await Promise.all([
      tx.vehicleAcquisition.findFirst({
        where: { vehicleId, ...escopo },
        select: { purchaseValue: true, enteredAt: true },
      }),
      tx.vehicleCost.findMany({ where: { vehicleId, ...escopo }, select: { value: true } }),
    ]);

    const compra = aquisicao?.purchaseValue ?? new Prisma.Decimal(0);
    const preparo = custos.reduce(
      (acc, c) => acc.plus(c.value),
      new Prisma.Decimal(0),
    );

    return {
      purchaseValue: compra,
      costsTotal: preparo,
      totalCost: compra.plus(preparo),
      enteredAt: aquisicao?.enteredAt ?? null,
      /**
       * Sem aquisição registrada não existe custo conhecido — e zero seria
       * pior do que nada, porque produziria uma margem igual à venda inteira
       * e faria a loja acreditar num lucro que não teve.
       */
      temAquisicao: aquisicao != null,
    };
  }

  /** Demonstrativo de um veículo, opcionalmente considerando um negócio. */
  async doVeiculo(
    tx: ScopedClient,
    vehicleId: string,
    tenantId?: string,
    saleValue?: Prisma.Decimal | null,
    soldAt?: Date | null,
  ): Promise<DemonstrativoMargem> {
    const veiculo = await tx.vehicle.findFirst({
      where: { id: vehicleId, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, createdAt: true },
    });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado');

    const custo = await this.custoDoVeiculo(tx, vehicleId, tenantId);

    const margem = saleValue != null ? saleValue.minus(custo.totalCost) : null;
    const percentual =
      margem != null && !saleValue!.isZero()
        ? margem.dividedBy(saleValue!).times(100).toDecimalPlaces(2)
        : null;

    const inicio = custo.enteredAt ?? veiculo.createdAt;
    const fim = soldAt ?? new Date();
    const dias = Math.max(
      0,
      Math.floor((fim.getTime() - inicio.getTime()) / 86_400_000),
    );

    return {
      vehicleId,
      purchaseValue: custo.purchaseValue.toFixed(2),
      costsTotal: custo.costsTotal.toFixed(2),
      totalCost: custo.totalCost.toFixed(2),
      saleValue: saleValue?.toFixed(2) ?? null,
      grossMargin: margem?.toFixed(2) ?? null,
      marginPercent: percentual?.toFixed(2) ?? null,
      daysInStock: dias,
    };
  }
}
