import {
  ConflictException, ForbiddenException, Injectable, NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import {
  DEAL_FATURADO_STATUSES, ROTULO_DO_STATUS_RENAVE, ehEntrada, operacaoRenaveDaAquisicao,
  operacaoTemValor, pendenciasRenave, podeTransitarRenave, situacaoNoRenave,
  type CancelarRenaveInput, type ConfirmarRenaveInput, type RegistrarRenaveInput,
  type RenaveStatusValue,
} from '@autoconnect/shared';

/** Quem registra e corrige. O vendedor vê o estado, não registra (regra 6 do plano). */
export const PAPEIS_FISCAIS = ['manager', 'tenant_admin', 'super_admin'];
/** Quem vê o cartão: a equipe inteira da loja. */
export const PAPEIS_DA_EQUIPE = ['salesperson', ...PAPEIS_FISCAIS];

/**
 * Vendidos entram na lista de pendências da loja por esta janela. O cartão do
 * veículo mostra tudo, sempre; a lista é para o que ainda dá para agir —
 * e uma loja com três anos de vendas não pode ter a tela aberta pela história.
 */
export const JANELA_DE_VENDIDOS_DIAS = 90;

/** Uma venda está no RENAVE a partir da assinatura — antes disso não houve venda. */
const NEGOCIO_QUE_SAI = ['signed', ...DEAL_FATURADO_STATUSES] as const;

const SELECAO_DO_REGISTRO = {
  id: true, vehicleId: true, dealId: true, tipo: true, status: true, origem: true,
  protocolo: true, registradoEm: true, dataOperacao: true, chaveNfe: true, valor: true,
  observacao: true, motivoRecusa: true, canceladoEm: true, motivoCancelamento: true,
  protocoloCancelamento: true, createdBy: true, createdAt: true,
} satisfies Prisma.RenaveRegistroSelect;

type LinhaDoRegistro = Prisma.RenaveRegistroGetPayload<{ select: typeof SELECAO_DO_REGISTRO }>;

/**
 * RENAVE — registro manual e pendências (R1 do plano fiscal).
 *
 * O AutoConnect **não transmite** nada ao RENAVE. A loja registra pela
 * integradora dela e anota aqui o protocolo; o sistema guarda e diz o que
 * falta. Três coisas que este arquivo não faz, de propósito:
 *
 *  1. **Não pede valor.** O de compra vem da aquisição, o de venda do negócio,
 *     copiados no registro (regra 4: um número, uma fonte; regra 3: snapshot).
 *  2. **Não bloqueia o resto do sistema.** Pendência é lista e aviso; nem a
 *     vitrine, nem o negócio, nem o faturamento esperam pelo RENAVE.
 *  3. **Não muda deals nem vehicles.** Só lê. O vínculo com o negócio é a
 *     coluna `deal_id` deste lado.
 */
@Injectable()
export class RenaveService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new ForbiddenException('Selecione uma concessionária para ver o RENAVE dela.');
    }
    return escopo.tenantId;
  }

  private serializar(r: LinhaDoRegistro) {
    return { ...r, valor: r.valor?.toFixed(2) ?? null };
  }

  /* ── Leitura ────────────────────────────────────────────── */

  /** O cartão do veículo e do negócio: registros, situação, pendências e o que preencher. */
  async doVeiculo(escopo: Escopo, vehicleId: string) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const veiculo = await tx.vehicle.findFirst({
        where: { id: vehicleId, tenantId },
        select: {
          id: true, status: true, condition: true,
          acquisition: { select: { origin: true, enteredAt: true, purchaseValue: true } },
          deals: {
            select: { id: true, status: true, closedAt: true, saleValue: true },
            orderBy: { createdAt: 'desc' },
          },
          renaveRegistros: { select: SELECAO_DO_REGISTRO, orderBy: { createdAt: 'desc' } },
        },
      });
      if (!veiculo) throw new NotFoundException('Veículo não encontrado.');

      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { taxId: true } });
      const registros = veiculo.renaveRegistros;

      const pendencias = pendenciasRenave({
        veiculo,
        aquisicao: veiculo.acquisition,
        negocios: veiculo.deals,
        registros,
        cnpjDaLoja: tenant?.taxId,
      });

      const tipoDeEntrada = veiculo.acquisition
        ? operacaoRenaveDaAquisicao(veiculo.acquisition.origin)
        : null;

      return {
        vehicleId: veiculo.id,
        situacao: situacaoNoRenave(registros),
        registros: registros.map((r) => this.serializar(r)),
        pendencias,
        /**
         * O que a tela pré-preenche — e mostra sem deixar editar o valor. Vem
         * da aquisição e dos negócios que já existem, nunca de digitação nova.
         */
        sugestao: {
          entrada: {
            tipo: tipoDeEntrada ?? 'entrada_compra',
            valor: veiculo.acquisition?.purchaseValue.toFixed(2) ?? null,
            dataOperacao: veiculo.acquisition?.enteredAt ?? null,
            temAquisicao: veiculo.acquisition !== null,
          },
          saidas: veiculo.deals
            .filter((d) => (NEGOCIO_QUE_SAI as readonly string[]).includes(d.status))
            .map((d) => ({
              dealId: d.id,
              valor: d.saleValue.toFixed(2),
              dataOperacao: d.closedAt,
            })),
        },
      };
    });
  }

  /** Pendências da loja inteira, para a gerência. */
  async pendencias(escopo: Escopo) {
    const tenantId = this.tenantDe(escopo);
    const corte = new Date(Date.now() - JANELA_DE_VENDIDOS_DIAS * 86_400_000);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      // Uma consulta com includes, e não uma por veículo: a API roda a ~0,6s do
      // banco, e o laço transformaria uma loja de 80 carros em um minuto.
      const [veiculos, tenant] = await Promise.all([
        tx.vehicle.findMany({
          where: {
            tenantId,
            condition: { not: 'new' },
            OR: [
              { status: { in: ['available', 'reserved', 'in_maintenance'] } },
              { status: 'sold', OR: [{ soldAt: null }, { soldAt: { gte: corte } }] },
            ],
          },
          select: {
            id: true, status: true, condition: true, licensePlate: true,
            versionName: true, yearModel: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
            acquisition: { select: { origin: true, enteredAt: true } },
            deals: { select: { id: true, status: true, closedAt: true } },
            renaveRegistros: {
              select: {
                id: true, tipo: true, status: true, dealId: true, chaveNfe: true,
                dataOperacao: true, createdAt: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { taxId: true } }),
      ]);

      const itens = veiculos
        .map((v) => ({
          veiculo: {
            id: v.id, status: v.status, licensePlate: v.licensePlate,
            descricao: [v.brand.name, v.model.name, v.versionName, v.yearModel].filter(Boolean).join(' '),
          },
          pendencias: pendenciasRenave({
            veiculo: v,
            aquisicao: v.acquisition,
            negocios: v.deals,
            registros: v.renaveRegistros,
            cnpjDaLoja: tenant?.taxId,
          }),
        }))
        .filter((i) => i.pendencias.length > 0);

      const todas = itens.flatMap((i) => i.pendencias);
      return {
        janelaDeVendidosDias: JANELA_DE_VENDIDOS_DIAS,
        total: {
          veiculos: itens.length,
          obrigatorias: todas.filter((p) => p.gravidade === 'obrigatoria').length,
          avisos: todas.filter((p) => p.gravidade === 'aviso').length,
        },
        // Quem tem obrigação primeiro; entre eles, o mais antigo no estoque.
        itens: itens.sort((a, b) =>
          Number(b.pendencias[0]!.gravidade === 'obrigatoria') -
          Number(a.pendencias[0]!.gravidade === 'obrigatoria')),
      };
    });
  }

  /* ── Escrita ────────────────────────────────────────────── */

  async registrar(escopo: Escopo, dados: RegistrarRenaveInput, autor: { id: string }) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const veiculo = await tx.vehicle.findFirst({
        where: { id: dados.vehicleId, tenantId },
        select: {
          id: true, licensePlate: true, vin: true, versionName: true, yearModel: true,
          yearMake: true, mileageKm: true,
          brand: { select: { name: true } },
          model: { select: { name: true } },
          acquisition: {
            select: { origin: true, purchaseValue: true, enteredAt: true, supplierName: true, supplierDocument: true },
          },
          renaveRegistros: {
            select: {
              id: true, tipo: true, status: true, dealId: true, chaveNfe: true,
              dataOperacao: true, createdAt: true,
            },
          },
        },
      });
      if (!veiculo) throw new NotFoundException('Veículo não encontrado.');

      const situacao = situacaoNoRenave(veiculo.renaveRegistros);
      if (ehEntrada(dados.tipo) && situacao === 'em_estoque') {
        throw new ConflictException(
          'Este carro já tem entrada viva no RENAVE. Uma nova entrada só depois da saída ' +
            'ou do cancelamento da anterior.',
        );
      }
      if (!ehEntrada(dados.tipo) && situacao === 'fora_do_estoque') {
        throw new ConflictException(
          'Este carro já tem saída viva no RENAVE. Se ela foi um erro, cancele-a antes de registrar outra.',
        );
      }

      const snapshotDoVeiculo = {
        placa: veiculo.licensePlate, chassi: veiculo.vin,
        marca: veiculo.brand.name, modelo: veiculo.model.name, versao: veiculo.versionName,
        anoModelo: veiculo.yearModel, anoFabricacao: veiculo.yearMake, km: veiculo.mileageKm,
      };

      let valor: Prisma.Decimal | null = null;
      let dataOperacao = dados.dataOperacao ?? null;
      let snapshot: Prisma.InputJsonValue = { veiculo: snapshotDoVeiculo };

      if (ehEntrada(dados.tipo)) {
        const aq = veiculo.acquisition;
        if (dados.tipo === 'entrada_compra' && !aq) {
          throw new UnprocessableEntityException(
            'Registre a compra no custo do veículo primeiro: o valor de compra que vai ao RENAVE vem de lá.',
          );
        }
        if (aq && operacaoTemValor(dados.tipo)) valor = aq.purchaseValue;
        dataOperacao ??= aq?.enteredAt ?? null;
        if (aq) {
          snapshot = {
            veiculo: snapshotDoVeiculo,
            vendedor: { nome: aq.supplierName, documento: aq.supplierDocument },
          };
        }
      }

      if (dados.tipo === 'saida_venda') {
        const negocio = await tx.deal.findFirst({
          where: { id: dados.dealId!, tenantId },
          select: {
            id: true, vehicleId: true, status: true, saleValue: true, closedAt: true,
            buyer: { select: { fullName: true, cpf: true, email: true } },
          },
        });
        if (!negocio || negocio.vehicleId !== veiculo.id) {
          throw new NotFoundException('Negócio não encontrado para este veículo.');
        }
        if (!(NEGOCIO_QUE_SAI as readonly string[]).includes(negocio.status)) {
          throw new UnprocessableEntityException(
            'A saída por venda é registrada depois que o negócio é assinado.',
          );
        }
        const jaTem = veiculo.renaveRegistros.some(
          (r) => r.dealId === negocio.id && (r.status === 'pendente' || r.status === 'confirmado'),
        );
        if (jaTem) throw new ConflictException('Esta venda já tem saída registrada no RENAVE.');

        valor = negocio.saleValue;
        dataOperacao ??= negocio.closedAt;
        snapshot = {
          veiculo: snapshotDoVeiculo,
          comprador: negocio.buyer
            ? { nome: negocio.buyer.fullName, cpf: negocio.buyer.cpf, email: negocio.buyer.email }
            : null,
        };
      }

      try {
        const criado = await tx.renaveRegistro.create({
          data: {
            tenantId,
            vehicleId: veiculo.id,
            dealId: dados.dealId ?? null,
            tipo: dados.tipo,
            status: dados.protocolo ? 'confirmado' : 'pendente',
            origem: 'manual',
            protocolo: dados.protocolo ?? null,
            registradoEm: dados.protocolo ? (dados.registradoEm ?? new Date()) : null,
            dataOperacao: dataOperacao ?? new Date(),
            chaveNfe: dados.chaveNfe ?? null,
            valor,
            snapshot,
            observacao: dados.observacao ?? null,
            createdBy: autor.id,
          },
          select: SELECAO_DO_REGISTRO,
        });
        return this.serializar(criado);
      } catch (e) {
        // O índice parcial `renave_registros_saida_viva_por_negocio` é a rede
        // para dois cliques simultâneos que passaram juntos pela checagem acima.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Esta venda já tem saída registrada no RENAVE.');
        }
        throw e;
      }
    });
  }

  private async exigirTransicao(
    tx: ScopedClient, tenantId: string, id: string, para: RenaveStatusValue,
  ): Promise<LinhaDoRegistro> {
    const atual = await tx.renaveRegistro.findFirst({
      where: { id, tenantId }, select: SELECAO_DO_REGISTRO,
    });
    if (!atual) throw new NotFoundException('Registro RENAVE não encontrado.');
    if (!podeTransitarRenave(atual.status, para)) {
      throw new ConflictException(
        `O registro está "${ROTULO_DO_STATUS_RENAVE[atual.status]}" e não pode virar ` +
          `"${ROTULO_DO_STATUS_RENAVE[para]}".`,
      );
    }
    return atual;
  }

  /** A integradora devolveu o protocolo de um registro que estava aguardando. */
  async confirmar(escopo: Escopo, id: string, dados: ConfirmarRenaveInput) {
    const tenantId = this.tenantDe(escopo);
    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      await this.exigirTransicao(tx, tenantId, id, 'confirmado');
      const r = await tx.renaveRegistro.update({
        where: { id },
        data: {
          status: 'confirmado',
          protocolo: dados.protocolo,
          registradoEm: dados.registradoEm ?? new Date(),
        },
        select: SELECAO_DO_REGISTRO,
      });
      return this.serializar(r);
    });
  }

  async recusar(escopo: Escopo, id: string, motivo: string) {
    const tenantId = this.tenantDe(escopo);
    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      await this.exigirTransicao(tx, tenantId, id, 'recusado');
      const r = await tx.renaveRegistro.update({
        where: { id },
        data: { status: 'recusado', motivoRecusa: motivo },
        select: SELECAO_DO_REGISTRO,
      });
      return this.serializar(r);
    });
  }

  /**
   * O cancelamento de entrada ou de saída que o manual do RENAVE prevê. A
   * linha fica, com motivo; é isso que libera o carro para outro registro.
   */
  async cancelar(escopo: Escopo, id: string, dados: CancelarRenaveInput) {
    const tenantId = this.tenantDe(escopo);
    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      await this.exigirTransicao(tx, tenantId, id, 'cancelado');
      const r = await tx.renaveRegistro.update({
        where: { id },
        data: {
          status: 'cancelado',
          canceladoEm: new Date(),
          motivoCancelamento: dados.motivo,
          protocoloCancelamento: dados.protocoloCancelamento ?? null,
        },
        select: SELECAO_DO_REGISTRO,
      });
      return this.serializar(r);
    });
  }

  /**
   * A chave da NF-e chega depois do registro — o manual a envia em passo
   * próprio — e pode ser trocada. É a única coisa que muda num confirmado.
   */
  async informarNfe(escopo: Escopo, id: string, chaveNfe: string) {
    const tenantId = this.tenantDe(escopo);
    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const atual = await tx.renaveRegistro.findFirst({
        where: { id, tenantId }, select: { status: true },
      });
      if (!atual) throw new NotFoundException('Registro RENAVE não encontrado.');
      if (atual.status === 'recusado' || atual.status === 'cancelado') {
        throw new ConflictException('Registro recusado ou cancelado não recebe NF-e.');
      }
      const r = await tx.renaveRegistro.update({
        where: { id }, data: { chaveNfe }, select: SELECAO_DO_REGISTRO,
      });
      return this.serializar(r);
    });
  }
}
