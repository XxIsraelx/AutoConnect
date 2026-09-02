import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { PrismaService } from '../../common/prisma/prisma.service';

/** O que o card de proposta do chat carrega em `Message.metadata.proposal`. */
export interface PropostaDoChat {
  price?: unknown;
  downPayment?: unknown;
  installments?: unknown;
  installmentValue?: unknown;
  dealId?: unknown;
}

/**
 * A ponte entre a proposta do chat e o negócio.
 *
 * Mora aqui, e não no gateway, por dois motivos: o gateway deve ser fino, e
 * — mais importante — este código **falha em silêncio por desenho**. Nada aqui
 * pode derrubar o envio da mensagem, então um erro não aparece como erro:
 * aparece como uma proposta que nunca chegou ao funil. Sendo um service, dá
 * para exercê-lo contra o banco sem depender do transporte WebSocket.
 */
@Injectable()
export class PropostaChatService {
  private readonly logger = new Logger(PropostaChatService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Abre o negócio da proposta, ou devolve o id do que já existe para o carro.
   * `null` quando não há como vincular — sem veículo, sem preço, ou erro.
   */
  async abrirNegocio(
    tenantId: string,
    vendedorId: string,
    conv: { vehicleId: string | null; customerUserId: string | null },
    proposta: PropostaDoChat,
  ): Promise<string | null> {
    if (!conv.vehicleId) return null;

    const preco = Number(proposta.price);
    if (!Number.isFinite(preco) || preco <= 0) return null;
    const vehicleId = conv.vehicleId;

    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        // Já existe negócio vivo para este carro: a proposta se pendura nele.
        // Abrir um segundo seria recusado pelo índice único parcial.
        const vivo = await tx.deal.findFirst({
          where: { vehicleId, tenantId, status: { notIn: ['canceled', 'rescinded'] } },
          select: { id: true },
        });
        if (vivo) return vivo.id;

        const veiculo = await tx.vehicle.findFirst({
          where: { id: vehicleId, tenantId },
          select: { price: true },
        });
        if (!veiculo) return null;

        const venda = new Prisma.Decimal(preco.toFixed(2));
        // Se a proposta ficou acima da tabela, ela vira a própria tabela: um
        // desconto negativo quebraria a conferência `tabela − desconto = venda`.
        const tabela = veiculo.price.greaterThan(venda) ? veiculo.price : venda;

        const negocio = await tx.deal.create({
          data: {
            tenantId,
            vehicleId,
            customerUserId: conv.customerUserId,
            salespersonId: vendedorId,
            status: 'proposal',
            listPrice: tabela,
            discount: tabela.minus(venda),
            saleValue: venda,
          },
          select: { id: true },
        });

        await tx.vehicle.update({ where: { id: vehicleId }, data: { status: 'reserved' } });

        const entrada = new Prisma.Decimal(Number(proposta.downPayment || 0).toFixed(2));
        if (entrada.greaterThan(0)) {
          await tx.dealPayment.create({
            data: { tenantId, dealId: negocio.id, kind: 'down_payment', value: entrada },
          });
        }
        const financiado = venda.minus(entrada);
        if (financiado.greaterThan(0)) {
          await tx.dealPayment.create({
            data: {
              tenantId,
              dealId: negocio.id,
              kind: 'financing',
              value: financiado,
              installments: Number(proposta.installments) || null,
              installmentValue: proposta.installmentValue
                ? new Prisma.Decimal(Number(proposta.installmentValue).toFixed(2))
                : null,
            },
          });
        }

        await tx.dealStatusEvent.create({
          data: {
            tenantId,
            dealId: negocio.id,
            fromStatus: 'draft',
            toStatus: 'proposal',
            actorUserId: vendedorId,
            reason: 'Proposta enviada pelo chat',
          },
        });

        return negocio.id;
      });
    } catch (e) {
      this.logger.warn(`Proposta sem negócio vinculado: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * O aceite do cliente move o negócio de `proposal` para `negotiating`.
   *
   * Recusar não cancela: o vendedor costuma reenviar outra proposta na mesma
   * conversa, e cancelar aqui obrigaria a reabrir o negócio a cada rodada.
   */
  async aceitar(tenantId: string, dealId: string, clienteId: string): Promise<boolean> {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const negocio = await tx.deal.findFirst({
          where: { id: dealId, tenantId },
          select: { status: true },
        });
        if (negocio?.status !== 'proposal') return false;

        await tx.deal.update({ where: { id: dealId }, data: { status: 'negotiating' } });
        await tx.dealStatusEvent.create({
          data: {
            tenantId,
            dealId,
            fromStatus: 'proposal',
            toStatus: 'negotiating',
            actorUserId: clienteId,
            reason: 'Cliente aceitou a proposta no chat',
          },
        });
        return true;
      });
    } catch (e) {
      this.logger.warn(`Aceite sem avanço do negócio: ${(e as Error).message}`);
      return false;
    }
  }
}
