import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import {
  calcularComissao, CATEGORIAS_PADRAO, DEAL_FATURADO_STATUSES, mesEstaFechado,
  type CategoriaFinanceiraInput, type ContaFinanceiraInput,
  type LancamentoInput, type ListarLancamentosInput,
} from '@autoconnect/shared';
import { GeracaoFinanceiraService } from './geracao.service';

/** Quem opera o financeiro. Vendedor não vê o caixa da loja. */
export const PAPEIS_DO_FINANCEIRO = ['manager', 'tenant_admin', 'super_admin'];

interface QuemPede { id: string; role: string }

/**
 * Financeiro gerencial da loja.
 *
 * Três coisas que este arquivo não faz, de propósito:
 *
 *  1. **Não guarda saldo.** Toda pergunta de saldo é uma soma sobre
 *     `financial_entries` com `status = 'pago'`, mais o saldo inicial da conta.
 *     Coluna de saldo vira saldo errado no primeiro lançamento editado, e o
 *     lojando descobre no dia em que o banco discorda dele.
 *  2. **Não recalcula o que já tem dono.** Custo do veículo, margem e comissão
 *     vêm de `deals` e do shared; aqui eles são **referenciados** pelos vínculos
 *     do lançamento (`dealId`, `vehicleId`, `dealPaymentId`).
 *  3. **Não apaga.** Lançamento errado vira `cancelado` com motivo.
 *
 * E uma que faz: soma em `Prisma.Decimal`, nunca em `number`. É a mesma regra do
 * resto do projeto, e aqui ela é a diferença entre um caixa que fecha e um que
 * não fecha.
 */
