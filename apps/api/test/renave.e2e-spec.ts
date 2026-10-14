import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { comoApp, criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/** NF-e de SP, outubro de 2026 — a mesma chave dos testes de `chave-nfe.ts`. */
const CHAVE_NFE = '35261011222333000181550010000012341123456787';

/**
 * RENAVE — registro manual e pendências (R1 do plano fiscal).
 *
 * O que este arquivo fixa, em ordem de importância:
 *
 *  1. o valor registrado vem da aquisição e do negócio, nunca do corpo;
 *  2. registro confirmado não muda — nem pela API, nem por UPDATE direto —,
 *     menos a chave da NF-e, que o manual do RENAVE deixa trocar;
 *  3. a pendência aparece e some conforme a loja registra;
 *  4. nada da loja B aparece para a A, nem pela API nem sob RLS;
 *  5. o vendedor vê o cartão e não registra.
 */
describe('RENAVE — registro manual (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let prisma: PrismaService;
  let jwt: JwtService;
  let f: DoisTenants;
  let comoGerente: string;
  let comoVendedor: string;
  let comoOutraLoja: string;
  let veiculo: string;
  let entradaId: string;
  let negocioId: string;

  const http = () => request(app.getHttpServer());
  const rota = (c: string) => `/api/v1/renave${c}`;
  const get = (c: string, token = comoGerente) =>
    http().get(rota(c)).set('Authorization', `Bearer ${token}`);
  const post = (c: string, body: object, token = comoGerente) =>
    http().post(rota(c)).set('Authorization', `Bearer ${token}`).send(body);

  const codigos = async (token = comoGerente) => {
    const res = await get(`/veiculos/${veiculo}`, token);
    expect(res.status).toBe(200);
    return (res.body.pendencias as { codigo: string }[]).map((p) => p.codigo);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);
    veiculo = f.a.veiculoPublicoId;

    await dono.tenant.update({ where: { id: f.a.id }, data: { taxId: '11222333000181' } });

    const vendedor = await dono.user.create({
      data: {
        tenantId: f.a.id, email: `vend-renave-${Date.now()}@exemplo.test`,
        fullName: 'Vendedor que só olha', role: 'salesperson', passwordHash: 'x',
      },
    });

    comoGerente = jwt.sign({ sub: f.a.usuarioId, role: 'manager', tenantId: f.a.id });
    comoVendedor = jwt.sign({ sub: vendedor.id, role: 'salesperson', tenantId: f.a.id });
    comoOutraLoja = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });
  }, 90_000);

  afterAll(async () => {
    const lojas = { in: [f.a.id, f.b.id] };
    await dono.renaveRegistro.deleteMany({ where: { tenantId: lojas } });
    await dono.deal.deleteMany({ where: { tenantId: lojas } });
    await dono.vehicleAcquisition.deleteMany({ where: { tenantId: lojas } });
    await dono.user.deleteMany({ where: { tenantId: f.a.id, role: 'salesperson' } });
    await f?.limpar();
    await app?.close();
  });

  describe('entrada', () => {
    it('carro no estoque sem entrada aparece como obrigação', async () => {
      expect(await codigos()).toEqual(['entrada_sem_registro']);
    });

    it('o vendedor vê o cartão, mas não registra', async () => {
      expect(await codigos(comoVendedor)).toEqual(['entrada_sem_registro']);
      const res = await post('/registros', { vehicleId: veiculo, tipo: 'entrada_compra' }, comoVendedor);
      expect(res.status).toBe(403);
      expect((await get('/pendencias', comoVendedor)).status).toBe(403);
    });

    it('entrada por compra sem aquisição é 422: o valor vem de lá, não de uma tela nova', async () => {
      const res = await post('/registros', { vehicleId: veiculo, tipo: 'entrada_compra', protocolo: 'P-1' });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/custo do veículo/);
    });

    it('valor no corpo é 400 — não existe esse campo', async () => {
      const res = await post('/registros', {
        vehicleId: veiculo, tipo: 'entrada_compra', protocolo: 'P-1', valor: '1.00',
      });
      expect(res.status).toBe(400);
    });

    it('com protocolo, nasce confirmada, com valor e data da aquisição', async () => {
      await dono.vehicleAcquisition.create({
        data: {
          tenantId: f.a.id, vehicleId: veiculo, origin: 'trade_in',
          purchaseValue: '41234.56', enteredAt: new Date('2026-10-02T12:00:00Z'),
          supplierName: 'Fulano de Tal', supplierDocument: '52998224725',
        },
      });

      const antes = await get(`/veiculos/${veiculo}`);
      // Troca é compra para o RENAVE.
      expect(antes.body.sugestao.entrada).toMatchObject({ tipo: 'entrada_compra', valor: '41234.56' });

      const res = await post('/registros', { vehicleId: veiculo, tipo: 'entrada_compra', protocolo: 'EST-778899' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'confirmado', origem: 'manual', protocolo: 'EST-778899', valor: '41234.56',
      });
      expect(new Date(res.body.dataOperacao).toISOString()).toBe('2026-10-02T12:00:00.000Z');
      entradaId = res.body.id;

      const linha = await dono.renaveRegistro.findUniqueOrThrow({ where: { id: entradaId } });
      expect(linha.snapshot).toMatchObject({ vendedor: { nome: 'Fulano de Tal', documento: '52998224725' } });
    });

    it('segunda entrada com o carro em estoque é 409', async () => {
      const res = await post('/registros', { vehicleId: veiculo, tipo: 'entrada_compra', protocolo: 'EST-2' });
      expect(res.status).toBe(409);
    });

    it('sem NF-e de entrada, a pendência é a chave; informada, some', async () => {
      expect(await codigos()).toEqual(['entrada_sem_nfe']);

      const errada = await post(`/registros/${entradaId}/nfe`, { chaveNfe: CHAVE_NFE.slice(0, 43) + '0' });
      expect(errada.status).toBe(400);

      // Colada do DANFE, com espaços: guardada na forma canônica.
      const res = await post(`/registros/${entradaId}/nfe`, {
        chaveNfe: CHAVE_NFE.replace(/(.{4})/g, '$1 '),
      });
      expect(res.status).toBe(201);
      expect(res.body.chaveNfe).toBe(CHAVE_NFE);
      expect(await codigos()).toEqual([]);
    });

    it('confirmado não muda nem por UPDATE direto — só a chave da NF-e', async () => {
      await expect(
        dono.renaveRegistro.update({ where: { id: entradaId }, data: { valor: '1.00' } }),
      ).rejects.toThrow(/já foi confirmado/);
      await expect(
        dono.renaveRegistro.update({ where: { id: entradaId }, data: { status: 'pendente' } }),
      ).rejects.toThrow(/já foi confirmado/);
      await expect(
        dono.renaveRegistro.update({ where: { id: entradaId }, data: { chaveNfe: CHAVE_NFE } }),
      ).resolves.toBeTruthy();
    });

    it('confirmar o que já está confirmado é 409', async () => {
      const res = await post(`/registros/${entradaId}/confirmar`, { protocolo: 'X' });
      expect(res.status).toBe(409);
    });
  });

  describe('saída por venda', () => {
    it('negócio em negociação não sai: 422', async () => {
      const negocio = await dono.deal.create({
        data: {
          tenantId: f.a.id, vehicleId: veiculo, status: 'negotiating',
          listPrice: '52000.00', saleValue: '49900.00', discount: '2100.00',
        },
      });
      negocioId = negocio.id;

      const res = await post('/registros', { vehicleId: veiculo, tipo: 'saida_venda', dealId: negocioId });
      expect(res.status).toBe(422);
      // Nem pendência: venda que não foi faturada ainda não deve nada ao RENAVE.
      expect(await codigos()).toEqual([]);
    });

    it('faturado sem saída vira obrigação apontando o negócio, também na lista da gerência', async () => {
      await dono.deal.update({
        where: { id: negocioId },
        data: { status: 'invoiced', closedAt: new Date('2026-10-12T15:00:00Z') },
      });

      const res = await get(`/veiculos/${veiculo}`);
      expect(res.body.pendencias).toEqual([
        expect.objectContaining({ codigo: 'saida_sem_registro', gravidade: 'obrigatoria', dealId: negocioId }),
      ]);
      expect(res.body.sugestao.saidas).toEqual([
        expect.objectContaining({ dealId: negocioId, valor: '49900.00' }),
      ]);

      const lista = await get('/pendencias');
      expect(lista.status).toBe(200);
      const item = (lista.body.itens as { veiculo: { id: string } }[]).find((i) => i.veiculo.id === veiculo);
      expect(item).toBeDefined();
      expect(lista.body.total.obrigatorias).toBeGreaterThanOrEqual(1);
    });

    it('sem protocolo, a saída fica aguardando, com o valor do negócio', async () => {
      const res = await post('/registros', { vehicleId: veiculo, tipo: 'saida_venda', dealId: negocioId });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'pendente', valor: '49900.00', dealId: negocioId });
      expect(await codigos()).toEqual(['saida_aguardando_protocolo']);

      const dobrada = await post('/registros', { vehicleId: veiculo, tipo: 'saida_venda', dealId: negocioId });
      expect(dobrada.status).toBe(409);
    });

    it('o índice parcial segura a segunda saída viva mesmo sem o service', async () => {
      await expect(dono.renaveRegistro.create({
        data: {
          tenantId: f.a.id, vehicleId: veiculo, dealId: negocioId, tipo: 'saida_venda',
          // Sequência que ninguém usou: quem tem que recusar é o índice parcial.
          dataOperacao: new Date(), valor: '49900.00', sequencia: 99,
        },
      })).rejects.toThrow();
    });

    it('confirmada, cobra a NF-e de saída; cancelada, devolve a obrigação de registrar', async () => {
      const saida = (await get(`/veiculos/${veiculo}`)).body.registros
        .find((r: { tipo: string }) => r.tipo === 'saida_venda');

      const ok = await post(`/registros/${saida.id}/confirmar`, { protocolo: 'SAI-1' });
      expect(ok.status).toBe(201);
      expect(ok.body.status).toBe('confirmado');
      expect(await codigos()).toEqual(['saida_sem_nfe']);

      const semMotivo = await post(`/registros/${saida.id}/cancelar`, {});
      expect(semMotivo.status).toBe(400);

      const cancelada = await post(`/registros/${saida.id}/cancelar`, { motivo: 'Saída lançada com o comprador errado' });
      expect(cancelada.status).toBe(201);
      expect(cancelada.body).toMatchObject({ status: 'cancelado', motivoCancelamento: 'Saída lançada com o comprador errado' });
      expect(await codigos()).toEqual(['saida_sem_registro']);

      // Cancelado é final: nem a NF-e entra mais.
      const nfe = await post(`/registros/${saida.id}/nfe`, { chaveNfe: CHAVE_NFE });
      expect(nfe.status).toBe(409);
    });
  });

  describe('isolamento', () => {
    it('a outra loja não vê o veículo, não mexe no registro e não o lista', async () => {
      expect((await get(`/veiculos/${veiculo}`, comoOutraLoja)).status).toBe(404);
      expect((await post(`/registros/${entradaId}/cancelar`, { motivo: 'invasão' }, comoOutraLoja)).status).toBe(404);
      expect((await post('/registros', {
        vehicleId: veiculo, tipo: 'entrada_compra', protocolo: 'X',
      }, comoOutraLoja)).status).toBe(404);

      const lista = await get('/pendencias', comoOutraLoja);
      expect(lista.status).toBe(200);
      expect((lista.body.itens as { veiculo: { id: string } }[]).some((i) => i.veiculo.id === veiculo)).toBe(false);
    });

    it('sob RLS, só a própria loja enxerga as linhas — e sem contexto ninguém', async () => {
      const conta = (ctx: { tenantId?: string }) =>
        comoApp(prisma, ctx, async (tx) => {
          const linhas = (await tx.$queryRawUnsafe(
            'SELECT count(*)::int AS n FROM renave_registros WHERE vehicle_id = $1::uuid', veiculo,
          )) as { n: number }[];
          return linhas[0]!.n;
        });

      expect(await conta({ tenantId: f.a.id })).toBe(2);
      expect(await conta({ tenantId: f.b.id })).toBe(0);
      expect(await conta({})).toBe(0);
    });
  });
});
