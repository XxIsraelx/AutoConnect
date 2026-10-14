import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { lerChaveNfe } from '@autoconnect/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Emissão da NF-e — fase N2 do plano fiscal, com o emissor simulado.
 *
 * Em ordem de importância:
 *
 *  1. **uma nota viva por negócio** — o clique duplo não vira duas notas, e o
 *     índice do banco é quem garante;
 *  2. **nota autorizada não muda** — o trigger recusa até a conexão dona;
 *  3. o webhook só entra com o token, e a reentrega não aplica duas vezes;
 *  4. a loja B não vê, não consulta e não cancela nota da A.
 */
describe('Emissão de NF-e (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let comoGerente: string;
  let comoVendedor: string;
  let comoOutraLoja: string;
  let dealId: string;
  let dealIncompleto: string;
  let notaId: string;

  const TOKEN = 'token-de-nota-fiscal-de-teste';
  const http = () => request(app.getHttpServer());
  const rota = (c: string) => `/api/v1/fiscal${c}`;
  const get = (c: string, token = comoGerente) => http().get(rota(c)).set('Authorization', `Bearer ${token}`);
  const post = (c: string, body: object = {}, token = comoGerente) =>
    http().post(rota(c)).set('Authorization', `Bearer ${token}`).send(body);
  const put = (c: string, body: object, token = comoGerente) =>
    http().put(rota(c)).set('Authorization', `Bearer ${token}`).send(body);
  const webhook = (corpo: object, token: string | null = TOKEN) => {
    const r = http().post('/api/v1/webhooks/nota-fiscal').set('Content-Type', 'application/json');
    return (token ? r.set('x-nfe-token', token) : r).send(JSON.stringify(corpo));
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    const jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);

    const vendedor = await dono.user.create({
      data: {
        tenantId: f.a.id, email: `vend-nfe-${Date.now()}@exemplo.test`,
        fullName: 'Vendedor', role: 'salesperson', passwordHash: 'x',
      },
    });
    comoGerente = jwt.sign({ sub: f.a.usuarioId, role: 'manager', tenantId: f.a.id });
    comoVendedor = jwt.sign({ sub: vendedor.id, role: 'salesperson', tenantId: f.a.id });
    comoOutraLoja = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });

    // Loja completa, perfil do Simples em homologação, veículo com dados fiscais.
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
      where: { id: f.a.veiculoPublicoId },
      data: { vin: `9BD358A4NMYL${String(Date.now()).slice(-5)}`, licensePlate: 'ABC1D23' },
    });
    await dono.vehicleFiscalDetails.create({
      data: { vehicleId: f.a.veiculoPublicoId, tenantId: f.a.id, ncm: '87032100', renavam: '00123456789' },
    });
    await put('/perfil', { regime: 'simples_nacional', serie: 1, ambiente: 'homologacao' });
    await put('/perfil/operacoes/venda', {
      natureza: 'Venda de veículo usado', cfopInterno: '5102', cfopInterestadual: '6102',
      situacaoTributaria: '102', pisCofinsSituacaoTributaria: '07', informacoesComplementares: null,
    });

    const deal = await dono.deal.create({
      data: {
        tenantId: f.a.id, vehicleId: f.a.veiculoPublicoId, status: 'signed',
        listPrice: '50000.00', saleValue: '48500.00',
      },
    });
    dealId = deal.id;
    await dono.dealBuyer.create({
      data: {
        dealId, tenantId: f.a.id, fullName: 'Maria Compradora', cpf: '52998224725',
        addressLine: 'Rua A', addressNumber: '10', neighborhood: 'Centro',
        city: 'São Paulo', state: 'SP', postalCode: '01001000',
      },
    });

    // Rascunho, sem comprador: serve para a recusa por estado e por falta.
    const incompleto = await dono.deal.create({
      data: {
        tenantId: f.a.id, vehicleId: f.a.veiculoPrivadoId, status: 'draft',
        listPrice: '30000.00', saleValue: '30000.00',
      },
    });
    dealIncompleto = incompleto.id;
  }, 90_000);

  afterAll(async () => {
    const tenants = { in: [f.a.id, f.b.id] };
    await dono.fiscalDocumentEvent.deleteMany({ where: { tenantId: tenants } });
    await dono.fiscalDocument.deleteMany({ where: { tenantId: tenants } });
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

  it('o emissor está ligado, simulado e em homologação', async () => {
    const res = await get('/emissor');
    expect(res.body).toMatchObject({ disponivel: true, provedor: 'simulado', homologacao: true, simulado: true });
  });

  describe('antes de emitir', () => {
    it('negócio em rascunho não emite — 409', async () => {
      expect((await post(`/negocios/${dealIncompleto}/notas`)).status).toBe(409);
    });

    it('negócio assinado sem comprador emite 422 com a lista do que falta', async () => {
      await dono.deal.update({ where: { id: dealIncompleto }, data: { status: 'signed' } });
      const res = await post(`/negocios/${dealIncompleto}/notas`);
      expect(res.status).toBe(422);
      expect(res.body.faltas.map((x: { campo: string }) => x.campo))
        .toEqual(expect.arrayContaining(['contraparte.documento', 'veiculo.chassi']));
      expect(await dono.fiscalDocument.count({ where: { dealId: dealIncompleto } })).toBe(0);
    });

    it('o vendedor não emite', async () => {
      expect((await post(`/negocios/${dealId}/notas`, {}, comoVendedor)).status).toBe(403);
    });
  });

  describe('emissão e autorização', () => {
    it('emite: a nota nasce processando, com o snapshot do que foi enviado', async () => {
      const res = await post(`/negocios/${dealId}/notas`);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'processando', cfop: '5102', valorTotal: '48500.00', chave: null });
      notaId = res.body.id;
    });

    it('o segundo clique é 409 — uma nota viva por negócio', async () => {
      const res = await post(`/negocios/${dealId}/notas`);
      expect(res.status).toBe(409);
      expect(await dono.fiscalDocument.count({ where: { dealId } })).toBe(1);
    });

    it('webhook sem token ou com token errado é 401, e nada muda', async () => {
      const corpo = { id: 'forjado', evento: 'autorizada', referencia: notaId, ocorrido_em: new Date().toISOString() };
      expect((await webhook(corpo, null)).status).toBe(401);
      expect((await webhook(corpo, 'token-errado')).status).toBe(401);
      expect((await dono.fiscalDocument.findUnique({ where: { id: notaId } }))?.status).toBe('processando');
    });

    it('a SEFAZ autoriza: chave de acesso válida, número, protocolo e XML com hash', async () => {
      const res = await post(`/notas/${notaId}/simular`, { acao: 'autorizar' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'autorizada', numero: expect.any(Number), cancelamento: { pode: true } });

      const chave = lerChaveNfe(res.body.chave);
      expect(chave).toMatchObject({ uf: 'SP', documentoDoEmitente: '11222333000181', modelo: 'nfe', serie: 1 });

      const nota = await dono.fiscalDocument.findUnique({ where: { id: notaId } });
      expect(nota?.xmlSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(nota?.autorizadaEm).toBeTruthy();
    });

    it('XML e DANFE saem para download; o XML carrega a chave', async () => {
      const xml = await get(`/notas/${notaId}/xml`);
      expect(xml.status).toBe(200);
      expect(xml.headers['content-type']).toContain('application/xml');
      const nota = await dono.fiscalDocument.findUnique({ where: { id: notaId } });
      expect(xml.text).toContain(nota!.chave!);

      const danfe = await get(`/notas/${notaId}/danfe`).buffer(true);
      expect(danfe.status).toBe(200);
      expect(Buffer.from(danfe.body).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('a reentrega do mesmo webhook não aplica duas vezes', async () => {
      const nota = await dono.fiscalDocument.findUnique({ where: { id: notaId } });
      const corpo = {
        id: 'evt-reentrega', evento: 'autorizada', referencia: notaId, chave: nota!.chave,
        protocolo: nota!.protocolo, numero: nota!.numero, serie: 1, ocorrido_em: new Date().toISOString(),
      };
      const antes = await dono.fiscalDocumentEvent.count({ where: { documentId: notaId } });
      expect((await webhook(corpo)).body).toMatchObject({ recebido: true, aplicado: false });
      const segunda = await webhook(corpo);
      expect(segunda.body).toMatchObject({ recebido: true, aplicado: false, motivo: 'reentrega' });
      expect(await dono.fiscalDocumentEvent.count({ where: { documentId: notaId } })).toBe(antes + 1);
    });

    it('nota autorizada é imutável: nem a conexão dona troca chave ou volta o status', async () => {
      await expect(dono.fiscalDocument.update({
        where: { id: notaId }, data: { chave: '35261011222333000181550010000099991123456780' },
      })).rejects.toThrow(/não muda/);
      await expect(dono.fiscalDocument.update({
        where: { id: notaId }, data: { status: 'processando' },
      })).rejects.toThrow(/não existe/);
      await expect(dono.fiscalDocument.update({
        where: { id: notaId }, data: { xmlSha256: 'f'.repeat(64) },
      })).rejects.toThrow(/não são substituídos/);
    });

    it('webhook de referência desconhecida é 200 sem aplicar — a entrega é autêntica', async () => {
      const res = await webhook({
        id: 'evt-orfao', evento: 'autorizada', referencia: '00000000-0000-4000-8000-000000000000',
        ocorrido_em: new Date().toISOString(),
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ aplicado: false, motivo: 'nota-desconhecida' });
    });
  });

  describe('isolamento', () => {
    it('a loja B não lista, não consulta, não baixa e não cancela nota da A', async () => {
      expect((await get(`/negocios/${dealId}/notas`, comoOutraLoja)).status).toBe(404);
      expect((await post(`/notas/${notaId}/consultar`, {}, comoOutraLoja)).status).toBe(404);
      expect((await get(`/notas/${notaId}/xml`, comoOutraLoja)).status).toBe(404);
      const r = await post(`/notas/${notaId}/cancelar`, { justificativa: 'Tentativa de outra loja qualquer' }, comoOutraLoja);
      expect(r.status).toBe(404);
      expect((await dono.fiscalDocument.findUnique({ where: { id: notaId } }))?.status).toBe('autorizada');
    });
  });

  describe('cancelamento e nova emissão', () => {
    it('justificativa curta é 400 — a SEFAZ exige 15 caracteres', async () => {
      expect((await post(`/notas/${notaId}/cancelar`, { justificativa: 'erro' })).status).toBe(400);
    });

    it('cancela com justificativa, e a nota guarda o texto e quem pediu', async () => {
      const res = await post(`/notas/${notaId}/cancelar`, { justificativa: 'Venda desfeita a pedido do comprador' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'cancelada', justificativaDoCancelamento: 'Venda desfeita a pedido do comprador',
        cancelamento: { pode: false },
      });
      const nota = await dono.fiscalDocument.findUnique({ where: { id: notaId } });
      expect(nota?.canceladaPor).toBe(f.a.usuarioId);
    });

    it('cancelar de novo é 409', async () => {
      const res = await post(`/notas/${notaId}/cancelar`, { justificativa: 'Venda desfeita a pedido do comprador' });
      expect(res.status).toBe(409);
    });

    it('cancelada não conta como viva: emite de novo, a SEFAZ rejeita, e emite mais uma vez', async () => {
      const segunda = await post(`/negocios/${dealId}/notas`);
      expect(segunda.status).toBe(201);
      const rejeitada = await post(`/notas/${segunda.body.id}/simular`, { acao: 'rejeitar' });
      expect(rejeitada.body).toMatchObject({ status: 'rejeitada', motivo: expect.stringContaining('539') });

      const terceira = await post(`/negocios/${dealId}/notas`);
      expect(terceira.status).toBe(201);

      const lista = await get(`/negocios/${dealId}/notas`);
      expect(lista.body.map((n: { status: string }) => n.status)).toEqual(['processando', 'rejeitada', 'cancelada']);
    });

    it('perfil em produção com emissor de homologação é recusado — a nota sairia sem valor', async () => {
      await dono.fiscalDocument.updateMany({
        where: { dealId, status: 'processando' }, data: { status: 'rejeitada', motivo: 'limpeza do teste' },
      });
      await post('/perfil/confirmacao-do-contador', { nomeDoContador: 'Ana Contadora' });
      await put('/perfil', { regime: 'simples_nacional', serie: 1, ambiente: 'producao' });
      const res = await post(`/negocios/${dealId}/notas`);
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('homologação');
    });
  });
});