@Injectable()
export class FinanceiroService {
  constructor(
    private readonly prisma: PrismaService,
    /** A comissão do mês fechado vira conta a pagar — ver `fecharMes`. */
    private readonly geracao: GeracaoFinanceiraService,
  ) {}

  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new ForbiddenException('Selecione uma concessionária para ver o financeiro dela.');
    }
    return escopo.tenantId;
  }

  /**
   * Recusa escrita em mês fechado **antes** de o banco recusar.
   *
   * O trigger é a rede que não tem como escapar; esta checagem é a que dá uma
   * mensagem em português e um 409 em vez de um erro de driver. A regra em si é
   * `mesEstaFechado`, no shared — a mesma que a tela usa para avisar antes de
   * enviar.
   */
  private async exigirMesAberto(tx: ScopedClient, tenantId: string, dueDate: Date): Promise<void> {
    const fechados = await tx.financialPeriod.findMany({
      where: { tenantId, reopenedAt: null },
      select: { year: true, month: true },
    });
    if (mesEstaFechado(dueDate, fechados)) {
      const mes = String(dueDate.getUTCMonth() + 1).padStart(2, '0');
      throw new ConflictException(
        `O mês ${mes}/${dueDate.getUTCFullYear()} está fechado. ` +
          'Reabra o mês para mexer em lançamento com vencimento nele.',
      );
    }
  }

  /* ── Contas ─────────────────────────────────────────────── */

  async listarContas(escopo: Escopo) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const [contas, somas] = await Promise.all([
        tx.financialAccount.findMany({ where: { tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
        // Uma consulta para todas as contas: saldo por conta num `groupBy`, e
        // não num laço por conta — a API roda a ~0,6s do banco.
        tx.financialEntry.groupBy({
          by: ['accountId', 'direction'],
          where: { tenantId, status: 'pago' },
          _sum: { value: true },
        }),
      ]);

      return contas.map((c) => {
        const entrada = somas.find((s) => s.accountId === c.id && s.direction === 'entrada')?._sum.value;
        const saida = somas.find((s) => s.accountId === c.id && s.direction === 'saida')?._sum.value;
        const saldo = new Prisma.Decimal(c.openingBalance)
          .plus(entrada ?? 0)
          .minus(saida ?? 0);

        return {
          ...this.serializarConta(c),
          /** Saldo derivado: inicial + entradas pagas − saídas pagas. */
          saldo: saldo.toFixed(2),
        };
      });
    });
  }

  async criarConta(escopo: Escopo, dados: ContaFinanceiraInput) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const jaExiste = await tx.financialAccount.findFirst({
        where: { tenantId, name: dados.name },
        select: { id: true },
      });
      if (jaExiste) {
        throw new ConflictException(`Já existe uma conta chamada "${dados.name}".`);
      }

      const conta = await tx.financialAccount.create({
        data: {
          tenantId,
          kind: dados.kind,
          name: dados.name,
          bankName: dados.bankName ?? null,
          openingBalance: new Prisma.Decimal(dados.openingBalance ?? '0'),
        },
      });
      return { ...this.serializarConta(conta), saldo: conta.openingBalance.toFixed(2) };
    });
  }

  async atualizarConta(escopo: Escopo, id: string, dados: Partial<ContaFinanceiraInput> & { active?: boolean }) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const conta = await tx.financialAccount.findFirst({ where: { id, tenantId }, select: { id: true } });
      if (!conta) throw new NotFoundException('Conta não encontrada');

      const atualizada = await tx.financialAccount.update({
        where: { id },
        data: {
          ...(dados.kind ? { kind: dados.kind } : {}),
          ...(dados.name ? { name: dados.name } : {}),
          ...(dados.bankName !== undefined ? { bankName: dados.bankName ?? null } : {}),
          ...(dados.openingBalance !== undefined
            ? { openingBalance: new Prisma.Decimal(dados.openingBalance) }
            : {}),
          ...(dados.active !== undefined ? { active: dados.active } : {}),
        },
      });
      return this.serializarConta(atualizada);
    });
  }

  private serializarConta(c: {
    id: string; kind: string; name: string; bankName: string | null;
    openingBalance: Prisma.Decimal; active: boolean;
  }) {
    return {
      id: c.id,
      kind: c.kind,
      name: c.name,
      bankName: c.bankName,
      /** Dinheiro sai como string, nunca como número — regra do projeto. */
      openingBalance: c.openingBalance.toFixed(2),
      active: c.active,
    };
  }

  /* ── Categorias ─────────────────────────────────────────── */

  async listarCategorias(escopo: Escopo) {
    const tenantId = this.tenantDe(escopo);
    return this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
      tx.financialCategory.findMany({
        where: { tenantId },
        orderBy: [{ direction: 'asc' }, { group: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  /**
   * Semeia o plano de contas mínimo.
   *
   * É rota explícita, e não escrita escondida num `GET`: a tela abre, vê que não
   * há categoria e oferece o botão. `skipDuplicates` faz de chamar duas vezes um
   * no-op — e a tela chama duas vezes, porque o lojista clica duas vezes.
   */
  async semearCategorias(escopo: Escopo) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const { count } = await tx.financialCategory.createMany({
        // Campo por campo, e não `...c`: a constante do shared usa `origemKey`
        // (português, como o resto do domínio) e a coluna é `originKey`. Espalhar
        // o objeto mandaria um campo que o Prisma não conhece e o semeio virava
        // 500 — foi assim que este teste ficou vermelho.
        data: CATEGORIAS_PADRAO.map((c) => ({
          tenantId,
          direction: c.direction,
          group: c.group,
          name: c.name,
          originKey: c.origemKey ?? null,
        })),
        skipDuplicates: true,
      });
      return { criadas: count };
    });
  }

  async criarCategoria(escopo: Escopo, dados: CategoriaFinanceiraInput) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const igual = await tx.financialCategory.findFirst({
        where: { tenantId, direction: dados.direction, name: dados.name },
        select: { id: true },
      });
      if (igual) {
        throw new ConflictException(
          `Já existe uma categoria de ${dados.direction === 'entrada' ? 'entrada' : 'saída'} chamada "${dados.name}".`,
        );
      }
      return tx.financialCategory.create({ data: { tenantId, ...dados } });
    });
  }

  async atualizarCategoria(
    escopo: Escopo,
    id: string,
    dados: { name?: string; group?: CategoriaFinanceiraInput['group']; active?: boolean },
  ) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const atual = await tx.financialCategory.findFirst({ where: { id, tenantId }, select: { id: true } });
      if (!atual) throw new NotFoundException('Categoria não encontrada');
      return tx.financialCategory.update({ where: { id }, data: dados });
    });
  }

  /* ── Lançamentos ────────────────────────────────────────── */

  async listarLancamentos(escopo: Escopo, filtros: ListarLancamentosInput) {
    const tenantId = this.tenantDe(escopo);
    const hoje = new Date();

    const where: Prisma.FinancialEntryWhereInput = {
      tenantId,
      ...(filtros.status ? { status: filtros.status } : {}),
      ...(filtros.direction ? { direction: filtros.direction } : {}),
      ...(filtros.categoryId ? { categoryId: filtros.categoryId } : {}),
      ...(filtros.branchId ? { branchId: filtros.branchId } : {}),
      ...(filtros.accountId ? { accountId: filtros.accountId } : {}),
      ...(filtros.from || filtros.to
        ? {
          dueDate: {
            ...(filtros.from ? { gte: new Date(filtros.from) } : {}),
            ...(filtros.to ? { lte: new Date(filtros.to) } : {}),
          },
        }
        : {}),
      // Atrasado é o que venceu e não foi pago — a mesma definição de
      // `estaAtrasado` no shared, aqui em forma de consulta.
      ...(filtros.atrasados ? { status: 'previsto', dueDate: { lt: hoje } } : {}),
    };

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const [itens, total, somas] = await Promise.all([
        tx.financialEntry.findMany({
          where,
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
          skip: (filtros.page - 1) * filtros.perPage,
          take: filtros.perPage,
          include: {
            category: { select: { id: true, name: true, group: true, direction: true } },
            account: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        }),
        tx.financialEntry.count({ where }),
        // O total da consulta inteira, não o da página: a soma no topo da tela
        // precisa responder pelo filtro, e somar a página enganaria.
        tx.financialEntry.groupBy({ by: ['direction'], where, _sum: { value: true } }),
      ]);

      return {
        itens: itens.map((e) => this.serializarLancamento(e, hoje)),
        total,
        page: filtros.page,
        perPage: filtros.perPage,
        somaEntradas: (somas.find((s) => s.direction === 'entrada')?._sum.value ?? new Prisma.Decimal(0)).toFixed(2),
        somaSaidas: (somas.find((s) => s.direction === 'saida')?._sum.value ?? new Prisma.Decimal(0)).toFixed(2),
      };
    });
  }

  /**
   * Cria o lançamento — e a série, quando é repetido.
   *
   * A `direction` vem da **categoria**, nunca do corpo: deixar o chamador
   * escolher permitiria uma despesa lançada como entrada, que é um saldo errado
   * que ninguém descobre olhando a lista.
   */
  async criarLancamento(escopo: Escopo, dados: LancamentoInput, quem: QuemPede) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const categoria = await tx.financialCategory.findFirst({
        where: { id: dados.categoryId, tenantId },
        select: { id: true, direction: true, active: true },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada');
      if (!categoria.active) {
        throw new BadRequestException('Esta categoria está desativada. Escolha outra ou reative-a.');
      }

      if (dados.accountId) {
        const conta = await tx.financialAccount.findFirst({
          where: { id: dados.accountId, tenantId },
          select: { id: true },
        });
        if (!conta) throw new NotFoundException('Conta não encontrada');
      }
      if (dados.branchId) {
        const filial = await tx.dealershipBranch.findFirst({
          where: { id: dados.branchId, tenantId },
          select: { id: true },
        });
        if (!filial) throw new NotFoundException('Filial não encontrada');
      }

      const base = {
        tenantId,
        direction: categoria.direction,
        value: new Prisma.Decimal(dados.value),
        categoryId: categoria.id,
        accountId: dados.accountId ?? null,
        branchId: dados.branchId ?? null,
        description: dados.description,
        supplierName: dados.supplierName ?? null,
        documentNumber: dados.documentNumber ?? null,
        notes: dados.notes ?? null,
        createdBy: quem.id,
      };

      const vencimento = new Date(dados.dueDate);
      const meses = dados.repetirMeses ?? 1;
      // Cada parcela da série tem o seu mês: uma repetição de 12 meses que
      // atravessa um mês fechado precisa dizer isso antes de gravar metade.
      for (let i = 0; i < meses; i++) {
        const due = new Date(vencimento);
        due.setUTCMonth(due.getUTCMonth() + i);
        await this.exigirMesAberto(tx, tenantId, due);
      }
      // Série com fim, sempre: repetição infinita é lixo acumulando no banco e um
      // fluxo de caixa que promete 2040.
      const recurrenceId = meses > 1 ? crypto.randomUUID() : null;

      const linhas = Array.from({ length: meses }, (_, i) => {
        const due = new Date(vencimento);
        due.setUTCMonth(due.getUTCMonth() + i);
        return {
          ...base,
          dueDate: due,
          recurrenceId,
          // Só a primeira nasce paga: as próximas são promessa.
          ...(i === 0 && dados.paidAt
            ? { status: 'pago' as const, paidAt: new Date(dados.paidAt) }
            : {}),
        };
      });

      await tx.financialEntry.createMany({ data: linhas });

      const criados = await tx.financialEntry.findMany({
        where: recurrenceId ? { recurrenceId } : { tenantId, createdBy: quem.id },
        orderBy: { dueDate: 'asc' },
        ...(recurrenceId ? {} : { take: 1, orderBy: { createdAt: 'desc' } }),
        include: { category: { select: { id: true, name: true, group: true, direction: true } } },
      });

      return {
        criados: criados.length,
        recurrenceId,
        lancamentos: criados.map((e) => this.serializarLancamento(e, new Date())),
      };
    });
  }

  async atualizarLancamento(escopo: Escopo, id: string, dados: Record<string, unknown>) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const atual = await tx.financialEntry.findFirst({ where: { id, tenantId } });
      if (!atual) throw new NotFoundException('Lançamento não encontrado');
      if (atual.status === 'cancelado') {
        throw new ConflictException('Lançamento cancelado não volta atrás. Crie outro no lugar.');
      }

      await this.exigirMesAberto(tx, tenantId, atual.dueDate);
      if (dados.dueDate !== undefined) {
        // Mudar o vencimento para dentro de um mês fechado move resultado de um
        // mês conferido — recusado nas duas pontas.
        await this.exigirMesAberto(tx, tenantId, new Date(String(dados.dueDate)));
      }

      const data: Prisma.FinancialEntryUpdateInput = {};
      if (dados.value !== undefined) data.value = new Prisma.Decimal(String(dados.value));
      if (dados.dueDate !== undefined) data.dueDate = new Date(String(dados.dueDate));
      if (dados.description !== undefined) data.description = String(dados.description);
      for (const campo of ['supplierName', 'documentNumber', 'notes'] as const) {
        if (dados[campo] !== undefined) data[campo] = dados[campo] === null ? null : String(dados[campo]);
      }
      if (dados.categoryId !== undefined) {
        const categoria = await tx.financialCategory.findFirst({
          where: { id: String(dados.categoryId), tenantId },
          select: { id: true, direction: true },
        });
        if (!categoria) throw new NotFoundException('Categoria não encontrada');
        data.category = { connect: { id: categoria.id } };
        // A direção acompanha a categoria: trocar a categoria de uma despesa para
        // uma receita sem mudar a direção deixaria a linha mentindo.
        data.direction = categoria.direction;
      }
      if (dados.accountId !== undefined) {
        data.account = dados.accountId === null
          ? { disconnect: true }
          : { connect: { id: String(dados.accountId) } };
      }
      if (dados.branchId !== undefined) {
        data.branch = dados.branchId === null
          ? { disconnect: true }
          : { connect: { id: String(dados.branchId) } };
      }

      const atualizado = await tx.financialEntry.update({
        where: { id },
        data,
        include: { category: { select: { id: true, name: true, group: true, direction: true } } },
      });
      return this.serializarLancamento(atualizado, new Date());
    });
  }

  /** Baixa: a promessa vira fato, com data e conta. */
  async darBaixa(escopo: Escopo, id: string, dados: { accountId: string; paidAt?: string }) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const atual = await tx.financialEntry.findFirst({ where: { id, tenantId } });
      if (!atual) throw new NotFoundException('Lançamento não encontrado');
      if (atual.status === 'cancelado') {
        throw new ConflictException('Lançamento cancelado não recebe baixa.');
      }
      if (atual.status === 'pago') {
        // Idempotente de propósito: dois cliques no botão não podem virar dois
        // pagamentos, e o segundo não é erro do usuário.
        return this.serializarLancamento(atual, new Date());
      }

      await this.exigirMesAberto(tx, tenantId, atual.dueDate);

      const conta = await tx.financialAccount.findFirst({
        where: { id: dados.accountId, tenantId },
        select: { id: true },
      });
      if (!conta) throw new NotFoundException('Conta não encontrada');

      const pago = await tx.financialEntry.update({
        where: { id },
        data: {
          status: 'pago',
          paidAt: dados.paidAt ? new Date(dados.paidAt) : new Date(),
          accountId: conta.id,
        },
        include: { category: { select: { id: true, name: true, group: true, direction: true } } },
      });

      // Baixa na conta a receber confirma a forma de pagamento no negócio.
      //
      // O negócio é a verdade sobre a venda e o financeiro espelha — mas quem
      // recebeu o dinheiro dá baixa **uma vez**, no lugar em que está olhando.
      // Pedir a mesma confirmação nas duas telas é como as duas começam a
      // divergir. A condição no `where` faz disto idempotente: já confirmado, é
      // no-op.
      if (atual.dealPaymentId) {
        await tx.dealPayment.updateMany({
          where: { id: atual.dealPaymentId, tenantId, status: 'pending' },
          data: { status: 'confirmed', confirmedAt: pago.paidAt ?? new Date() },
        });
      }

      return this.serializarLancamento(pago, new Date());
    });
  }

  /** Cancelar, nunca apagar: a linha fica, com o porquê. */
  async cancelarLancamento(escopo: Escopo, id: string, motivo: string) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const atual = await tx.financialEntry.findFirst({ where: { id, tenantId } });
      if (!atual) throw new NotFoundException('Lançamento não encontrado');
      if (atual.status === 'cancelado') return this.serializarLancamento(atual, new Date());
      await this.exigirMesAberto(tx, tenantId, atual.dueDate);

      const cancelado = await tx.financialEntry.update({
        where: { id },
        data: {
          status: 'cancelado',
          canceledAt: new Date(),
          cancelReason: motivo,
          // A baixa some junto: cancelado não é pago, e deixar `paidAt` faria o
          // CHECK de coerência mentir sobre o que aconteceu.
          paidAt: null,
        },
        include: { category: { select: { id: true, name: true, group: true, direction: true } } },
      });
      return this.serializarLancamento(cancelado, new Date());
    });
  }

  private serializarLancamento(
    e: {
      id: string; direction: string; status: string; value: Prisma.Decimal;
      dueDate: Date; paidAt: Date | null; description: string;
      supplierName: string | null; documentNumber: string | null; notes: string | null;
      accountId: string | null; categoryId: string; branchId: string | null;
      dealId: string | null; vehicleId: string | null; dealPaymentId: string | null;
      recurrenceId: string | null; cancelReason: string | null;
      category?: { id: string; name: string; group: string; direction: string };
      account?: { id: string; name: string } | null;
      branch?: { id: string; name: string } | null;
    },
    hoje: Date,
  ) {
    const venceu = e.status === 'previsto' && diaDe(e.dueDate) < diaDe(hoje);
    return {
      id: e.id,
      direction: e.direction,
      status: e.status,
      value: e.value.toFixed(2),
      dueDate: e.dueDate.toISOString(),
      paidAt: e.paidAt?.toISOString() ?? null,
      description: e.description,
      supplierName: e.supplierName,
      documentNumber: e.documentNumber,
      notes: e.notes,
      categoria: e.category ?? null,
      conta: e.account ?? null,
      filial: e.branch ?? null,
      origem: e.dealId || e.vehicleId || e.dealPaymentId
        ? { dealId: e.dealId, vehicleId: e.vehicleId, dealPaymentId: e.dealPaymentId }
        : null,
      recurrenceId: e.recurrenceId,
      cancelReason: e.cancelReason,
      /** Calculado aqui para a tela não repetir a regra de atraso. */
      atrasado: venceu,
    };
  }

  /* ── Resumo ─────────────────────────────────────────────── */

  /**
   * A tela de abertura do financeiro: as quatro perguntas do dono da loja.
   *
   * Cinco consultas agrupadas, nunca um laço: saldo por conta, o que vence em 7
   * dias, o que está atrasado, e o realizado do mês corrente.
   */
  async resumo(escopo: Escopo) {
    const tenantId = this.tenantDe(escopo);
    const hoje = new Date();
    const em7dias = new Date(hoje.getTime() + 7 * 86_400_000);
    const inicioDoMes = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const [contas, pagosPorConta, aVencer, atrasado, doMes] = await Promise.all([
        tx.financialAccount.findMany({
          where: { tenantId, active: true },
          select: { id: true, name: true, kind: true, openingBalance: true },
          orderBy: { name: 'asc' },
        }),
        tx.financialEntry.groupBy({
          by: ['accountId', 'direction'],
          where: { tenantId, status: 'pago' },
          _sum: { value: true },
        }),
        tx.financialEntry.groupBy({
          by: ['direction'],
          where: { tenantId, status: 'previsto', dueDate: { gte: hoje, lte: em7dias } },
          _sum: { value: true },
          _count: { _all: true },
        }),
        tx.financialEntry.groupBy({
          by: ['direction'],
          where: { tenantId, status: 'previsto', dueDate: { lt: hoje } },
          _sum: { value: true },
          _count: { _all: true },
        }),
        tx.financialEntry.groupBy({
          by: ['direction'],
          where: { tenantId, status: 'pago', paidAt: { gte: inicioDoMes } },
          _sum: { value: true },
        }),
      ]);

      const soma = (
        grupos: { direction: string; _sum: { value: Prisma.Decimal | null } }[],
        direcao: 'entrada' | 'saida',
      ) => (grupos.find((g) => g.direction === direcao)?._sum.value ?? new Prisma.Decimal(0));

      const quantos = (
        grupos: { direction: string; _count?: { _all: number } }[],
        direcao: 'entrada' | 'saida',
      ) => grupos.find((g) => g.direction === direcao)?._count?._all ?? 0;

      const saldos = contas.map((c) => {
        const entrada = pagosPorConta.find((s) => s.accountId === c.id && s.direction === 'entrada')?._sum.value;
        const saida = pagosPorConta.find((s) => s.accountId === c.id && s.direction === 'saida')?._sum.value;
        return {
          contaId: c.id,
          nome: c.name,
          kind: c.kind,
          saldo: new Prisma.Decimal(c.openingBalance).plus(entrada ?? 0).minus(saida ?? 0).toFixed(2),
        };
      });

      const total = saldos.reduce((t, s) => t.plus(s.saldo), new Prisma.Decimal(0));
      const recebidoNoMes = soma(doMes, 'entrada');
      const pagoNoMes = soma(doMes, 'saida');

      return {
        saldoTotal: total.toFixed(2),
        contas: saldos,
        proximos7Dias: {
          aReceber: soma(aVencer, 'entrada').toFixed(2),
          aPagar: soma(aVencer, 'saida').toFixed(2),
          quantidade: quantos(aVencer, 'entrada') + quantos(aVencer, 'saida'),
        },
        atrasado: {
          aReceber: soma(atrasado, 'entrada').toFixed(2),
          aPagar: soma(atrasado, 'saida').toFixed(2),
          quantidade: quantos(atrasado, 'entrada') + quantos(atrasado, 'saida'),
        },
        mesCorrente: {
          recebido: recebidoNoMes.toFixed(2),
          pago: pagoNoMes.toFixed(2),
          resultado: recebidoNoMes.minus(pagoNoMes).toFixed(2),
        },
        /** Sem categoria, a tela oferece semear o plano de contas. */
        temCategorias: (await tx.financialCategory.count({ where: { tenantId } })) > 0,
      };
    });
  }

  /* ── Fluxo de caixa ─────────────────────────────────────── */

  /**
   * O caixa dia a dia, daqui para frente.
   *
   * Responde a pergunta que o dono faz toda semana e que nenhuma outra tela
   * responde: **em que dia o caixa fica negativo**. O saldo de hoje vem dos
   * lançamentos pagos; a partir daí, cada dia soma o que vence nele.
   *
   * O **atrasado entra no primeiro dia**, e não some: quem não pagou ainda deve,
   * e um fluxo que ignora o vencido promete um caixa que não existe.
   *
   * A soma acontece em memória, sobre a janela pedida (no máximo 180 dias),
   * porque `groupBy` não agrupa por dia truncado — e uma janela dessas é da
   * ordem de centenas de linhas, não de milhares.
   */
  async fluxoDeCaixa(escopo: Escopo, dias: number) {
    const tenantId = this.tenantDe(escopo);
    const hoje = diaDe(new Date());
    const fim = new Date(hoje.getTime() + dias * 86_400_000);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const [contas, pagos, previstos] = await Promise.all([
        tx.financialAccount.findMany({
          where: { tenantId, active: true },
          select: { openingBalance: true },
        }),
        tx.financialEntry.groupBy({
          by: ['direction'],
          where: { tenantId, status: 'pago' },
          _sum: { value: true },
        }),
        tx.financialEntry.findMany({
          where: { tenantId, status: 'previsto', dueDate: { lte: fim } },
          select: { direction: true, value: true, dueDate: true },
          orderBy: { dueDate: 'asc' },
        }),
      ]);

      const inicial = contas.reduce((t, c) => t.plus(c.openingBalance), new Prisma.Decimal(0));
      const entrou = pagos.find((p) => p.direction === 'entrada')?._sum.value ?? new Prisma.Decimal(0);
      const saiu = pagos.find((p) => p.direction === 'saida')?._sum.value ?? new Prisma.Decimal(0);
      const saldoHoje = inicial.plus(entrou).minus(saiu);

      const porDia = new Map<string, { entradas: Prisma.Decimal; saidas: Prisma.Decimal }>();
      for (const p of previstos) {
        // Vencido entra no primeiro dia da série: ele já devia ter acontecido.
        const dia = diaDe(p.dueDate) < hoje ? hoje : diaDe(p.dueDate);
        const chave = dia.toISOString().slice(0, 10);
        const atual = porDia.get(chave)
          ?? { entradas: new Prisma.Decimal(0), saidas: new Prisma.Decimal(0) };
        if (p.direction === 'entrada') atual.entradas = atual.entradas.plus(p.value);
        else atual.saidas = atual.saidas.plus(p.value);
        porDia.set(chave, atual);
      }

      let saldo = saldoHoje;
      let primeiroDiaNegativo: string | null = null;
      const serie: {
        dia: string; entradas: string; saidas: string; saldo: string;
      }[] = [];

      for (let i = 0; i <= dias; i++) {
        const chave = new Date(hoje.getTime() + i * 86_400_000).toISOString().slice(0, 10);
        const doDia = porDia.get(chave) ?? { entradas: new Prisma.Decimal(0), saidas: new Prisma.Decimal(0) };
        saldo = saldo.plus(doDia.entradas).minus(doDia.saidas);
        if (primeiroDiaNegativo === null && saldo.lessThan(0)) primeiroDiaNegativo = chave;
        serie.push({
          dia: chave,
          entradas: doDia.entradas.toFixed(2),
          saidas: doDia.saidas.toFixed(2),
          saldo: saldo.toFixed(2),
        });
      }

      return {
        saldoHoje: saldoHoje.toFixed(2),
        dias,
        /** `null` quando o caixa não fica negativo na janela — a boa notícia. */
        primeiroDiaNegativo,
        serie,
      };
    });
  }

  /* ── DRE gerencial ──────────────────────────────────────── */

  /**
   * O resultado do mês, no critério que a revenda entende.
   *
   * **Aqui mora a decisão mais delicada do módulo: o que somar sem contar duas
   * vezes.** A receita e o custo do veículo vêm do **negócio faturado** (a mesma
   * `vehicleCostSnapshot` que a margem congela), e não dos lançamentos de compra
   * e preparação — que são o *caixa* da mesma coisa. Somar os dois seria contar o
   * carro duas vezes.
   *
   * Por isso as despesas do mês excluem o grupo `veiculos`: o que sobra é a
   * operação (aluguel, pessoal, marketing, impostos, tarifas), que não está em
   * lugar nenhum do negócio.
   *
   * É gerencial e por **competência da venda**: a linha do mês é a venda que
   * fechou nele, mesmo que o dinheiro entre em três parcelas. Quem quiser o
   * caixa do mês olha o fluxo, que é a outra pergunta.
   */
  async dre(escopo: Escopo, year: number, month: number) {
    const tenantId = this.tenantDe(escopo);
    const inicio = new Date(Date.UTC(year, month - 1, 1));
    const fim = new Date(Date.UTC(year, month, 1));

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const [vendas, despesas, outrasReceitas] = await Promise.all([
        tx.deal.aggregate({
          where: {
            tenantId,
            status: { in: [...DEAL_FATURADO_STATUSES] as never[] },
            closedAt: { gte: inicio, lt: fim },
          },
          _sum: { saleValue: true, vehicleCostSnapshot: true },
          _count: { _all: true },
        }),
        tx.financialEntry.findMany({
          where: {
            tenantId, direction: 'saida', status: 'pago',
            paidAt: { gte: inicio, lt: fim },
            category: { group: { not: 'veiculos' } },
          },
          select: { value: true, category: { select: { group: true, name: true } } },
        }),
        tx.financialEntry.aggregate({
          where: {
            tenantId, direction: 'entrada', status: 'pago',
            paidAt: { gte: inicio, lt: fim },
            category: { originKey: { not: 'venda_de_veiculo' } },
          },
          _sum: { value: true },
        }),
      ]);

      const receita = vendas._sum.saleValue ?? new Prisma.Decimal(0);
      const cmv = vendas._sum.vehicleCostSnapshot ?? new Prisma.Decimal(0);
      const outras = outrasReceitas._sum.value ?? new Prisma.Decimal(0);

      const porGrupo = new Map<string, Prisma.Decimal>();
      for (const d of despesas) {
        const grupo = d.category.group;
        porGrupo.set(grupo, (porGrupo.get(grupo) ?? new Prisma.Decimal(0)).plus(d.value));
      }
      const totalDespesas = [...porGrupo.values()]
        .reduce((t, v) => t.plus(v), new Prisma.Decimal(0));

      const margemBruta = receita.minus(cmv);
      const resultado = margemBruta.plus(outras).minus(totalDespesas);

      return {
        periodo: { year, month },
        negociosFaturados: vendas._count._all,
        receitaDeVeiculos: receita.toFixed(2),
        custoDosVeiculosVendidos: cmv.toFixed(2),
        margemBruta: margemBruta.toFixed(2),
        outrasReceitas: outras.toFixed(2),
        despesasPorGrupo: [...porGrupo.entries()]
          .map(([grupo, valor]) => ({ grupo, valor: valor.toFixed(2) }))
          .sort((a, b) => Number(b.valor) - Number(a.valor)),
        totalDeDespesas: totalDespesas.toFixed(2),
        resultado: resultado.toFixed(2),
      };
    });
  }

  /* ── Fechamento de mês ──────────────────────────────────── */

  async listarPeriodos(escopo: Escopo) {
    const tenantId = this.tenantDe(escopo);
    return this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
      tx.financialPeriod.findMany({
        where: { tenantId, reopenedAt: null },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        select: { id: true, year: true, month: true, closedAt: true, closedBy: true },
      }),
    );
  }

  async fecharMes(escopo: Escopo, year: number, month: number, quem: QuemPede) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const aberto = await tx.financialPeriod.findFirst({ where: { tenantId, year, month } });
      if (aberto && !aberto.reopenedAt) {
        throw new ConflictException(`O mês ${String(month).padStart(2, '0')}/${year} já está fechado.`);
      }

      // Fechar mês com conta a pagar vencida e sem baixa esconde dívida: o mês
      // fecha, mas quem fecha precisa ver o que ficou para trás.
      const pendentes = await tx.financialEntry.count({
        where: {
          tenantId, status: 'previsto',
          dueDate: {
            gte: new Date(Date.UTC(year, month - 1, 1)),
            lt: new Date(Date.UTC(year, month, 1)),
          },
        },
      });

      // A comissão do mês é apurada **antes** da trava: ela vence no mês
      // seguinte, mas nasce do que foi faturado neste. Fechar o mês é o momento
      // em que a loja sabe quanto deve a cada vendedor.
      const comissoes = await this.gerarComissoesDoMes(tx, tenantId, year, month);

      const periodo = aberto
        ? await tx.financialPeriod.update({
          where: { id: aberto.id },
          data: { closedAt: new Date(), closedBy: quem.id, reopenedAt: null, reopenReason: null },
        })
        : await tx.financialPeriod.create({
          data: { tenantId, year, month, closedBy: quem.id },
        });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: quem.id,
          action: 'financial_period_closed',
          entityType: 'financial_period',
          entityId: periodo.id,
          diff: { year, month, pendentesNoMes: pendentes, comissoesGeradas: comissoes },
        },
      });

      return {
        id: periodo.id, year, month,
        closedAt: periodo.closedAt.toISOString(),
        pendentesNoMes: pendentes,
        comissoesGeradas: comissoes,
      };
    });
  }

  async reabrirMes(escopo: Escopo, year: number, month: number, motivo: string, quem: QuemPede) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const periodo = await tx.financialPeriod.findFirst({ where: { tenantId, year, month, reopenedAt: null } });
      if (!periodo) {
        throw new NotFoundException(`O mês ${String(month).padStart(2, '0')}/${year} não está fechado.`);
      }
      await tx.financialPeriod.update({
        where: { id: periodo.id },
        data: { reopenedAt: new Date(), reopenReason: motivo },
      });

      // Reabrir mês fechado é a ação que mais precisa de rastro: alguém vai
      // perguntar, meses depois, por que o resultado de março mudou.
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: quem.id,
          action: 'financial_period_reopened',
          entityType: 'financial_period',
          entityId: periodo.id,
          diff: { year, month, motivo },
        },
      });

      return { reaberto: true, year, month };
    });
  }

  /**
   * A comissão do mês vira conta a pagar, uma por vendedor.
   *
   * **A conta é `calcularComissao`, a mesma de `/equipe`, `/relatorios` e do
   * detalhe do negócio.** Não há uma segunda fórmula aqui: duas cópias já deram
   * R$ 1.950,00 numa tela e R$ 147,50 na outra para a mesma pessoa, e o
   * financeiro seria a terceira.
   *
   * Vence no dia 5 do mês seguinte — mês aberto, portanto, senão o lançamento
   * nasceria travado pelo próprio fechamento que o gerou.
   *
   * Idempotente pelo `documentNumber`: fechar o mesmo mês de novo (depois de
   * reabrir) não cria a segunda comissão do mesmo vendedor.
   */
  private async gerarComissoesDoMes(
    tx: ScopedClient,
    tenantId: string,
    year: number,
    month: number,
  ): Promise<number> {
    const inicio = new Date(Date.UTC(year, month - 1, 1));
    const fim = new Date(Date.UTC(year, month, 1));

    const negocios = await tx.deal.findMany({
      where: {
        tenantId,
        status: { in: [...DEAL_FATURADO_STATUSES] as never[] },
        closedAt: { gte: inicio, lt: fim },
        salespersonId: { not: null },
      },
      select: { salespersonId: true, saleValue: true },
    });
    if (negocios.length === 0) return 0;

    const porVendedor = new Map<string, Prisma.Decimal>();
    for (const n of negocios) {
      const id = n.salespersonId!;
      porVendedor.set(id, (porVendedor.get(id) ?? new Prisma.Decimal(0)).plus(n.saleValue));
    }

    const perfis = await tx.salespersonProfile.findMany({
      where: { userId: { in: [...porVendedor.keys()] } },
      select: { userId: true, commissionPct: true, user: { select: { fullName: true } } },
    });

    const categoryId = await this.geracao.categoriaDe(tx, tenantId, 'comissao');
    const vencimento = new Date(Date.UTC(year, month, 5));
    let criadas = 0;

    for (const perfil of perfis) {
      const base = porVendedor.get(perfil.userId);
      const valor = base ? calcularComissao(base.toFixed(2), perfil.commissionPct?.toFixed(2) ?? null) : null;
      // Sem percentual no perfil não há comissão a pagar — e "ninguém informou
      // quanto ela ganha" não é zero, é ausência. Não se inventa lançamento.
      if (!valor || Number(valor) === 0) continue;

      const documento = `comissao:${year}-${String(month).padStart(2, '0')}:${perfil.userId}`;
      const jaExiste = await tx.financialEntry.findFirst({
        where: { tenantId, documentNumber: documento },
        select: { id: true },
      });
      if (jaExiste) continue;

      await tx.financialEntry.create({
        data: {
          tenantId,
          direction: 'saida',
          status: 'previsto',
          value: new Prisma.Decimal(valor),
          dueDate: vencimento,
          description: `Comissão de ${perfil.user.fullName} — ${String(month).padStart(2, '0')}/${year}`,
          supplierName: perfil.user.fullName,
          documentNumber: documento,
          notes: `Percentual do perfil sobre ${base!.toFixed(2)} de vendas faturadas no mês.`,
          categoryId,
        },
      });
      criadas += 1;
    }

    return criadas;
  }
}

/** Meia-noite em UTC — o mesmo corte de `estaAtrasado` no shared. */
function diaDe(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
