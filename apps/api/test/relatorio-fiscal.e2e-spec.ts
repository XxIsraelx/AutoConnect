import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { inflateRawSync } from 'zlib';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/** Leitor mínimo de ZIP, para conferir o pacote como o contador o abriria. */
function lerZip(zip: Buffer): Map<string, Buffer> {
  const fim = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const saida = new Map<string, Buffer>();
  for (let i = 0; i < total; i++) {
    const tamanho = zip.readUInt32LE(p + 20);
    const nomeLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const nome = zip.subarray(p + 46, p + 46 + nomeLen).toString('utf8');
    const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    saida.set(nome, inflateRawSync(zip.subarray(inicio, inicio + tamanho)));
    p += 46 + nomeLen;
  }
  return saida;
}

const hoje = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

/**
 * A ponte com o contador — fase N4 do plano fiscal.
 *
 * O que importa: **nenhuma nota do período fica fora do pacote em silêncio**.
 * A que tem XML vai com o XML; a que não tem vai para o LEIA-ME com o motivo;
 * a rejeitada sem substituta aparece como pendente.
 */
describe('Relatório e pacote fiscal (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let comoGerente: string;
  let comoVendedor: string;
  let comoOutraLoja: string;
  const notas: Record<string, string> = {};
  let dealRejeitado: string;

  const http = () => request(app.getHttpServer());
  const rota = (c: string) => `/api/v1/fiscal${c}`;
  const get = (c: string, token = comoGerente) => http().get(rota(c)).set('Authorization', `Bearer ${token}`);
  const post = (c: string, body: object = {}, token = comoGerente) =>
    http().post(rota(c)).set('Authorization', `Bearer ${token}`).send(body);
  const put = (c: string, body: object) =>
    http().put(rota(c)).set('Authorization', `Bearer ${token()}`).send(body);
  const token = () => comoGerente;
  const periodo = () => `from=${hoje()}&to=${hoje()}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    const jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);

    const vendedor = await dono.user.create({
      data: {
        tenantId: f.a.id, email: `vend-rel-${Date.now()}@exemplo.test`,
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
    await put('/perfil', { regime: 'simples_nacional', serie: 1, ambiente: 'homologacao' });
    await post('/perfil/operacoes/padrao');
    for (const [op, st] of [['venda', '102'], ['compra_de_particular', '900']] as const) {
      const def = (await get('/perfil')).body.operacoes.find((o: { operacao: string }) => o.operacao === op).sugestao;
      await put(`/perfil/operacoes/${op}`, { ...def, situacaoTributaria: st, informacoesComplementares: null });
    }

    // Três veículos completos: venda autorizada, venda cancelada, venda rejeitada.
    const sufixo = String(Date.now()).slice(-5);
    const veiculos = [f.a.veiculoPublicoId, f.a.veiculoPrivadoId];
    const terceiro = await dono.vehicle.create({
      data: {
        tenantId: f.a.id, brandId: f.marcaId, modelId: f.modeloId, yearModel: 2021, yearMake: 2021,
        price: '40000', status: 'available',
      },
    });
    veiculos.push(terceiro.id);
    const deals: string[] = [];
    for (const [i, v] of veiculos.entries()) {
      await dono.vehicle.update({ where: { id: v }, data: { vin: `9BD358A4NMY${i}${sufixo}`, licensePlate: `ABC1D2${i}` } });
      await dono.vehicleFiscalDetails.create({ data: { vehicleId: v, tenantId: f.a.id, ncm: '87032100', renavam: `0012345678${i}` } });
      const d = await dono.deal.create({
        data: { tenantId: f.a.id, vehicleId: v, status: 'signed', listPrice: '50000.00', saleValue: `${50000 + i * 1000}.00` },
      });
      await dono.dealBuyer.create({
        data: {
          dealId: d.id, tenantId: f.a.id, fullName: `Comprador ${i}`, cpf: '52998224725',
          addressLine: 'Rua A', addressNumber: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', postalCode: '01001000',
        },
      });
      deals.push(d.id);
    }
    dealRejeitado = deals[2]!;

    // Entrada: compra de particular no primeiro veículo.
    const aq = await dono.vehicleAcquisition.create({
      data: { tenantId: f.a.id, vehicleId: veiculos[0]!, origin: 'direct_purchase', purchaseValue: '42000.00', enteredAt: new Date() },
    });
    await dono.acquisitionSupplier.create({
      data: {
        acquisitionId: aq.id, tenantId: f.a.id, fullName: 'João Particular', documento: '52998224725',
        addressLine: 'Rua B', addressNumber: '5', neighborhood: 'Centro', city: 'Campinas', state: 'SP', postalCode: '13010000',
      },
    });

    const emitir = async (url: string, acao: 'autorizar' | 'rejeitar') => {
      const r = await post(url);
      expect(r.status).toBe(201);
      await post(`/notas/${r.body.id}/simular`, { acao });
      return r.body.id as string;
    };
    notas.venda = await emitir(`/negocios/${deals[0]}/notas`, 'autorizar');
    notas.cancelada = await emitir(`/negocios/${deals[1]}/notas`, 'autorizar');
    await post(`/notas/${notas.cancelada}/cancelar`, { justificativa: 'Venda desfeita a pedido do comprador' });
    notas.rejeitada = await emitir(`/negocios/${dealRejeitado}/notas`, 'rejeitar');
    notas.entrada = await emitir(`/veiculos/${veiculos[0]}/entrada/notas`, 'autorizar');

    // Uma nota autorizada que o emissor não conhece (outra instalação, ou o
    // emissor fora do ar): o XML não vem, e o pacote tem de dizer isso.
    const orfa = await dono.fiscalDocument.create({
      data: {
        // No negócio da venda autorizada, e não no da rejeitada: lá ela seria
        // uma "substituta" e resolveria a pendência que o teste quer ver.
        tenantId: f.a.id, dealId: deals[0]!, operation: 'venda', provider: 'simulado', ambiente: 'homologacao',
        status: 'cancelada', serie: 1, numero: 999, chave: '35261011222333000181550010000009991123456780',
        protocolo: '1', autorizadaEm: new Date(), canceladaEm: new Date(),
        justificativaDoCancelamento: 'Nota de teste sem XML no emissor',
        snapshot: (await dono.fiscalDocument.findUnique({ where: { id: notas.venda } }))!.snapshot as object,
      },
    });
    notas.orfa = orfa.id;

    // Fora do período: autorizada há 40 dias.
    const antiga = await dono.fiscalDocument.create({
      data: {
        tenantId: f.a.id, dealId: deals[0]!, operation: 'venda', provider: 'simulado', ambiente: 'homologacao',
        status: 'rejeitada', motivo: 'antiga', createdAt: new Date(Date.now() - 40 * 86_400_000),
        snapshot: (await dono.fiscalDocument.findUnique({ where: { id: notas.venda } }))!.snapshot as object,
      },
    });
    notas.antiga = antiga.id;
  }, 120_000);

  afterAll(async () => {
    const tenants = { in: [f.a.id, f.b.id] };
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

  it('o relatório soma só autorizadas, separa entrada de saída e aponta a rejeitada sem substituta', async () => {
    const res = await get(`/notas?${periodo()}`);
    expect(res.status).toBe(200);
    expect(res.body.resumo.saidas).toEqual({ quantidade: 1, valor: '50000.00' });
    expect(res.body.resumo.entradas).toEqual({ quantidade: 1, valor: '42000.00' });
    expect(res.body.resumo.porStatus.cancelada.quantidade).toBe(2);
    expect(res.body.resumo.porStatus.rejeitada.quantidade).toBe(1);

    const ids = res.body.notas.map((n: { id: string }) => n.id);
    expect(ids).not.toContain(notas.antiga);
    expect(res.body.resumo.pendentes).toEqual([notas.rejeitada]);

    const entrada = res.body.notas.find((n: { id: string }) => n.id === notas.entrada);
    expect(entrada).toMatchObject({ direcao: 'entrada', cfop: '1102', origem: { tipo: 'veiculo' } });
    const venda = res.body.notas.find((n: { id: string }) => n.id === notas.venda);
    expect(venda.origem).toMatchObject({ tipo: 'negocio' });
  });

  it('o CSV tem uma linha por nota do período, com BOM', async () => {
    const res = await get(`/notas.csv?${periodo()}`).buffer(true);
    expect(res.status).toBe(200);
    const texto = res.text;
    expect(texto.charCodeAt(0)).toBe(0xfeff);
    expect(texto.trim().split('\n')).toHaveLength(1 + 5);
  });

  it('o pacote leva os XMLs, o índice e o LEIA-ME — e diz qual nota ficou sem XML', async () => {
    const res = await get(`/notas/pacote.zip?${periodo()}`)
      .buffer(true).parse((r, cb) => {
        const partes: Buffer[] = [];
        r.on('data', (c: Buffer) => partes.push(c));
        r.on('end', () => cb(null, Buffer.concat(partes)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');

    const zip = lerZip(res.body as Buffer);
    const nomes = [...zip.keys()];
    const chaveDe = async (id: string) => (await dono.fiscalDocument.findUnique({ where: { id } }))!.chave!;

    expect(nomes).toEqual(expect.arrayContaining([
      'LEIA-ME.txt', 'notas.csv',
      `xml/saida/${await chaveDe(notas.venda)}-nfe.xml`,
      `xml/saida/${await chaveDe(notas.cancelada)}-nfe.xml`,
      `xml/entrada/${await chaveDe(notas.entrada)}-nfe.xml`,
    ]));
    // XML de nota rejeitada não existe; o da órfã não veio.
    expect(nomes.filter((n) => n.startsWith('xml/'))).toHaveLength(3);
    expect(zip.get(`xml/saida/${await chaveDe(notas.venda)}-nfe.xml`)!.toString()).toContain(await chaveDe(notas.venda));

    const leiaMe = zip.get('LEIA-ME.txt')!.toString();
    expect(leiaMe).toContain('1 nota(s) sem XML');
    expect(leiaMe).toContain('35261011222333000181550010000009991123456780');

    const indice = zip.get('notas.csv')!.toString();
    expect(indice).toContain('XML fora do pacote');
    expect(indice).toContain('sem XML: a nota não foi autorizada');
  });

  it('a loja B não vê as notas da A; o vendedor não entra', async () => {
    const b = await get(`/notas?${periodo()}`, comoOutraLoja);
    expect(b.status).toBe(200);
    expect(b.body.notas).toEqual([]);
    expect((await get(`/notas?${periodo()}`, comoVendedor)).status).toBe(403);
    expect((await get(`/notas/pacote.zip?${periodo()}`, comoVendedor)).status).toBe(403);
  });

  it('período invertido é 400', async () => {
    expect((await get('/notas?from=2026-10-31&to=2026-10-01')).status).toBe(400);
  });
});
