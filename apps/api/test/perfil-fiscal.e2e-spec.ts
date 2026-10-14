import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Perfil fiscal da loja — fase N1 do plano fiscal.
 *
 * Em ordem de importância:
 *
 *  1. a confirmação do contador **não sobrevive** a uma mudança no perfil — é
 *     ela que libera a emissão em produção, e confirmação de um perfil que
 *     ninguém conferiu é o pior defeito possível aqui;
 *  2. o perfil e os dados fiscais da loja B não aparecem para a A;
 *  3. o vendedor não mexe no perfil fiscal;
 *  4. a prévia de um negócio diz tudo o que falta, e monta a nota quando nada
 *     falta — com a mesma regra pura que a emissão vai usar.
 */
describe('Perfil fiscal (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let comoGerente: string;
  let comoVendedor: string;
  let comoOutraLoja: string;
  let dealId: string;

  const http = () => request(app.getHttpServer());
  const rota = (c: string) => `/api/v1/fiscal${c}`;
  const get = (c: string, token = comoGerente) => http().get(rota(c)).set('Authorization', `Bearer ${token}`);
  const post = (c: string, body: object, token = comoGerente) =>
    http().post(rota(c)).set('Authorization', `Bearer ${token}`).send(body);
  const put = (c: string, body: object, token = comoGerente) =>
    http().put(rota(c)).set('Authorization', `Bearer ${token}`).send(body);

  const operacaoDeVenda = {
    natureza: 'Venda de veículo usado',
    cfopInterno: '5102',
    cfopInterestadual: '6102',
    situacaoTributaria: '102',
    pisCofinsSituacaoTributaria: '07',
    informacoesComplementares: null,
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
        tenantId: f.a.id, email: `vend-fiscal-${Date.now()}@exemplo.test`,
        fullName: 'Vendedor', role: 'salesperson', passwordHash: 'x',
      },
    });
    comoGerente = jwt.sign({ sub: f.a.usuarioId, role: 'manager', tenantId: f.a.id });
    comoVendedor = jwt.sign({ sub: vendedor.id, role: 'salesperson', tenantId: f.a.id });
    comoOutraLoja = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });

    // O negócio da prévia: veículo sem chassi e sem dados fiscais, comprador
    // sem endereço — o teste preenche aos poucos e vê a lista encolher.
    const deal = await dono.deal.create({
      data: {
        tenantId: f.a.id, vehicleId: f.a.veiculoPublicoId, status: 'signed',
        listPrice: '50000.00', saleValue: '48500.00',
      },
    });
    dealId = deal.id;
  }, 90_000);

  afterAll(async () => {
    const tenants = { in: [f.a.id, f.b.id] };
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

  describe('perfil', () => {
    it('a loja começa sem perfil, e as seis operações vêm com a sugestão', async () => {
      const res = await get('/perfil');
      expect(res.status).toBe(200);
      expect(res.body.configuracao).toBeNull();
      expect(res.body.operacoes).toHaveLength(6);
      expect(res.body.operacoes[0]).toMatchObject({
        operacao: 'venda', direcao: 'saida', perfil: null,
        sugestao: { cfopInterno: '5102', cfopInterestadual: '6102' },
      });
    });

    it('operação antes do regime é 409 — sem regime não dá para saber se é CST ou CSOSN', async () => {
      const res = await put('/perfil/operacoes/venda', operacaoDeVenda);
      expect(res.status).toBe(409);
    });

    it('salva o regime e semeia as operações, de forma idempotente e sem situação tributária', async () => {
      expect((await put('/perfil', { regime: 'simples_nacional', serie: 1, ambiente: 'homologacao' })).status).toBe(200);

      const primeira = await post('/perfil/operacoes/padrao', {});
      expect(primeira.status).toBe(201);
      expect(primeira.body.criadas).toBe(6);
      expect((await post('/perfil/operacoes/padrao', {})).body.criadas).toBe(0);

      const perfil = await get('/perfil');
      expect(perfil.body.configuracao).toMatchObject({ regime: 'simples_nacional', usaCsosn: true });
      for (const op of perfil.body.operacoes) expect(op.perfil.situacaoTributaria).toBeNull();
    });

    it('CFOP de entrada numa saída e CST num perfil do Simples voltam como erro de campo', async () => {
      const res = await put('/perfil/operacoes/venda', {
        ...operacaoDeVenda, cfopInterno: '1102', situacaoTributaria: '00',
      });
      expect(res.status).toBe(400);
      expect(res.body.errors.map((e: { field: string }) => e.field).sort())
        .toEqual(['cfopInterno', 'situacaoTributaria']);
    });

    it('operação que não existe é 404; campo a mais é 400', async () => {
      expect((await put('/perfil/operacoes/doacao', operacaoDeVenda)).status).toBe(404);
      expect((await put('/perfil/operacoes/venda', { ...operacaoDeVenda, aliquota: '18' })).status).toBe(400);
    });

    it('confirmar com operação sem situação tributária é recusado, e diz quais', async () => {
      await put('/perfil/operacoes/venda', operacaoDeVenda);
      const res = await post('/perfil/confirmacao-do-contador', { nomeDoContador: 'Ana Contadora' });
      expect(res.status).toBe(422);
      expect(res.body.message).toContain('Compra de particular');
      expect(res.body.message).not.toContain('Venda de veículo');
    });
  });

  describe('confirmação do contador', () => {
    const completarTodas = async () => {
      const perfil = await get('/perfil');
      for (const op of perfil.body.operacoes as { operacao: string; sugestao: Record<string, string> }[]) {
        const res = await put(`/perfil/operacoes/${op.operacao}`, {
          ...op.sugestao, situacaoTributaria: op.operacao === 'venda' ? '102' : '900', pisCofinsSituacaoTributaria: '07',
          informacoesComplementares: null,
        });
        expect(res.status).toBe(200);
      }
    };

    it('confirma com o perfil completo, e registra quem e de qual contador', async () => {
      await completarTodas();
      const res = await post('/perfil/confirmacao-do-contador', { nomeDoContador: 'Ana Contadora', crc: 'SP-123456' });
      expect(res.status).toBe(201);
      expect(res.body.configuracao).toMatchObject({ contadorNome: 'Ana Contadora', contadorCrc: 'SP-123456' });
      expect(res.body.configuracao.contadorConfirmouEm).toBeTruthy();

      const trilha = await dono.auditLog.findFirst({
        where: { tenantId: f.a.id, action: 'fiscal_confirmado_pelo_contador' },
      });
      expect(trilha?.actorUserId).toBe(f.a.usuarioId);
    });

    it('salvar a operação sem mudar nada não apaga a confirmação', async () => {
      await put('/perfil/operacoes/venda', operacaoDeVenda);
      expect((await get('/perfil')).body.configuracao.contadorConfirmouEm).toBeTruthy();
    });

    it('mudar uma operação apaga a confirmação — o contador não conferiu o que veio depois', async () => {
      await put('/perfil/operacoes/compra_de_particular', {
        natureza: 'Compra de veículo usado', cfopInterno: '1102', cfopInterestadual: '2102',
        situacaoTributaria: '101', pisCofinsSituacaoTributaria: '07', informacoesComplementares: null,
      });
      const perfil = await get('/perfil');
      expect(perfil.body.configuracao.contadorConfirmouEm).toBeNull();
      expect(perfil.body.configuracao.contadorNome).toBeNull();
    });

    it('mudar o regime também apaga', async () => {
      await post('/perfil/confirmacao-do-contador', { nomeDoContador: 'Ana Contadora' });
      await put('/perfil', { regime: 'lucro_presumido', serie: 1, ambiente: 'homologacao' });
      expect((await get('/perfil')).body.configuracao.contadorConfirmouEm).toBeNull();
      // Volta ao Simples para o resto do arquivo: as operações têm CSOSN.
      await put('/perfil', { regime: 'simples_nacional', serie: 1, ambiente: 'homologacao' });
    });
  });

  describe('isolamento e papéis', () => {
    it('a loja B não vê o perfil da A', async () => {
      const res = await get('/perfil', comoOutraLoja);
      expect(res.status).toBe(200);
      expect(res.body.configuracao).toBeNull();
      expect(res.body.operacoes.every((o: { perfil: unknown }) => o.perfil === null)).toBe(true);
    });

    it('a loja B não lê nem grava dados fiscais de veículo da A', async () => {
      expect((await get(`/veiculos/${f.a.veiculoPublicoId}`, comoOutraLoja)).status).toBe(404);
      const res = await put(`/veiculos/${f.a.veiculoPublicoId}`, { ncm: '87032100', renavam: null, origem: 0 }, comoOutraLoja);
      expect(res.status).toBe(404);
      expect(await dono.vehicleFiscalDetails.count({ where: { vehicleId: f.a.veiculoPublicoId } })).toBe(0);
    });

    it('a loja B não vê a prévia do negócio da A', async () => {
      expect((await get(`/negocios/${dealId}/previa`, comoOutraLoja)).status).toBe(404);
    });

    it('o vendedor não entra no fiscal', async () => {
      expect((await get('/perfil', comoVendedor)).status).toBe(403);
      expect((await put('/perfil', { regime: 'mei', serie: 1, ambiente: 'producao' }, comoVendedor)).status).toBe(403);
    });
  });

  describe('prévia da nota do negócio', () => {
    it('diz o que falta, cada coisa com o lugar onde se corrige', async () => {
      const res = await get(`/negocios/${dealId}/previa`);
      expect(res.status).toBe(200);
      expect(res.body.operacao).toBe('venda');
      expect(res.body.nota).toBeNull();
      const campos = res.body.faltas.map((x: { onde: string; campo: string }) => `${x.onde}:${x.campo}`);
      expect(campos).toEqual(expect.arrayContaining([
        'loja:emitente.cnpj', 'loja:emitente.inscricaoEstadual', 'loja:emitente.endereco',
        'contraparte:contraparte.documento', 'veiculo:veiculo.chassi', 'veiculo:veiculo.ncm',
      ]));
    });

    it('com a loja, o comprador e o veículo completos, monta a nota de venda', async () => {
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
        data: { vin: `9BD358A4NMYL${String(Date.now()).slice(-5)}`, licensePlate: 'ABC1D23', color: 'prata' },
      });
      expect((await put(`/veiculos/${f.a.veiculoPublicoId}`, {
        ncm: '8703.21.00', renavam: '123456789', origem: 0,
      })).body).toEqual({ ncm: '87032100', renavam: '00123456789', origem: 0 });
      await dono.dealBuyer.create({
        data: {
          dealId, tenantId: f.a.id, fullName: 'Maria Compradora', cpf: '52998224725',
          addressLine: 'Rua A', addressNumber: '10', neighborhood: 'Savassi',
          city: 'Belo Horizonte', state: 'MG', postalCode: '30000000',
        },
      });

      const balcao = await get(`/negocios/${dealId}/previa`);
      expect(balcao.body.faltas).toEqual([]);
      expect(balcao.body.nota).toMatchObject({
        cfop: '5102', destino: 'interna', crt: 1, situacaoTributaria: '102', valorTotal: '48500.00',
        contraparte: { tipoDeDocumento: 'cpf', documento: '52998224725' },
        item: { ncm: '87032100', renavam: '00123456789' },
      });

      // Comprador de Minas que recebe o carro em casa: interestadual.
      const entrega = await get(`/negocios/${dealId}/previa?presencial=false`);
      expect(entrega.body.nota).toMatchObject({ cfop: '6102', destino: 'interestadual' });
    });

    it('em produção sem confirmação do contador, a prévia diz isso', async () => {
      await put('/perfil', { regime: 'simples_nacional', serie: 1, ambiente: 'producao' });
      const res = await get(`/negocios/${dealId}/previa`);
      expect(res.body.nota).toBeNull();
      expect(res.body.faltas).toEqual([expect.objectContaining({ campo: 'configuracao.contadorConfirmouEm' })]);
    });
  });
});
