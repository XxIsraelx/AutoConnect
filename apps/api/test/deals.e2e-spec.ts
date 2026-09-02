import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * O contrato HTTP do negócio: o fluxo inteiro do ponto de vista de quem usa,
 * mais as duas coisas que o plano exige provar na fronteira — que a margem não
 * chega a quem não pode vê-la, e que um negócio de outra loja é 404.
 */
describe('Negócios (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let jwt: JwtService;

  const token = (usuarioId: string, role: string, tenantId: string) =>
    jwt.sign({ sub: usuarioId, role, tenantId });

  let comoAdmin: string;
  let comoVendedor: string;

  const http = () => request(app.getHttpServer());
  const post = (rota: string, t: string, corpo: object) =>
    http().post(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`).send(corpo);
  const get = (rota: string, t: string) =>
    http().get(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`);
  const patch = (rota: string, t: string, corpo: object) =>
    http().patch(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`).send(corpo);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    dono = app.get(PrivilegedPrismaService, { strict: false });
    jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);

    comoAdmin = token(f.a.usuarioId, 'tenant_admin', f.a.id);
    comoVendedor = token(f.a.usuarioId, 'salesperson', f.a.id);
  }, 90_000);

  afterEach(async () => {
    await dono.$executeRaw`
      DELETE FROM deals WHERE tenant_id IN (${f.a.id}::uuid, ${f.b.id}::uuid)`;
    await dono.$executeRaw`
      DELETE FROM vehicle_costs WHERE tenant_id IN (${f.a.id}::uuid, ${f.b.id}::uuid)`;
    await dono.$executeRaw`
      DELETE FROM vehicle_acquisitions WHERE tenant_id IN (${f.a.id}::uuid, ${f.b.id}::uuid)`;
    await dono.$executeRaw`
      UPDATE leads SET status = 'new', won_at = NULL
       WHERE tenant_id IN (${f.a.id}::uuid, ${f.b.id}::uuid)`;
  });

  afterAll(async () => {
    await f?.limpar();
    await app?.close();
  });

  const abrirNegocio = (t = comoVendedor, veiculoId = f.a.veiculoPublicoId) =>
    post('/deals', t, {
      vehicleId: veiculoId,
      listPrice: '100000.00',
      discount: '5000.00',
      saleValue: '95000.00',
    });

  describe('abertura', () => {
    it('vendedor abre negócio e ele nasce em draft', async () => {
      const res = await abrirNegocio();

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'draft', saleValue: '95000' });
    });

    it('o veículo sai da vitrine ao abrir o negócio', async () => {
      await abrirNegocio();
      const res = await get(`/vehicles/${f.a.veiculoPublicoId}`, comoAdmin);

      expect(res.body).toHaveProperty('status', 'reserved');
    });

    it('recusa quando venda não bate com tabela menos desconto', async () => {
      const res = await post('/deals', comoVendedor, {
        vehicleId: f.a.veiculoPublicoId,
        listPrice: '100000.00',
        discount: '5000.00',
        saleValue: '90000.00',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/deveria ser 95000\.00/);
    });

    it('recusa valor monetário com mais de duas casas', async () => {
      const res = await post('/deals', comoVendedor, {
        vehicleId: f.a.veiculoPublicoId,
        listPrice: '100000.999',
        discount: '0',
        saleValue: '100000.999',
      });

      expect(res.status).toBe(400);
    });

    it('o segundo negócio no mesmo veículo é recusado com 409', async () => {
      await abrirNegocio();
      const res = await abrirNegocio();

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/já tem um negócio em andamento/);
    });

    it('veículo de outra concessionária é 404, não 403', async () => {
      const res = await abrirNegocio(comoVendedor, f.b.veiculoPublicoId);

      expect(res.status).toBe(404);
    });
  });

  describe('transições', () => {
    it('recusa pulo de etapa com 409', async () => {
      const { body } = await abrirNegocio();
      const res = await post(`/deals/${body.id}/transition`, comoVendedor, { to: 'delivered' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Não é possível ir de "draft" para "delivered"/);
    });

    it('assinar sem a composição do pagamento fechada é 409', async () => {
      const { body } = await abrirNegocio();
      for (const to of ['proposal', 'contract_issued']) {
        await post(`/deals/${body.id}/transition`, comoVendedor, { to });
      }
      const res = await post(`/deals/${body.id}/transition`, comoVendedor, { to: 'signed' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Faltam 95000\.00/);
    });

    it('pagamento acima do valor da venda é recusado na hora', async () => {
      const { body } = await abrirNegocio();
      const res = await post(`/deals/${body.id}/payments`, comoVendedor, {
        kind: 'cash', value: '95000.01',
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/acima da venda/);
    });
  });

  describe('fluxo completo: negócio → pagamento composto → entregue', () => {
    it('percorre até delivered e congela a margem no faturamento', async () => {
      // Custo do carro: 70.000 de compra + 1.234,56 de preparação.
      await post(`/vehicles/${f.a.veiculoPublicoId}/acquisition`, comoAdmin, {
        origin: 'direct_purchase',
        purchaseValue: '70000.00',
        enteredAt: new Date('2026-06-01').toISOString(),
      });
      await post(`/vehicles/${f.a.veiculoPublicoId}/costs`, comoAdmin, {
        kind: 'preparation',
        value: '1234.56',
        incurredAt: new Date('2026-06-05').toISOString(),
      });

      const { body: negocio } = await abrirNegocio();

      // Entrada + troca + financiamento é o caso comum, não a exceção.
      for (const p of [
        { kind: 'down_payment', value: '15000.00' },
        { kind: 'trade_in', value: '23500.50' },
        { kind: 'financing', value: '56499.50', institution: 'Banco X', installments: 48 },
      ]) {
        const r = await post(`/deals/${negocio.id}/payments`, comoVendedor, p);
        expect(r.status).toBe(201);
      }

      for (const to of ['proposal', 'contract_issued', 'signed', 'invoiced', 'documentation', 'delivered']) {
        const r = await post(`/deals/${negocio.id}/transition`, comoVendedor, { to });
        expect([r.status, to]).toEqual([201, to]);
      }

      const detalhe = await get(`/deals/${negocio.id}`, comoAdmin);
      expect(detalhe.body).toMatchObject({ status: 'delivered' });
      expect(detalhe.body.statusEvents.length).toBeGreaterThanOrEqual(7);

      // 95.000 − (70.000 + 1.234,56) = 23.765,44
      const margem = await get(`/deals/${negocio.id}/margin`, comoAdmin);
      expect(margem.body).toMatchObject({
        congelado: true,
        totalCost: '71234.56',
        grossMargin: '23765.44',
      });

      const veiculo = await get(`/vehicles/${f.a.veiculoPublicoId}`, comoAdmin);
      expect(veiculo.body).toHaveProperty('status', 'sold');
    });
  });

  describe('custo é informação de manager+', () => {
    it('vendedor não alcança a margem', async () => {
      const { body } = await abrirNegocio();
      const res = await get(`/deals/${body.id}/margin`, comoVendedor);

      expect(res.status).toBe(403);
    });

    it('vendedor não lança custo de aquisição', async () => {
      const res = await post(`/vehicles/${f.a.veiculoPublicoId}/acquisition`, comoVendedor, {
        origin: 'direct_purchase',
        purchaseValue: '70000.00',
        enteredAt: new Date().toISOString(),
      });

      expect(res.status).toBe(403);
    });

    it('cliente não alcança negócio nenhum', async () => {
      const comoCliente = token(f.a.usuarioId, 'customer', f.a.id);
      const res = await get('/deals', comoCliente);

      expect(res.status).toBe(403);
    });
  });


  describe('lead ganho exige negócio', () => {
    it('recusa marcar o lead como ganho sem negócio ligado a ele', async () => {
      const res = await patch(`/leads/${f.a.leadId}`, comoAdmin, { status: 'won' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/abra o negócio correspondente/);
    });

    it('aceita depois que o negócio existe', async () => {
      const criado = await post('/deals', comoVendedor, {
        vehicleId: f.a.veiculoPublicoId,
        leadId: f.a.leadId,
        listPrice: '100000.00',
        discount: '5000.00',
        saleValue: '95000.00',
      });
      expect(criado.status).toBe(201);

      const res = await patch(`/leads/${f.a.leadId}`, comoAdmin, { status: 'won' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'won' });
    });

    it('outros status seguem livres — a regra é só do "ganho"', async () => {
      const res = await patch(`/leads/${f.a.leadId}`, comoAdmin, { status: 'negotiating' });

      expect(res.status).toBe(200);
    });
  });

  describe('isolamento entre concessionárias', () => {
    it('negócio da B responde 404 para a A', async () => {
      const outro = await post('/deals', token(f.b.usuarioId, 'tenant_admin', f.b.id), {
        vehicleId: f.b.veiculoPublicoId,
        listPrice: '50000.00',
        discount: '0',
        saleValue: '50000.00',
      });
      expect(outro.status).toBe(201);

      const res = await get(`/deals/${outro.body.id}`, comoAdmin);

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('50000');
    });

    it('a listagem da A não traz negócio da B', async () => {
      await post('/deals', token(f.b.usuarioId, 'tenant_admin', f.b.id), {
        vehicleId: f.b.veiculoPublicoId,
        listPrice: '50000.00', discount: '0', saleValue: '50000.00',
      });

      const res = await get('/deals', comoAdmin);

      expect(res.status).toBe(200);
      expect(res.body.itens).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });
});
