import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Nota de entrada — fase N2b do plano fiscal.
 *
 * Em ordem de importância:
 *
 *  1. **a loja só emite quando do outro lado não há quem emita** — fornecedor
 *     pessoa jurídica, leilão, transferência e 0 km chegam com nota de outro;
 *  2. quem entregou o veículo começa preenchido com o que a aquisição tem, e o
 *     documento é a regra dura;
 *  3. uma nota de entrada viva por aquisição, e cada nota com uma origem só;
 *  4. a loja B não vê nem grava quem entregou o carro da A.
 */
describe('Nota de entrada (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let comoGerente: string;
  let comoVendedor: string;
  let comoOutraLoja: string;
  let veiculo: string;
  let aquisicaoId: string;

  const http = () => request(app.getHttpServer());
  const rota = (c: string) => `/api/v1/fiscal${c}`;
  const get = (c: string, token = comoGerente) => http().get(rota(c)).set('Authorization', `Bearer ${token}`);
  const post = (c: string, body: object = {}, token = comoGerente) =>
    http().post(rota(c)).set('Authorization', `Bearer ${token}`).send(body);
  const put = (c: string, body: object, token = comoGerente) =>
    http().put(rota(c)).set('Authorization', `Bearer ${token}`).send(body);

  const joao = {
    fullName: 'João Vendedor Particular',
    documento: '529.982.247-25',
    addressLine: 'Rua das Flores', addressNumber: '45', neighborhood: 'Centro',
    city: 'Campinas', state: 'sp', postalCode: '13010-000',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    const jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);
    veiculo = f.a.veiculoPublicoId;

    const vendedor = await dono.user.create({
      data: {
        tenantId: f.a.id, email: `vend-entrada-${Date.now()}@exemplo.test`,
        fullName: 'Vendedor', role: 'salesperson', passwordHash: 'x',
      },
    });
    comoGerente = jwt.sign({ sub: f.a.usuarioId, role: 'manager', tenantId: f.a.id });
    comoVendedor = jwt.sign({ sub: vendedor.id, role: 'salesperson', tenantId: f.a.id });
    comoOutraLoja = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });

    await dono.tenant.update({
      where: { id: f.a.id }, data: { taxId: '11222333000181', stateRegistration: '110042490114' },
    });
    await dono.dealershipBranch.update({
      where: { id: f.a.filialId },
      data: {
        isHeadquarters: true, addressLine: 'Av. Brasil', addressNumber: '1000',
        neighborhood: 'Centro', city: 'São Paulo', state: 'SP', postalCode: '01000000',
      },
    });
    await dono.vehicle.update({
      where: { id: veiculo },
      data: { vin: `9BD358A4NMYL${String(Date.now()).slice(-5)}`, licensePlate: 'XYZ9A87' },
    });
    await dono.vehicleFiscalDetails.create({
      data: { vehicleId: veiculo, tenantId: f.a.id, ncm: '87032100', renavam: '00987654321' },
    });
    await put('/perfil', { regime: 'simples_nacional', serie: 1, ambiente: 'homologacao' });
    await post('/perfil/operacoes/padrao');
    await put('/perfil/operacoes/compra_de_particular', {
      natureza: 'Compra de veículo usado para revenda', cfopInterno: '1102', cfopInterestadual: '2102',
      situacaoTributaria: '900', pisCofinsSituacaoTributaria: '07', informacoesComplementares: null,
    });
  }, 90_000);

  afterAll(async () => {
    const tenants = { in: [f.a.id, f.b.id] };
    await dono.fiscalDocumentEvent.deleteMany({ where: { tenantId: tenants } });
    await dono.fiscalDocument.deleteMany({ where: { tenantId: tenants } });
    await dono.acquisitionSupplier.deleteMany({ where: { tenantId: tenants } });
    await dono.vehicleAcquisition.deleteMany({ where: { tenantId: tenants } });
    await dono.deal.deleteMany({ where: { tenantId: tenants } });
    await dono.vehicleFiscalDetails.deleteMany({ where: { tenantId: tenants } });
    await dono.fiscalOperationProfile.deleteMany({ where: { tenantId: tenants } });
    await dono.fiscalSettings.deleteMany({ where: { tenantId: tenants } });
    await dono.auditLog.deleteMany({ where: { tenantId: tenants } });
    await dono.user.deleteMany({ where: { tenantId: f.a.id, role: 'salesperson' } });
    await f?.limpar();
    await app?.close();
  });

  describe('sem aquisição', () => {
    it('não há quem entregou, nem prévia, nem emissão', async () => {
      expect((await get(`/veiculos/${veiculo}/quem-entregou`)).body).toMatchObject({ aquisicao: null, entrada: null });
      expect((await get(`/veiculos/${veiculo}/entrada/previa`)).body).toMatchObject({ temAquisicao: false, nota: null });
      expect((await post(`/veiculos/${veiculo}/entrada/notas`)).status).toBe(409);
      expect((await put(`/veiculos/${veiculo}/quem-entregou`, joao)).status).toBe(409);
    });
  });

  describe('compra de particular', () => {
    beforeAll(async () => {
      const a = await dono.vehicleAcquisition.create({
        data: {
          tenantId: f.a.id, vehicleId: veiculo, origin: 'direct_purchase',
          supplierName: 'João do cadastro rápido', purchaseValue: '42000.00', enteredAt: new Date(),
        },
      });
      aquisicaoId = a.id;
    });

    it('quem entregou começa com o nome que a aquisição tem, e a entrada pede nota nossa', async () => {
      const res = await get(`/veiculos/${veiculo}/quem-entregou`);
      expect(res.body).toMatchObject({
        salvo: false,
        aquisicao: { origem: 'direct_purchase', valor: '42000.00' },
        quemEntregou: { fullName: 'João do cadastro rápido', documento: '' },
        entrada: { precisaDeNota: true, operacao: 'compra_de_particular' },
      });
    });

    it('a prévia diz que falta o documento e o endereço de quem entregou', async () => {
      const res = await get(`/veiculos/${veiculo}/entrada/previa`);
      expect(res.body.nota).toBeNull();
      expect(res.body.faltas.map((x: { campo: string }) => x.campo))
        .toEqual(expect.arrayContaining(['contraparte.documento', 'contraparte.endereco']));
    });

    it('CPF inválido é erro de campo; o válido salva normalizado', async () => {
      const ruim = await put(`/veiculos/${veiculo}/quem-entregou`, { ...joao, documento: '111.111.111-11' });
      expect(ruim.status).toBe(400);
      expect(ruim.body.errors[0].field).toBe('documento');

      const ok = await put(`/veiculos/${veiculo}/quem-entregou`, joao);
      expect(ok.status).toBe(200);
      expect(ok.body.quemEntregou).toMatchObject({ documento: '52998224725', state: 'SP', postalCode: '13010000' });
    });

    it('fornecedor pessoa jurídica (até alfanumérico) não gera nota nossa', async () => {
      await put(`/veiculos/${veiculo}/quem-entregou`, { ...joao, documento: '12.ABC.345/01DE-35' });
      const previa = await get(`/veiculos/${veiculo}/entrada/previa`);
      expect(previa.body.semNotaPropria).toContain('pessoa jurídica');
      const emitir = await post(`/veiculos/${veiculo}/entrada/notas`);
      expect(emitir.status).toBe(409);
      expect(emitir.body.message).toContain('pessoa jurídica');
      await put(`/veiculos/${veiculo}/quem-entregou`, joao);
    });

    it('emite a nota de entrada: CFOP 1102, remetente e valor da compra', async () => {
      const res = await post(`/veiculos/${veiculo}/entrada/notas`);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'processando', operacao: 'compra_de_particular', cfop: '1102',
        valorTotal: '42000.00', destinatario: 'João Vendedor Particular',
      });

      const segunda = await post(`/veiculos/${veiculo}/entrada/notas`);
      expect(segunda.status).toBe(409);
      expect(segunda.body.message).toContain('Esta aquisição');

      const autorizada = await post(`/notas/${res.body.id}/simular`, { acao: 'autorizar' });
      expect(autorizada.body).toMatchObject({ status: 'autorizada', chave: expect.stringMatching(/^35\d{4}11222333000181/) });

      const lista = await get(`/veiculos/${veiculo}/entrada/notas`);
      expect(lista.body.map((n: { status: string }) => n.status)).toEqual(['autorizada']);
    });

    it('a nota tem exatamente uma origem — o banco recusa negócio e aquisição juntos', async () => {
      const deal = await dono.deal.create({
        data: { tenantId: f.a.id, vehicleId: veiculo, status: 'signed', listPrice: '1.00', saleValue: '1.00' },
      });
      await expect(dono.fiscalDocument.create({
        data: {
          tenantId: f.a.id, dealId: deal.id, vehicleAcquisitionId: aquisicaoId,
          operation: 'venda', provider: 'simulado', ambiente: 'homologacao', snapshot: {},
        },
      })).rejects.toThrow(/fiscal_documents_uma_origem/);
    });

    it('leilão não gera nota nossa, e a prévia diz de quem é', async () => {
      await dono.vehicleAcquisition.update({ where: { id: aquisicaoId }, data: { origin: 'auction' } });
      const res = await get(`/veiculos/${veiculo}/entrada/previa`);
      expect(res.body.semNotaPropria).toContain('leiloeiro');
      await dono.vehicleAcquisition.update({ where: { id: aquisicaoId }, data: { origin: 'direct_purchase' } });
    });
  });

  describe('isolamento e papéis', () => {
    it('a loja B não lê nem grava quem entregou o carro da A, nem as notas dele', async () => {
      expect((await get(`/veiculos/${veiculo}/quem-entregou`, comoOutraLoja)).status).toBe(404);
      expect((await put(`/veiculos/${veiculo}/quem-entregou`, joao, comoOutraLoja)).status).toBe(404);
      expect((await get(`/veiculos/${veiculo}/entrada/notas`, comoOutraLoja)).status).toBe(404);
      expect((await post(`/veiculos/${veiculo}/entrada/notas`, {}, comoOutraLoja)).status).toBe(404);
    });

    it('o vendedor não entra', async () => {
      expect((await get(`/veiculos/${veiculo}/quem-entregou`, comoVendedor)).status).toBe(403);
    });
  });
});
