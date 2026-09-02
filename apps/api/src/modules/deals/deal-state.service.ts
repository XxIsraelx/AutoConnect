import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type Deal, type DealStatus } from '@autoconnect/db';
import { canTransition, isDealTerminal, type DealStatusValue } from '@autoconnect/shared';
import type { ScopedClient } from '../../common/prisma/prisma.service';
import { MarginService } from './margin.service';

/**
 * Transições de status: valida, aplica os efeitos e grava o evento.
 *
 * A regra de quais transições existem mora no `@autoconnect/shared`, junto com
 * a que o front consulta para decidir quais botões mostrar. Aqui só se decide
 * o que **acontece** numa transição válida.
 */
@Injectable()
export class DealStateService {
  constructor(private readonly margem: MarginService) {}

  async transicionar(
    tx: ScopedClient,
    negocio: Deal,
    destino: DealStatusValue,
    atorId: string,
    motivo?: string,
  ): Promise<Deal> {
    const origem = negocio.status as DealStatusValue;

    if (origem === destino) {
      throw new BadRequestException(`O negócio já está em "${destino}".`);
    }

    if (!canTransition(origem, destino)) {
      // 409 e não 400: o pedido é bem formado, mas conflita com o estado atual
      // do recurso. É a diferença entre "você escreveu errado" e "não dá para
      // fazer isso agora" — e o front usa isso para decidir a mensagem.
      throw new ConflictException(
        isDealTerminal(origem)
          ? `O negócio está em "${origem}" e não admite mudança de status.`
          : `Não é possível ir de "${origem}" para "${destino}".`,
      );
    }

    const dados: Prisma.DealUpdateInput = { status: destino as DealStatus };
    const agora = new Date();

    // Assinado: é aqui que o dinheiro precisa fechar.
    if (destino === 'signed') {
      await this.exigirPagamentoFechado(tx, negocio);
      dados.closedAt = agora;
    }

    // Faturado: congela custo e margem. O custo do veículo muda depois — outro
    // lançamento de preparação entra, o preço de tabela muda — e a margem do
    // negócio já fechado não pode mudar junto.
    if (destino === 'invoiced') {
      const custo = await this.margem.custoDoVeiculo(tx, negocio.vehicleId, negocio.tenantId);
      dados.vehicleCostSnapshot = custo.totalCost;
      dados.grossMargin = negocio.saleValue.minus(custo.totalCost);

      await tx.vehicle.update({
        where: { id: negocio.vehicleId },
        data: { status: 'sold', soldAt: agora },
      });
    }

    if (destino === 'delivered') dados.deliveredAt = agora;

    if (destino === 'canceled' || destino === 'rescinded') {
      dados.canceledAt = agora;
      dados.cancelReason = motivo ?? null;

      // O carro volta ao estoque. Sem isto ele fica preso a um negócio morto —
      // e como o índice único parcial libera o veículo, a loja conseguiria
      // vender um carro que o sistema ainda mostra como reservado.
      await tx.vehicle.update({
        where: { id: negocio.vehicleId },
        data: { status: 'available', soldAt: null },
      });
    }

    const atualizado = await tx.deal.update({ where: { id: negocio.id }, data: dados });

    await tx.dealStatusEvent.create({
      data: {
        tenantId: negocio.tenantId,
        dealId: negocio.id,
        fromStatus: origem as DealStatus,
        toStatus: destino as DealStatus,
        actorUserId: atorId,
        reason: motivo,
        occurredAt: agora,
      },
    });

    return atualizado;
  }

  /**
   * A soma dos pagamentos tem de bater com o valor da venda.
   *
   * Não se cobra isso a cada pagamento adicionado — durante a negociação a
   * composição fica incompleta por definição. Cobra-se na assinatura, que é
   * quando o valor deixa de ser proposta e vira compromisso.
   */
  private async exigirPagamentoFechado(tx: ScopedClient, negocio: Deal): Promise<void> {
    const pagamentos = await tx.dealPayment.findMany({
      where: { dealId: negocio.id, status: { in: ['pending', 'confirmed'] } },
      select: { value: true },
    });

    const soma = pagamentos.reduce((acc, p) => acc.plus(p.value), new Prisma.Decimal(0));

    if (!soma.equals(negocio.saleValue)) {
      const diferenca = negocio.saleValue.minus(soma);
      throw new ConflictException(
        `A composição do pagamento soma ${soma.toFixed(2)}, mas a venda é ` +
          `${negocio.saleValue.toFixed(2)}. ${
            diferenca.isPositive()
              ? `Faltam ${diferenca.toFixed(2)}.`
              : `Há ${diferenca.abs().toFixed(2)} a mais.`
          }`,
      );
    }
  }
}
