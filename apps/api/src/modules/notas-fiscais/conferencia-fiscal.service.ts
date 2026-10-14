import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import {
  conferirOperacao, DEAL_FATURADO_STATUSES, ehEntrada, entradaDaAquisicao, normalizarDocumento,
  type NotaMontada, type NotaParaConferencia, type OperacaoParaConferir, type RenaveParaConferencia,
} from '@autoconnect/shared';
import type { periodoEmBrasilia } from './relatorio-fiscal.service';

type Periodo = ReturnType<typeof periodoEmBrasilia>;

/** Uma revenda fecha dezenas de operações por mês; o teto evita a consulta de horas. */
const TETO_DE_OPERACOES = 1000;

/**
 * A mesma história — Fase C do plano fiscal.
 *
 * Para cada carro que **saiu** (negócio faturado) ou **entrou** (aquisição) no
 * período, cruza o valor e a data da operação com a nota fiscal e com o
 * registro do RENAVE, e devolve a lista do que discorda.
 *
 * **Só lê.** Negócio, aquisição e RENAVE são das outras trilhas; a conferência
 * aponta, quem corrige é a tela de cada um. O registro do RENAVE é lido aqui
 * (`renave_registros`), nunca escrito.
 */
@Injectable()
export class ConferenciaFiscalService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new ForbiddenException('Selecione uma concessionária para conferir as notas dela.');
    }
    return escopo.tenantId;
  }

  async conferir(escopo: Escopo, { de, ateExclusivo }: Periodo) {
    const tenantId = this.tenantDe(escopo);

    const operacoes = await this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const veiculo = {
        select: {
          id: true, licensePlate: true, versionName: true,
          brand: { select: { name: true } }, model: { select: { name: true } },
        },
      } as const;

      const [negocios, aquisicoes] = await Promise.all([
        tx.deal.findMany({
          where: {
            tenantId,
            status: { in: [...DEAL_FATURADO_STATUSES] },
            closedAt: { gte: de, lt: ateExclusivo },
          },
          select: {
            id: true, closedAt: true, saleValue: true, vehicle: veiculo,
            fiscalDocuments: true,
          },
          take: TETO_DE_OPERACOES + 1,
        }),
        tx.vehicleAcquisition.findMany({
          where: { tenantId, enteredAt: { gte: de, lt: ateExclusivo } },
          select: {
            id: true, origin: true, enteredAt: true, purchaseValue: true, supplierDocument: true,
            supplier: { select: { documento: true } },
            vehicle: veiculo,
            fiscalDocuments: true,
          },
          take: TETO_DE_OPERACOES + 1,
        }),
      ]);
      if (negocios.length + aquisicoes.length > TETO_DE_OPERACOES) {
        throw new UnprocessableEntityException(
          `O período tem mais de ${TETO_DE_OPERACOES} operações. Escolha um período menor — por mês, por exemplo.`,
        );
      }

      // Os registros do RENAVE dos veículos envolvidos, numa consulta só.
      const veiculos = [...new Set([...negocios, ...aquisicoes].map((o) => o.vehicle.id))];
      const registros = veiculos.length === 0 ? [] : await tx.renaveRegistro.findMany({
        where: { tenantId, vehicleId: { in: veiculos } },
        select: {
          id: true, vehicleId: true, dealId: true, tipo: true, status: true,
          chaveNfe: true, valor: true, dataOperacao: true,
        },
      });

      const nome = (v: (typeof negocios)[number]['vehicle']) =>
        [v.brand.name, v.model.name, v.versionName, v.licensePlate].filter(Boolean).join(' ');
      const notas = (docs: (typeof negocios)[number]['fiscalDocuments']): NotaParaConferencia[] =>
        docs.map((d) => ({
          id: d.id, status: d.status, chave: d.chave,
          valorTotal: (d.snapshot as unknown as NotaMontada).valorTotal,
          autorizadaEm: d.autorizadaEm?.toISOString() ?? null, criadaEm: d.createdAt.toISOString(),
        }));
      const doRenave = (r: (typeof registros)[number]): RenaveParaConferencia => ({
        id: r.id, tipo: r.tipo, status: r.status, chaveNfe: r.chaveNfe,
        valor: r.valor?.toFixed(2) ?? null, dataOperacao: r.dataOperacao.toISOString(),
      });

      const saidas: OperacaoParaConferir[] = negocios.map((n) => ({
        tipo: 'saida',
        origemId: n.id,
        vehicleId: n.vehicle.id,
        veiculo: nome(n.vehicle),
        data: n.closedAt!.toISOString(),
        valor: n.saleValue.toFixed(2),
        notaPropriaEsperada: true,
        notas: notas(n.fiscalDocuments),
        // A saída por venda é do negócio; sem `dealId` (registro antigo), do veículo.
        renave: registros
          .filter((r) => r.tipo === 'saida_venda' && r.vehicleId === n.vehicle.id && (!r.dealId || r.dealId === n.id))
          .map(doRenave),
      }));

      const entradas: OperacaoParaConferir[] = aquisicoes.map((a) => ({
        tipo: 'entrada',
        origemId: a.id,
        vehicleId: a.vehicle.id,
        veiculo: nome(a.vehicle),
        data: a.enteredAt.toISOString(),
        valor: a.purchaseValue.toFixed(2),
        notaPropriaEsperada: entradaDaAquisicao(
          a.origin, a.supplier?.documento ?? (normalizarDocumento(a.supplierDocument) || null),
        ).precisaDeNota,
        notas: notas(a.fiscalDocuments),
        renave: registros.filter((r) => ehEntrada(r.tipo) && r.vehicleId === a.vehicle.id).map(doRenave),
      }));

      return [...saidas, ...entradas].sort((x, y) => x.data.localeCompare(y.data));
    });

    const conferidas = operacoes.map((op) => {
      const r = conferirOperacao(op);
      return {
        tipo: op.tipo,
        origem: op.tipo === 'saida'
          ? { tipo: 'negocio' as const, id: op.origemId }
          : { tipo: 'veiculo' as const, id: op.vehicleId },
        veiculo: op.veiculo,
        data: op.data,
        valor: op.valor,
        notaPropriaEsperada: op.notaPropriaEsperada,
        nota: r.nota && { status: r.nota.status, chave: r.nota.chave, valorTotal: r.nota.valorTotal },
        renave: r.renave && {
          tipo: r.renave.tipo, status: r.renave.status, chaveNfe: r.renave.chaveNfe,
          valor: r.renave.valor, dataOperacao: r.renave.dataOperacao,
        },
        divergencias: r.divergencias,
      };
    });

    return {
      resumo: {
        operacoes: conferidas.length,
        batem: conferidas.filter((c) => c.divergencias.length === 0).length,
        comDivergencia: conferidas.filter((c) => c.divergencias.some((d) => d.gravidade === 'divergencia')).length,
        comAviso: conferidas.filter((c) =>
          c.divergencias.length > 0 && c.divergencias.every((d) => d.gravidade === 'aviso')).length,
      },
      operacoes: conferidas,
    };
  }
}
