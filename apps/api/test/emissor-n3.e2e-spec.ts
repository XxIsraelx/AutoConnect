import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Fase N3 com o emissor simulado: certificado, PIS/COFINS, carta de correção
 * e o webhook que autoriza sem protocolo. O adaptador da Focus tem teste
 * próprio, com `fetch` dublado (`provedor-focus.spec.ts`).
 *
 * O que importa: **o certificado não fica** — nem o arquivo, nem a senha, nem
 * na auditoria — e a carta de correção só existe em nota autorizada.
 */
describe('Emissor real e carta de correção (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let comoGerente: string;
  let comoOutraLoja: string;
  let dealId: string;
  let notaId: string;

  const SENHA = 'senha-secreta-do-pfx-123';
  const ARQUIVO = Buffer.from('conteudo-falso-de-um-pfx-'.repeat(10)).toString('base64');

  const http = () => request(app.getHttpServer());
  const rota = (c: string) => `/api/v1/fiscal${c}`;
  const get = (c: string, token = comoGerente) => http().get(rota(c)).set('Authorization', `Bearer ${token}`);
  const post = (c: string, body: object = {}, token = comoGerente) =>
    http().post(rota(c)).set('Authorization', `Bearer ${token}`).send(body);
  const put = (c: string, body: object) => http().put(rota(c)).set('Authorization', `Bearer ${comoGerente}`).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    const jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);
    comoGerente = jwt.sign({ sub: f.a.usuarioId, role: 'manager', tenantId: f.a.id });
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
      where: { id: f.a.veiculoPublicoId },
      data: { vin: `9BD358A4NMYL${String(Date.now()).slice(-5)}`, licensePlate: 'ABC1D23' },
    });
    await dono.vehicleFiscalDetails.create({
      data: { vehicleId: f.a.veiculoPublicoId, tenantId: f.a.id, ncm: '87032100', renavam: '00123456789' },
    });
    const d = await dono.deal.create({
      data: { tenantId: f.a.id, vehicleId: f.a.veiculoPublicoId, status: 'signed', listPrice: '50000.00', saleValue: '48500.00' },
    });
    dealId = d.id;
    await dono.dealBuyer.create({
      data: {
        dealId, tenantId: f.a.id, fullName: 'Maria Compradora', cpf: '52998224725',
        addressLine: 'Rua A', addressNumber: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', postalCode: '01001000',
      },
    });
  }, 90_000);

  afterAll(async () => {
    const tenants = { in: [f.a.id, f.b.id] };
    await dono.fiscalCorrectionLetter.deleteMany({ where: { tenantId: tenants } });
    await dono.fiscalDocumentEvent.deleteMany({ where: { tenantId: tenants } });
    await dono.fiscalDocument.deleteMany({ where: { tenantId: tenants } });
    await dono.dealBuyer.deleteMany({ where: { tenantId: tenants } });
    await dono.deal.deleteMany({ where: { tenantId: tenants } });
    await dono.vehicleFiscalDetails.deleteMany({ where: { tenantId: tenants } });
    await dono.fiscalOperationProfile.deleteMany({ where: { tenantId: tenants } });
    await dono.fiscalSettings.deleteMany({ where: { tenantId: tenants } });
    await dono.auditLog.deleteMany({ where: { tenantId: tenants } });
    await f?.limpar();
    await app?.close();
  });

  describe('perfil: PIS/COFINS e situações sem valor calculado', () => {
    it('sem CST de PIS/COFINS a prévia diz o que falta; com 07 a nota sai', async () => {
      await put('/perfil', { regime: 'simples_nacional', serie: 1, ambiente: 'homologacao' });
      await put('/perfil/operacoes/venda', {
        natureza: 'Venda de veículo usado', cfopInterno: '5102', cfopInterestadual: '6102',
        situacaoTributaria: '102', informacoesComplementares: null,
      });
      const sem = await get(`/negocios/${dealId}/previa`);
      expect(sem.body.faltas.map((x: { campo: string }) => x.campo)).toEqual(['perfil.pisCofinsSituacaoTributaria']);

      await put('/perfil/operacoes/venda', {
        natureza: 'Venda de veículo usado', cfopInterno: '5102', cfopInterestadual: '6102',
        situacaoTributaria: '102', pisCofinsSituacaoTributaria: '07', informacoesComplementares: null,
      });
      expect((await get(`/negocios/${dealId}/previa`)).body.nota).toMatchObject({ pisCofinsSituacaoTributaria: '07' });
    });

    it('CST de PIS/COFINS com letra é 400', async () => {
      const r = await put('/perfil/operacoes/venda', {
        natureza: 'Venda', cfopInterno: '5102', cfopInterestadual: '6102',
        situacaoTributaria: '102', pisCofinsSituacaoTributaria: 'AB', informacoesComplementares: null,
      });
      expect(r.status).toBe(400);
    });
  });

  describe('certificado A1', () => {
    it('o emissor simulado não exige certificado, e a capacidade diz isso', async () => {
      expect((await get('/emissor')).body).toMatchObject({ exigeCertificado: false, simulado: true });
    });

    it('envia: guarda validade e CNPJ, e nem o arquivo nem a senha ficam — nem na auditoria', async () => {
      const r = await post('/certificado', { arquivoBase64: ARQUIVO, senha: SENHA });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ cnpj: '11222333000181', validoAte: expect.any(String) });

      const perfil = await get('/perfil');
      expect(perfil.body.configuracao.certificado).toMatchObject({ cnpj: '11222333000181', validoAte: expect.any(String) });

      const cfg = await dono.fiscalSettings.findUnique({ where: { tenantId: f.a.id } });
      expect(cfg?.emissorConta).toBe('sim_emp_11222333000181');
      expect(JSON.stringify(cfg)).not.toContain(SENHA);
      expect(JSON.stringify(cfg)).not.toContain(ARQUIVO.slice(0, 40));

      const trilha = await dono.auditLog.findMany({ where: { tenantId: f.a.id, action: 'fiscal_certificado_enviado' } });
      expect(trilha).toHaveLength(1);
      // O `id` da auditoria é BigInt: o que importa conferir é o que foi gravado no diff.
      const gravado = JSON.stringify(trilha.map((t) => t.diff));
      expect(gravado).not.toContain(SENHA);
      expect(gravado).not.toContain(ARQUIVO.slice(0, 40));
    });

    it('arquivo que não é base64 é 400', async () => {
      expect((await post('/certificado', { arquivoBase64: 'isto não é base64 '.repeat(10), senha: SENHA })).status).toBe(400);
    });
  });

  describe('carta de correção', () => {
    it('antes da autorização, recusa', async () => {
      const r = await post(`/negocios/${dealId}/notas`, { presencial: true });
      notaId = r.body.id;
      expect(r.body.correcao).toMatchObject({ pode: false });
      const carta = await post(`/notas/${notaId}/carta-de-correcao`, { correcao: 'Cor do veículo é prata, não preta' });
      expect(carta.status).toBe(409);
    });

    it('o webhook que autoriza sem protocolo não autoriza sozinho: a consulta decide', async () => {
      const corpo = JSON.stringify({
        id: 'evt-sem-protocolo', evento: 'autorizada', referencia: notaId,
        chave: '35261011222333000181550010000012341123456787', ocorrido_em: new Date().toISOString(),
      });
      const r = await http().post('/api/v1/webhooks/nota-fiscal')
        .set('Content-Type', 'application/json').set('x-nfe-token', 'token-de-nota-fiscal-de-teste').send(corpo);
      expect(r.status).toBe(200);
      // O emissor (simulado) ainda diz "processando": nada muda, e a entrega fica na trilha.
      expect((await dono.fiscalDocument.findUnique({ where: { id: notaId } }))?.status).toBe('processando');
      expect(await dono.fiscalDocumentEvent.count({ where: { documentId: notaId, eventKey: 'evt-sem-protocolo' } })).toBe(1);
    });

    it('autorizada, aceita a carta; texto curto é 400', async () => {
      await post(`/notas/${notaId}/simular`, { acao: 'autorizar' });
      expect((await post(`/notas/${notaId}/carta-de-correcao`, { correcao: 'curta' })).status).toBe(400);

      const r = await post(`/notas/${notaId}/carta-de-correcao`, { correcao: 'Cor do veículo é prata, não preta' });
      expect(r.status).toBe(201);
      expect(r.body.correcoes).toEqual([expect.objectContaining({ status: 'autorizada', sequencia: 1 })]);

      const lista = await get(`/negocios/${dealId}/notas`);
      expect(lista.body[0].correcoes).toHaveLength(1);
    });

    it('a loja B não corrige nota da A', async () => {
      expect((await post(`/notas/${notaId}/carta-de-correcao`, { correcao: 'Tentativa de outra loja qualquer' }, comoOutraLoja)).status).toBe(404);
    });

    it('com 20 cartas autorizadas, a 21ª é recusada antes de ir à SEFAZ', async () => {
      await dono.fiscalCorrectionLetter.createMany({
        data: Array.from({ length: 19 }, (_, i) => ({
          tenantId: f.a.id, documentId: notaId, status: 'autorizada', sequencia: i + 2,
          correcao: `Correção de teste número ${i + 2}`,
        })),
      });
      const r = await post(`/notas/${notaId}/carta-de-correcao`, { correcao: 'Mais uma correção de teste' });
      expect(r.status).toBe(409);
      expect(r.body.message).toContain('20');
    });

    it('nota cancelada não recebe carta', async () => {
      await post(`/notas/${notaId}/cancelar`, { justificativa: 'Venda desfeita a pedido do comprador' });
      const r = await post(`/notas/${notaId}/carta-de-correcao`, { correcao: 'Cor do veículo é prata, não preta' });
      expect(r.status).toBe(409);
    });
  });
});
