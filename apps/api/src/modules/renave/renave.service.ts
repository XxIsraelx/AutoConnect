import {
  ConflictException, ForbiddenException, Injectable, NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import {
  DEAL_FATURADO_STATUSES, ROTULO_DO_STATUS_RENAVE, ehEntrada, operacaoRenaveDaAquisicao,
  normalizarCnpj, operacaoTemValor, pendenciasRenave, podeTransitarRenave, situacaoNoRenave,
  type CancelarRenaveInput, type ConfirmarRenaveInput, type RegistrarRenaveInput,
  type RenaveOperacaoValue, type RenaveStatusValue,
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

export const SELECAO_DO_REGISTRO = {
  id: true, vehicleId: true, dealId: true, tipo: true, status: true, origem: true,
  protocolo: true, registradoEm: true, dataOperacao: true, chaveNfe: true, valor: true,
  observacao: true, motivoRecusa: true, canceladoEm: true, motivoCancelamento: true,
  protocoloCancelamento: true, createdBy: true, createdAt: true,
  provider: true, externalId: true, enviadoEm: true, sequencia: true, atpvKey: true,
  snapshot: true,
} satisfies Prisma.RenaveRegistroSelect;

export type LinhaDoRegistro = Prisma.RenaveRegistroGetPayload<{ select: typeof SELECAO_DO_REGISTRO }>;

export interface RegistroPreparado {
  veiculo: {
    id: string; placa: string | null; chassi: string | null; km: number;
  };
  /** De `acquisition_suppliers` (cartão "Nota de entrada"), documento normalizado. */
  vendedor: { nome: string; documento: string } | null;
  /** De `vehicle_fiscal_details` (cartão "Dados fiscais"). */
  renavam: string | null;
  valor: Prisma.Decimal | null;
  dataOperacao: Date;
  snapshot: Record<string, unknown>;
  sequencia: number;
  comprador: { fullName: string; cpf: string; email: string | null } | null;
}

/**
 * Dois cliques que passaram juntos pela checagem: o índice parcial de uma
 * saída viva por negócio, ou a sequência repetida por veículo e operação.
 */
export function traduzirUnicidade(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    return new ConflictException('Este registro acabou de ser feito por outro clique. Recarregue o cartão.');
  }
  return e;
}

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

  tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new ForbiddenException('Selecione uma concessionária para ver o RENAVE dela.');
    }
    return escopo.tenantId;
  }

  serializar(r: LinhaDoRegistro) {
    // A chave do ATPV-e no bucket não sai (a tela baixa pela API), nem o
    // snapshot: ele tem o CPF do comprador e é o que o reenvio relê, não o que
    // o cartão mostra.
    const { atpvKey, snapshot, ...resto } = r;
    void snapshot;
    return { ...resto, valor: r.valor?.toFixed(2) ?? null, temAtpv: atpvKey !== null };
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
          acquisition: {
            select: {
              id: true, origin: true, enteredAt: true, purchaseValue: true,
              supplier: { select: { fullName: true } },
            },
          },
          fiscalDetails: { select: { renavam: true } },
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

      // As notas autorizadas da compra e das vendas deste carro (trilha N, só
      // leitura). Há no máximo uma autorizada por origem — os índices únicos
      // parciais da trilha N garantem —, e cancelada não serve ao RENAVE.
      const dealIds = veiculo.deals.map((d) => d.id);
      const origens: Prisma.FiscalDocumentWhereInput[] = [];
      if (dealIds.length) origens.push({ dealId: { in: dealIds } });
      if (veiculo.acquisition) origens.push({ vehicleAcquisitionId: veiculo.acquisition.id });
      const notas = origens.length
        ? await tx.fiscalDocument.findMany({
            where: { tenantId, status: 'autorizada', chave: { not: null }, OR: origens },
            select: { dealId: true, vehicleAcquisitionId: true, chave: true, numero: true, serie: true },
          })
        : [];
      const notaDe = (n: (typeof notas)[number] | undefined) =>
        n?.chave ? { chave: n.chave, numero: n.numero, serie: n.serie } : null;

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
            /**
             * Quem vendeu, do cartão "Nota de entrada" (`acquisition_suppliers`,
             * trilha N). Só o nome: o documento a tela não precisa ver.
             */
            vendedor: veiculo.acquisition?.supplier ? { nome: veiculo.acquisition.supplier.fullName } : null,
          },
          /** Do cartão "Dados fiscais" (`vehicle_fiscal_details`, trilha N): o RENAVAM do carro. */
          renavam: veiculo.fiscalDetails?.renavam ?? null,
          /**
           * A NF-e autorizada que a tela sugere no campo da chave — da compra
           * (entrada) e de cada venda (saída). Sugestão, nunca gravação: a loja
           * pode ter enviado outra ao RENAVE, e a conferência da Fase C aponta.
           */
          notasAutorizadas: {
            entrada: notaDe(notas.find((n) => n.vehicleAcquisitionId !== null)),
            porNegocio: Object.fromEntries(
              notas.filter((n) => n.dealId).map((n) => [n.dealId!, notaDe(n)]),
            ),
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

  /**
   * Tudo o que o registro manual e o envio pela integradora têm em comum: o
   * veículo é da loja, a operação cabe na situação dele no RENAVE, o valor e a
   * data vêm da aquisição ou do negócio, e a sequência é a próxima.
   *
   * Roda dentro da transação de quem chama — a checagem e a gravação precisam
   * ver o mesmo estado.
   */
  async prepararRegistro(
    tx: ScopedClient,
    tenantId: string,
    dados: { vehicleId: string; tipo: RenaveOperacaoValue; dealId?: string; dataOperacao?: Date },
  ): Promise<RegistroPreparado> {
    const veiculo = await tx.vehicle.findFirst({
      where: { id: dados.vehicleId, tenantId },
      select: {
        id: true, licensePlate: true, vin: true, versionName: true, yearModel: true,
        yearMake: true, mileageKm: true,
        brand: { select: { name: true } },
        model: { select: { name: true } },
        // Quem vendeu e o RENAVAM vêm dos cadastros da trilha N — um dado, um
        // lugar: digitar o CPF do vendedor de novo no envio ao RENAVE é como a
        // nota e o RENAVE passam a contar histórias diferentes.
        acquisition: {
          select: {
            origin: true, purchaseValue: true, enteredAt: true,
            supplier: { select: { fullName: true, documento: true } },
          },
        },
        fiscalDetails: { select: { renavam: true } },
        renaveRegistros: {
          select: {
            id: true, tipo: true, status: true, dealId: true, chaveNfe: true,
            dataOperacao: true, createdAt: true, sequencia: true,
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
    let snapshot: Record<string, unknown> = { veiculo: snapshotDoVeiculo };
    let comprador: RegistroPreparado['comprador'] = null;

    if (ehEntrada(dados.tipo)) {
      const aq = veiculo.acquisition;
      if (dados.tipo === 'entrada_compra' && !aq) {
        throw new UnprocessableEntityException(
          'Registre a compra no custo do veículo primeiro: o valor de compra que vai ao RENAVE vem de lá.',
        );
      }
      if (aq && operacaoTemValor(dados.tipo)) valor = aq.purchaseValue;
      dataOperacao ??= aq?.enteredAt ?? null;
      if (aq?.supplier) {
        snapshot = {
          veiculo: snapshotDoVeiculo,
          vendedor: { nome: aq.supplier.fullName, documento: normalizarCnpj(aq.supplier.documento) },
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
      comprador = negocio.buyer;
      snapshot = {
        veiculo: snapshotDoVeiculo,
        comprador: negocio.buyer
          ? { nome: negocio.buyer.fullName, cpf: negocio.buyer.cpf, email: negocio.buyer.email }
          : null,
      };
    }

    const sequencia = 1 + Math.max(0, ...veiculo.renaveRegistros
      .filter((r) => r.tipo === dados.tipo)
      .map((r) => r.sequencia));

    return {
      veiculo: {
        id: veiculo.id, placa: veiculo.licensePlate, chassi: veiculo.vin,
        km: veiculo.mileageKm,
      },
      vendedor: veiculo.acquisition?.supplier
        ? { nome: veiculo.acquisition.supplier.fullName, documento: normalizarCnpj(veiculo.acquisition.supplier.documento) }
        : null,
      renavam: veiculo.fiscalDetails?.renavam ?? null,
      valor,
      dataOperacao: dataOperacao ?? new Date(),
      snapshot,
      sequencia,
      comprador,
    };
  }

  async registrar(escopo: Escopo, dados: RegistrarRenaveInput, autor: { id: string }) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const p = await this.prepararRegistro(tx, tenantId, dados);

      try {
        const criado = await tx.renaveRegistro.create({
          data: {
            tenantId,
            vehicleId: p.veiculo.id,
            dealId: dados.dealId ?? null,
            tipo: dados.tipo,
            status: dados.protocolo ? 'confirmado' : 'pendente',
            origem: 'manual',
            protocolo: dados.protocolo ?? null,
            registradoEm: dados.protocolo ? (dados.registradoEm ?? new Date()) : null,
            dataOperacao: p.dataOperacao,
            chaveNfe: dados.chaveNfe ?? null,
            valor: p.valor,
            snapshot: p.snapshot as Prisma.InputJsonValue,
            sequencia: p.sequencia,
            observacao: dados.observacao ?? null,
            createdBy: autor.id,
          },
          select: SELECAO_DO_REGISTRO,
        });
        return this.serializar(criado);
      } catch (e) {
        throw traduzirUnicidade(e);
      }
    });
  }

  /**
   * `daIntegradora`: o registro enviado pela integradora tem o estado ditado
   * por ela — anotar "confirmado" à mão seria declarar algo que ela não disse.
   * Só o serviço de integração passa `true`, depois de falar com ela.
   */
  private async exigirTransicao(
    tx: ScopedClient, tenantId: string, id: string, para: RenaveStatusValue,
    daIntegradora = false,
  ): Promise<LinhaDoRegistro> {
    const atual = await tx.renaveRegistro.findFirst({
      where: { id, tenantId }, select: SELECAO_DO_REGISTRO,
    });
    if (!atual) throw new NotFoundException('Registro RENAVE não encontrado.');
    if (atual.provider && !daIntegradora) {
      throw new ConflictException(
        'Este registro foi enviado pela integradora: o estado dele vem dela. Use "atualizar".',
      );
    }
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
  async cancelar(escopo: Escopo, id: string, dados: CancelarRenaveInput, daIntegradora = false) {
    const tenantId = this.tenantDe(escopo);
    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      await this.exigirTransicao(tx, tenantId, id, 'cancelado', daIntegradora);
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
  async informarNfe(escopo: Escopo, id: string, chaveNfe: string, daIntegradora = false) {
    const tenantId = this.tenantDe(escopo);
    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const atual = await tx.renaveRegistro.findFirst({
        where: { id, tenantId }, select: { status: true, provider: true },
      });
      if (!atual) throw new NotFoundException('Registro RENAVE não encontrado.');
      if (atual.provider && !daIntegradora) {
        throw new ConflictException('Registro da integradora: a NF-e vai por ela.');
      }
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
