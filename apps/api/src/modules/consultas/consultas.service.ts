import {
  BadRequestException, Inject, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Prisma, type VehicleQueryKind } from '@autoconnect/db';
import {
  chaveIdempotencia, validadeDaConsulta, placaValida, chassiValido,
  normalizarPlaca, seloDeProcedencia,
  type EntradaConsulta, type FornecedorDeConsulta, type ResultadoConsulta,
  type TipoConsulta, type ConsultaStatus,
} from '@autoconnect/shared';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { FORNECEDOR_DE_CONSULTA } from './fornecedor';

@Injectable()
export class ConsultasService {
  private readonly logger = new Logger(ConsultasService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FORNECEDOR_DE_CONSULTA)
    private readonly fornecedor: FornecedorDeConsulta,
  ) {}

  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new BadRequestException('Selecione uma concessionária para consultar.');
    }
    return escopo.tenantId;
  }

  /**
   * Consulta um veículo.
   *
   * A ordem importa e é o coração desta fase: **cache antes de idempotência,
   * idempotência antes da chamada**. Cada chamada custa dinheiro, então o
   * caminho mais barato vem primeiro.
   */
  async consultar(
    escopo: Escopo,
    entrada: EntradaConsulta,
    tipo: TipoConsulta,
    vehicleId?: string,
  ) {
    const tenantId = this.tenantDe(escopo);

    if (!entrada.placa && !entrada.chassi) {
      throw new BadRequestException('Informe a placa ou o chassi.');
    }
    if (entrada.placa && !placaValida(entrada.placa)) {
      throw new BadRequestException(`Placa inválida: ${entrada.placa}`);
    }
    if (entrada.chassi && !chassiValido(entrada.chassi)) {
      throw new BadRequestException(`Chassi inválido: ${entrada.chassi}`);
    }

    const agora = new Date();
    const chave = chaveIdempotencia(tenantId, entrada, tipo, agora);
    const placa = entrada.placa ? normalizarPlaca(entrada.placa) : null;
    const chassi = entrada.chassi?.toUpperCase() ?? null;

    // ── Transação 1: decidir se vale gastar, e reservar a chamada ──────
    //
    // A chamada ao fornecedor fica **fora** da transação de propósito. Duas
    // razões, ambas custaram um teste vermelho para aparecer:
    //
    // 1. Relançar o erro de dentro de `withTenant` desfaz por rollback o
    //    próprio registro da falha — e a loja veria a cobrança na fatura sem
    //    correspondente no sistema.
    // 2. Segurar uma transação aberta durante uma ida à rede prende conexão do
    //    pool pelo tempo do fornecedor, que pode ser segundos.
    const reserva = await this.prisma.withTenant(tenantId, async (tx) => {
      // Cache: consulta bem-sucedida e ainda válida é reaproveitada.
      const valida = await tx.vehicleQuery.findFirst({
        where: {
          tenantId,
          kind: tipo as VehicleQueryKind,
          status: 'success',
          expiresAt: { gt: agora },
          ...(placa ? { plate: placa } : { vin: chassi }),
        },
        orderBy: { queriedAt: 'desc' },
      });
      if (valida) return { reaproveitada: valida };

      // Idempotência: mesmo alvo, tipo e dia já cobrados não cobram de novo,
      // mesmo que a consulta anterior tenha falhado — o fornecedor cobra a
      // tentativa, não o sucesso.
      const doDia = await tx.vehicleQuery.findUnique({ where: { idempotencyKey: chave } });
      if (doDia) return { reaproveitada: doDia };

      return {
        nova: await tx.vehicleQuery.create({
          data: {
            tenantId, vehicleId, plate: placa, vin: chassi,
            kind: tipo as VehicleQueryKind,
            status: 'pending',
            provider: this.fornecedor.nome,
            idempotencyKey: chave,
            expiresAt: validadeDaConsulta(tipo, agora),
            queriedAt: agora,
          },
        }),
      };
    });

    if (reserva.reaproveitada) return { ...reserva.reaproveitada, doCache: true };
    const registro = reserva.nova!;

    // ── Fora de transação: aqui é onde se gasta ────────────────────────
    let cru: unknown;
    let resultado: ResultadoConsulta;
    try {
      ({ cru, resultado } = await this.fornecedor.consultar(entrada, tipo));
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.warn(`Consulta ${tipo} falhou: ${msg}`);

      // Transação 2 (falha): grava a tentativa **com o custo**. O fornecedor
      // cobra a tentativa, e sem este registro o gasto some do relatório.
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.vehicleQuery.update({
          where: { id: registro.id },
          data: {
            status: 'failed',
            errorMessage: msg,
            costCents: this.fornecedor.custoCentavos,
            // Falha não fica em cache; quem segura a repetição de hoje é a
            // idempotência, e amanhã a chave muda e se tenta de novo.
            expiresAt: agora,
          },
        }),
      );
      throw e;
    }

    // ── Transação 2 (sucesso) ──────────────────────────────────────────
    const concluida = await this.prisma.withTenant(tenantId, (tx) =>
      tx.vehicleQuery.update({
        where: { id: registro.id },
        data: {
          status: 'success',
          rawResponse: cru as Prisma.InputJsonValue,
          result: resultado as unknown as Prisma.InputJsonValue,
          costCents: this.fornecedor.custoCentavos,
        },
      }),
    );

    return { ...concluida, doCache: false };
  }

  async doVeiculo(escopo: Escopo, vehicleId: string) {
    const ler = (tx: ScopedClient) =>
      tx.vehicleQuery.findMany({
        where: { vehicleId, ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }) },
        orderBy: { queriedAt: 'desc' },
      });

    if (ehGlobal(escopo)) throw new BadRequestException('Selecione uma concessionária.');
    return this.prisma.withTenant(escopo.tenantId, ler);
  }

  /** Quanto a loja gastou em consulta no período. Requisito, não enfeite. */
  async gastoDoPeriodo(escopo: Escopo, de: Date, ate: Date) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const consultas = await tx.vehicleQuery.findMany({
        where: { tenantId, queriedAt: { gte: de, lte: ate } },
        select: { kind: true, costCents: true, status: true },
      });

      const porTipo = new Map<string, { chamadas: number; centavos: number }>();
      for (const c of consultas) {
        const atual = porTipo.get(c.kind) ?? { chamadas: 0, centavos: 0 };
        atual.chamadas += 1;
        atual.centavos += c.costCents ?? 0;
        porTipo.set(c.kind, atual);
      }

      return {
        totalCentavos: consultas.reduce((a, c) => a + (c.costCents ?? 0), 0),
        chamadas: consultas.length,
        falhas: consultas.filter((c) => c.status === 'failed').length,
        porTipo: [...porTipo.entries()].map(([tipo, v]) => ({ tipo, ...v })),
      };
    });
  }

  /**
   * Selo de procedência para a página pública do veículo.
   *
   * Duas etapas de propósito. O veículo é lido por `withPublic`, que é como a
   * vitrine funciona; as consultas são lidas por `withTenant` **da própria
   * loja do veículo**, e não por `withPublic`.
   *
   * O motivo: `vehicle_queries` só tem policy de tenant. Ler por `withPublic`
   * devolveria zero linhas assim que o RLS for ligado — e o selo sumiria da
   * vitrine sem erro nenhum, o pior tipo de falha. Dar policy pública à tabela
   * seria pior ainda: ela guarda custo por chamada e resposta crua do
   * fornecedor.
   *
   * O que sai daqui é só rótulo de consulta sem alerta — nunca custo, nunca
   * resposta crua, nunca consulta que falhou.
   */
  async seloPublico(vehicleId: string) {
    const veiculo = await this.prisma.withPublic((tx) =>
      tx.vehicle.findFirst({
        where: { id: vehicleId, status: 'available' },
        select: { id: true, tenantId: true },
      }),
    );
    if (!veiculo) throw new NotFoundException('Veículo não encontrado');

    const consultas = await this.prisma.withTenant(veiculo.tenantId, (tx) =>
      tx.vehicleQuery.findMany({
        where: { vehicleId, tenantId: veiculo.tenantId },
        select: { kind: true, status: true, result: true, queriedAt: true },
        orderBy: { queriedAt: 'desc' },
      }),
    );

    // Uma consulta por tipo: a mais recente.
    const recentePorTipo = new Map<string, (typeof consultas)[number]>();
    for (const c of consultas) {
      if (!recentePorTipo.has(c.kind)) recentePorTipo.set(c.kind, c);
    }

    return seloDeProcedencia(
      [...recentePorTipo.values()].map((c) => ({
        tipo: c.kind as TipoConsulta,
        status: c.status as ConsultaStatus,
        alerta: (c.result as unknown as ResultadoConsulta | null)?.alerta ?? true,
      })),
    );
  }
}
