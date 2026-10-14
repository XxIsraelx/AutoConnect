import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

const hoje = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

/**
 * A mesma história — Fase C do plano fiscal, com as duas trilhas na `main`.
 *
 * Três operações no mês: uma venda em que estoque, nota e RENAVE batem; uma
 * venda em que o RENAVE diz outro valor e não tem a chave da nota; e uma compra
 * de particular sem nota nem RENAVE. A conferência tem de dizer exatamente isso
 * — e não olhar o negócio que ainda não foi faturado.
 */
describe('Conferência fiscal (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let comoGerente: string;
  let comoVendedor: string;
  let comoOutraLoja: string;
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const rota = (c: string) => `/api/v1/fiscal${c}`;
  const get = (c: string, token = comoGerente) => http().get(rota(c)).set('Authorization', `Bearer ${token}`);
  const post = (c: string, body: object = {}) =>
    http().post(rota(c)).set('Authorization', `Bearer ${comoGerente}`).send(body);
  const put = (c: string, body: object) => http().put(rota(c)).set('Authorization', `Bearer ${comoGerente}`).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    const jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);

    const vendedor = await dono.user.create({
      data: { tenantId: f.a.id, email: `vend-conf-${Date.now()}@exemplo.test`, fullName: 'Vendedor', role: 'salesperson', passwordHash: 'x' },
    });
    comoGerente = jwt.sign({ sub: f.a.usuarioId, role: 'manager', tenantId: f.a.id });
    comoVendedor = jwt.sign({ sub: vendedor.id, role: 'salesperson', tenantId: f.a.id });
    comoOutraLoja = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });

    await dono.tenant.update({ where: { id: f.a.id }, data: { taxId: '11222333000181', stateRegistration: '110042490114' } });
    await dono.dealershipBranch.update({
      where: { id: f.a.filialId },
      data: {
        isHeadquarters: true, addressLine: 'Av. Brasil', addressNumber: '1000',
        neighborhood: 'Centro', city: 'São Paulo', state: 'SP', postalCode: '01000000',
      },
    });
    await put('/perfil', { regime: 'simples_nacional', serie: 1, ambiente: 'homologacao' });
    await put('/perfil/operacoes/venda', {
      natureza: 'Venda de veículo usado', cfopInterno: '5102', cfopInterestadual: '6102',
      situacaoTributaria: '102', pisCofinsSituacaoTributaria: '07', informacoesComplementares: null,
    });

    const terceiro = await dono.vehicle.create({
      data: { tenantId: f.a.id, brandId: f.marcaId, modelId: f.modeloId, yearModel: 2021, yearMake: 2021, price: '40000', status: 'available' },
    });
    const sufixo = String(Date.now()).slice(-5);
    const veiculos = [f.a.veiculoPublicoId, f.a.veiculoPrivadoId, terceiro.id];
    for (const [i, v] of veiculos.entries()) {
      await dono.vehicle.update({ where: { id: v }, data: { vin: `9BD358A4NMZ${i}${sufixo}`, licensePlate: `CNF1D2${i}` } });
      await dono.vehicleFiscalDetails.create({ data: { vehicleId: v, tenantId: f.a.id, ncm: '87032100', renavam: `0012345670${i}` } });
    }

    // Duas vendas faturadas hoje, cada uma com a nota autorizada pelo emissor simulado.
    const agora = new Date();
    for (const [chave, v, valor] of [['bate', veiculos[0]!, '82500.00'], ['diverge', veiculos[1]!, '61000.00']] as const) {
      const d = await dono.deal.create({
        data: { tenantId: f.a.id, vehicleId: v, status: 'invoiced', listPrice: valor, saleValue: valor, closedAt: agora },
      });
      await dono.dealBuyer.create({
        data: {
          dealId: d.id, tenantId: f.a.id, fullName: 'Maria Compradora', cpf: '52998224725',
          addressLine: 'Rua A', addressNumber: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', postalCode: '01001000',
        },
      });
      const nota = await post(`/negocios/${d.id}/notas`);
      await post(`/notas/${nota.body.id}/simular`, { acao: 'autorizar' });
      ids[chave] = d.id;
      ids[`nota-${chave}`] = nota.body.id;
    }
    const chaveDa = async (id: string) => (await dono.fiscalDocument.findUnique({ where: { id } }))!.chave!;

    // RENAVE: a venda que bate tem tudo igual; a que diverge tem outro valor e nenhuma chave.
    await dono.renaveRegistro.create({
      data: {
        tenantId: f.a.id, vehicleId: veiculos[0]!, dealId: ids.bate!, tipo: 'saida_venda', status: 'confirmado',
        protocolo: 'RNV-1', registradoEm: agora, dataOperacao: agora, valor: '82500.00', sequencia: 1,
        chaveNfe: await chaveDa(ids['nota-bate']!),
      },
    });
    await dono.renaveRegistro.create({
      data: {
        tenantId: f.a.id, vehicleId: veiculos[1]!, dealId: ids.diverge!, tipo: 'saida_venda', status: 'confirmado',
        protocolo: 'RNV-2', registradoEm: agora, dataOperacao: agora, valor: '63000.00', sequencia: 1,
      },
    });

    // Uma compra de particular hoje, sem nota e sem RENAVE.
    const aq = await dono.vehicleAcquisition.create({
      data: { tenantId: f.a.id, vehicleId: terceiro.id, origin: 'direct_purchase', purchaseValue: '40000.00', enteredAt: agora },
    });
    await dono.acquisitionSupplier.create({
      data: { acquisitionId: aq.id, tenantId: f.a.id, fullName: 'João Particular', documento: '52998224725' },
    });
    ids.compra = aq.id;

    // E um negócio ainda não faturado, que a conferência não pode olhar.
    const naoFaturado = await dono.deal.create({
      data: { tenantId: f.a.id, vehicleId: terceiro.id, status: 'signed', listPrice: '40000', saleValue: '40000' },
    });
    ids.naoFaturado = naoFaturado.id;
  }, 120_000);

  afterAll(async () => {
    const tenants = { in: [f.a.id, f.b.id] };
    await dono.renaveRegistro.deleteMany({ where: { tenantId: tenants } });
    await dono.fiscalDocumentEvent.deleteMany({ where: { tenantId: tenants } });
    await dono.fiscalDocument.deleteMany({ where: { tenantId: tenants } });
    await dono.acquisitionSupplier.deleteMany({ where: { tenantId: tenants } });
    await dono.vehicleAcquisition.deleteMany({ where: { tenantId: tenants } });
    await dono.dealBuyer.deleteMany({ where: { tenantId: tenants } });
    await dono.deal.deleteMany({ where: { tenantId: tenants } });
    await dono.vehicleFiscalDetails.deleteMany({ where: { tenantId: tenants } });
    await dono.fiscalOperationProfile.deleteMany({ where: { tenantId: tenants } });
    await dono.fiscalSettings.deleteMany({ where: { tenantId: tenants } });
    await dono.auditLog.deleteMany({ where: { tenantId: tenants } });
    await dono.user.deleteMany({ where: { tenantId: f.a.id, role: 'salesperson' } });
    await f?.limpar();
    await app?.close();
  });

  it('confere as três operações do mês e diz o que discorda em cada uma', async () => {
    const res = await get(`/conferencia?from=${hoje()}&to=${hoje()}`);
    expect(res.status).toBe(200);
    expect(res.body.resumo).toEqual({ operacoes: 3, batem: 1, comDivergencia: 1, comAviso: 1 });

    const por = (id: string) => res.body.operacoes.find((o: { origem: { id: string } }) => o.origem.id === id);
    expect(por(ids.bate!)).toMatchObject({ tipo: 'saida', divergencias: [], nota: { status: 'autorizada' }, renave: { status: 'confirmado' } });

    const diverge = por(ids.diverge!);
    const chave = (await dono.fiscalDocument.findUnique({ where: { id: ids['nota-diverge']! } }))!.chave;
    expect(diverge.divergencias.map((d: { codigo: string }) => d.codigo)).toEqual(['valor_no_renave', 'chave_ausente_no_renave']);
    expect(diverge.divergencias[1].sugestao).toBe(chave);

    const compra = res.body.operacoes.find((o: { tipo: string }) => o.tipo === 'entrada');
    expect(compra).toMatchObject({ notaPropriaEsperada: true, nota: null, renave: null });
    expect(compra.divergencias.map((d: { codigo: string }) => d.codigo)).toEqual(['sem_nota', 'sem_renave']);

    expect(res.body.operacoes.map((o: { origem: { id: string } }) => o.origem.id)).not.toContain(ids.naoFaturado);
  });

  it('fora do período, nada', async () => {
    const res = await get('/conferencia?from=2026-01-01&to=2026-01-31');
    expect(res.body.resumo.operacoes).toBe(0);
  });

  it('a loja B não vê a conferência da A; o vendedor não entra', async () => {
    const b = await get(`/conferencia?from=${hoje()}&to=${hoje()}`, comoOutraLoja);
    expect(b.status).toBe(200);
    expect(b.body.operacoes).toEqual([]);
    expect((await get(`/conferencia?from=${hoje()}&to=${hoje()}`, comoVendedor)).status).toBe(403);
  });
});
