import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import type { ScopedClient } from '../../common/prisma/prisma.service';
import { CATEGORIAS_PADRAO, mesEstaFechado, type ChaveDeOrigem } from '@autoconnect/shared';

/**
 * O dinheiro que nasce do que a loja já fez.
 *
 * É a fase que faz valer a pena o financeiro estar **aqui** e não numa planilha:
 * a compra do carro, a preparação e a venda já foram digitadas uma vez, no lugar
 * onde fazem sentido. Digitá-las de novo no caixa seria pedir à loja que
 * mantenha duas verdades.
 *
 * Três regras moldam este arquivo:
 *
 *  1. **Idempotência por construção.** Cada origem tem uma coluna única no
 *     lançamento (`deal_payment_id`, `vehicle_acquisition_id`,
 *     `vehicle_cost_id`). Rodar duas vezes não cria a segunda conta a pagar —
 *     não por causa de um `if`, mas porque o banco não deixa.
 *  2. **A geração nunca derruba a operação.** Falhar ao criar o lançamento não
 *     pode impedir a venda de ser faturada: o erro vira aviso no log e o
 *     negócio segue. Dinheiro invisível é ruim; venda travada é pior.
 *  3. **O lançamento aponta para a origem, não copia o valor dela.** É o que
 *     evita dupla contagem com o DRE por veículo, e o que permite a tela dizer
 *     "gerado pelo sistema" em vez de fingir que alguém digitou.
 */
@Injectable()
export class GeracaoFinanceiraService {
  private readonly log = new Logger('Financeiro');

  /**
   * A categoria que a geração usa, achada pela **chave** e nunca pelo nome.
   *
   * Cria quando não existe: a loja que nunca semeou o plano de contas não pode
   * ficar sem o lançamento por causa disso. E se existir uma categoria com o
   * mesmo nome e sem chave (a loja criou à mão antes), ela **adota** a chave em
   * vez de criar uma segunda igual.
   */
  async categoriaDe(tx: ScopedClient, tenantId: string, chave: ChaveDeOrigem): Promise<string> {
    const achada = await tx.financialCategory.findFirst({
      where: { tenantId, originKey: chave },
      select: { id: true },
    });
    if (achada) return achada.id;

    const padrao = CATEGORIAS_PADRAO.find((c) => c.origemKey === chave);
    if (!padrao) throw new Error(`Chave de origem sem categoria padrão: ${chave}`);

    const mesmoNome = await tx.financialCategory.findFirst({
      where: { tenantId, direction: padrao.direction, name: padrao.name },
      select: { id: true },
    });
    if (mesmoNome) {
      await tx.financialCategory.update({ where: { id: mesmoNome.id }, data: { originKey: chave } });
      return mesmoNome.id;
    }

    const criada = await tx.financialCategory.create({
      data: {
        tenantId,
        direction: padrao.direction,
        group: padrao.group,
        name: padrao.name,
        originKey: chave,
      },
      select: { id: true },
    });
    return criada.id;
  }

  /**
   * A data que o lançamento pode usar.
   *
   * Se a data natural cai em mês fechado, o lançamento vai para **hoje**, com o
   * porquê na observação. As alternativas eram piores: violar o fechamento
   * (mudaria um mês já conferido) ou não gerar (o dinheiro sumiria do caixa por
   * causa de uma data).
   */
  private async dataPossivel(
    tx: ScopedClient,
    tenantId: string,
    desejada: Date,
  ): Promise<{ data: Date; observacao: string | null }> {
    const fechados = await tx.financialPeriod.findMany({
      where: { tenantId, reopenedAt: null },
      select: { year: true, month: true },
    });
    if (!mesEstaFechado(desejada, fechados)) return { data: desejada, observacao: null };

    const mes = `${String(desejada.getUTCMonth() + 1).padStart(2, '0')}/${desejada.getUTCFullYear()}`;
    return {
      data: new Date(),
      observacao: `Vencimento original em ${mes}, que já estava fechado — lançado na data de hoje.`,
    };
  }

