import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { GeracaoFinanceiraService } from '../src/modules/financeiro/geracao.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * A troca no financeiro — decisão do Israel em 14/10/2026: nenhuma das pontas
 * vira lançamento.
 *
 * O cliente paga parte do carro com o usado. Antes, a venda gerava uma conta a
 * receber para o usado (dinheiro que nunca entra) e a compra do usado gerava
 * uma conta a pagar (dinheiro que nunca sai) — as duas se anulavam no fluxo, e
 * corrigir só uma faria o caixa prometer uma saída que não existe. Este arquivo
 * fixa as duas pontas juntas.
 */
describe('Financeiro — venda com troca (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let prisma: PrismaService;
  let geracao: GeracaoFinanceiraService;
  let f: DoisTenants;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(m.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    prisma = app.get(PrismaService);
    geracao = app.get(GeracaoFinanceiraService, { strict: false });
    f = await criarDoisTenants(dono);
  }, 90_000);

  afterAll(async () => {
    const lojas = { in: [f.a.id, f.b.id] };
    await dono.financialEntry.deleteMany({ where: { tenantId: lojas } });
    await dono.financialCategory.deleteMany({ where: { tenantId: lojas } });
    await dono.dealPayment.deleteMany({ where: { tenantId: lojas } });
    await dono.deal.deleteMany({ where: { tenantId: lojas } });
    await dono.vehicleAcquisition.deleteMany({ where: { tenantId: lojas } });
    await f?.limpar();
    await app?.close();
  });

  const lancamentos = (filtro: Prisma.FinancialEntryWhereInput) =>
    dono.financialEntry.findMany({ where: { tenantId: f.a.id, ...filtro }, orderBy: { createdAt: 'asc' } });

  it('a venda gera conta a receber só do dinheiro — o usado da troca não entra', async () => {
    const negocio = await dono.deal.create({
      data: {
        tenantId: f.a.id, vehicleId: f.a.veiculoPublicoId, status: 'invoiced', closedAt: new Date(),
        listPrice: '50000.00', saleValue: '50000.00', discount: '0',
      },
    });
    await dono.dealPayment.createMany({
      data: [
        { tenantId: f.a.id, dealId: negocio.id, kind: 'financing', value: '30000.00', institution: 'Banco X' },
        { tenantId: f.a.id, dealId: negocio.id, kind: 'trade_in', value: '20000.00' },
      ],
    });

    const gerados = await prisma.withTenant(f.a.id, (tx) =>
      geracao.aoFaturarNegocio(tx, { id: negocio.id, tenantId: f.a.id, vehicleId: negocio.vehicleId, closedAt: negocio.closedAt }));
    expect(gerados).toBe(1);

    const doNegocio = await lancamentos({ dealId: negocio.id });
    expect(doNegocio).toHaveLength(1);
    expect(doNegocio[0]).toMatchObject({ direction: 'entrada', status: 'previsto' });
    expect(doNegocio[0]!.value.toFixed(2)).toBe('30000.00');
    // E em português, não "— financing".
    expect(doNegocio[0]!.description).toMatch(/— financiamento \(Banco X\)$/);
  });

  it('a compra do usado da troca não vira conta a pagar', async () => {
    const aq = await dono.vehicleAcquisition.create({
      data: {
        tenantId: f.a.id, vehicleId: f.a.veiculoPrivadoId, origin: 'trade_in',
        purchaseValue: '20000.00', enteredAt: new Date(),
      },
    });
    await prisma.withTenant(f.a.id, (tx) => geracao.aoRegistrarAquisicao(tx, aq));
    expect(await lancamentos({ vehicleAcquisitionId: aq.id })).toHaveLength(0);
  });

  it('compra comum gera; corrigida para troca, a conta a pagar ainda prevista é cancelada com motivo', async () => {
    const aq = await dono.vehicleAcquisition.update({
      where: { vehicleId: f.a.veiculoPrivadoId },
      data: { origin: 'direct_purchase' },
    });
    await prisma.withTenant(f.a.id, (tx) => geracao.aoRegistrarAquisicao(tx, aq));
    const [gerada] = await lancamentos({ vehicleAcquisitionId: aq.id });
    expect(gerada).toMatchObject({ direction: 'saida', status: 'previsto', description: 'Compra do veículo' });

    const corrigida = await dono.vehicleAcquisition.update({ where: { id: aq.id }, data: { origin: 'trade_in' } });
    await prisma.withTenant(f.a.id, (tx) => geracao.aoRegistrarAquisicao(tx, corrigida));
    const [depois] = await lancamentos({ vehicleAcquisitionId: aq.id });
    expect(depois).toMatchObject({ status: 'cancelado' });
    expect(depois!.cancelReason).toMatch(/troca/);
  });

  it('no fim, nada da troca promete dinheiro no caixa previsto', async () => {
    const vivos = await lancamentos({ status: 'previsto' });
    expect(vivos.map((l) => [l.direction, l.value.toFixed(2)])).toEqual([['entrada', '30000.00']]);
  });
});