  /**
   * Negócio faturado vira conta a receber: uma por forma de pagamento.
   *
   * **Uma por `deal_payment`, não uma por parcela do financiamento.** Quando a
   * loja vende financiado em 48x, quem recebe as 48 é o banco; a loja recebe o
   * repasse. Criar 48 contas a receber encheria o caixa de promessas que não são
   * dela.
   *
   * Pagamento já confirmado no negócio entra como **previsto**, não como pago:
   * dar baixa exige dizer em qual conta o dinheiro caiu, e isso o sistema não
   * tem como adivinhar. A observação diz isso a quem abrir a linha.
   */
  async aoFaturarNegocio(
    tx: ScopedClient,
    negocio: { id: string; tenantId: string; vehicleId: string; closedAt: Date | null },
  ): Promise<number> {
    try {
      const pagamentos = await tx.dealPayment.findMany({
        where: {
          dealId: negocio.id,
          status: { in: ['pending', 'confirmed'] },
          financialEntry: { is: null },
        },
        select: { id: true, kind: true, value: true, status: true, institution: true },
      });
      if (pagamentos.length === 0) return 0;

      const categoryId = await this.categoriaDe(tx, negocio.tenantId, 'venda_de_veiculo');
      const veiculo = await tx.vehicle.findFirst({
        where: { id: negocio.vehicleId },
        select: { brand: { select: { name: true } }, model: { select: { name: true } } },
      });
      const nomeDoCarro = veiculo ? `${veiculo.brand.name} ${veiculo.model.name}` : 'veículo';
      const { data, observacao } = await this.dataPossivel(
        tx, negocio.tenantId, negocio.closedAt ?? new Date(),
      );

      for (const p of pagamentos) {
        await tx.financialEntry.create({
          data: {
            tenantId: negocio.tenantId,
            direction: 'entrada',
            status: 'previsto',
            value: p.value,
            dueDate: data,
            description: `Venda do ${nomeDoCarro} — ${p.kind}${p.institution ? ` (${p.institution})` : ''}`,
            notes: [
              p.status === 'confirmed'
                ? 'Pagamento já confirmado no negócio: dê baixa escolhendo a conta que recebeu.'
                : null,
              observacao,
            ].filter(Boolean).join(' ') || null,
            categoryId,
            dealId: negocio.id,
            vehicleId: negocio.vehicleId,
            dealPaymentId: p.id,
          },
        });
      }
      return pagamentos.length;
    } catch (err) {
      // Nunca derruba o faturamento — ver a regra 2 no topo do arquivo.
      this.log.warn(`Negócio ${negocio.id}: contas a receber não foram geradas: ${err}`);
      return 0;
    }
  }

  /**
   * A compra do veículo vira conta a pagar ao fornecedor.
   *
   * A aquisição é um `upsert` por veículo: se ela for corrigida, o lançamento
   * ainda **previsto** acompanha. Já pago, não: mudar o valor de um lançamento
   * baixado mexeria num caixa já conferido, e o caminho para isso é cancelar e
   * lançar de novo.
   */
  async aoRegistrarAquisicao(
    tx: ScopedClient,
    aquisicao: {
      id: string; tenantId: string; vehicleId: string;
      purchaseValue: Prisma.Decimal; supplierName: string | null; enteredAt: Date;
    },
  ): Promise<void> {
    try {
      const existente = await tx.financialEntry.findUnique({
        where: { vehicleAcquisitionId: aquisicao.id },
        select: { id: true, status: true },
      });

      if (existente) {
        if (existente.status !== 'previsto') return;
        await tx.financialEntry.update({
          where: { id: existente.id },
          data: { value: aquisicao.purchaseValue, supplierName: aquisicao.supplierName },
        });
        return;
      }

      const categoryId = await this.categoriaDe(tx, aquisicao.tenantId, 'compra_de_veiculo');
      const { data, observacao } = await this.dataPossivel(tx, aquisicao.tenantId, aquisicao.enteredAt);

      await tx.financialEntry.create({
        data: {
          tenantId: aquisicao.tenantId,
          direction: 'saida',
          status: 'previsto',
          value: aquisicao.purchaseValue,
          dueDate: data,
          description: 'Compra do veículo',
          supplierName: aquisicao.supplierName,
          notes: observacao,
          categoryId,
          vehicleId: aquisicao.vehicleId,
          vehicleAcquisitionId: aquisicao.id,
        },
      });
    } catch (err) {
      this.log.warn(`Aquisição ${aquisicao.id}: conta a pagar não foi gerada: ${err}`);
    }
  }

  /** Cada item de preparação vira uma conta a pagar, com o fornecedor dele. */
  async aoLancarCusto(
    tx: ScopedClient,
    custo: {
      id: string; tenantId: string; vehicleId: string; kind: string;
      value: Prisma.Decimal; description: string | null;
      supplierName: string | null; incurredAt: Date;
    },
  ): Promise<void> {
    try {
      const categoryId = await this.categoriaDe(tx, custo.tenantId, 'preparacao');
      const { data, observacao } = await this.dataPossivel(tx, custo.tenantId, custo.incurredAt);

      await tx.financialEntry.create({
        data: {
          tenantId: custo.tenantId,
          direction: 'saida',
          status: 'previsto',
          value: custo.value,
          dueDate: data,
          description: custo.description?.trim() || `Preparação — ${custo.kind}`,
          supplierName: custo.supplierName,
          notes: observacao,
          categoryId,
          vehicleId: custo.vehicleId,
          vehicleCostId: custo.id,
        },
      });
    } catch (err) {
      this.log.warn(`Custo ${custo.id}: conta a pagar não foi gerada: ${err}`);
    }
  }
}
