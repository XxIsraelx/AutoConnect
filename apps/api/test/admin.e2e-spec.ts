import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@autoconnect/db';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Painel do super admin: os números de venda e uso da plataforma.
 *
 * O banco de teste é compartilhado e pode ter resíduo de outros arquivos, então
 * as asserções de `/admin/stats` são por **diferença**: lê antes, semeia, lê de
 * novo. Dinheiro é comparado como Decimal, nunca como `number`.
 */
describe('Painel do super admin (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let tokenSuper: string;
  let tokenLoja: string;

  const get = (rota: string, token = tokenSuper) =>
    request(app.getHttpServer()).get(`/api/v1${rota}`).set('Authorization', `Bearer ${token}`);

  type Stats = {
    totalTenants: number;
    openConversations: number;
    deals: { total: number; open: number; won: number; canceled: number; byStatus: Record<string, number> };
    revenue: Record<'last30d' | 'monthToDate', { count: number; gmv: string; margin: string }>;
    contracts: { issued: number; signed: number; signedExternal: number; signedInternal: number };
    externalSignatures: Record<string, number>;
    vehicleQueries: { provider: string; month: { count: number; failed: number; spendCents: number } };
  };

  let antes: Stats;
  let depois: Stats;

  const dec = (v: string) => new Prisma.Decimal(v);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    f = await criarDoisTenants(dono);

    const jwt = app.get(JwtService);
    tokenSuper = jwt.sign({ sub: randomUUID(), role: 'super_admin', tenantId: null });
    tokenLoja = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });

    antes = (await get('/admin/stats')).body as Stats;

    // Loja A: um negócio faturado hoje, um cancelado, representante legal com
    // e-mail, uma consulta paga e uma que falhou.
    const [faturado] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO deals (tenant_id, vehicle_id, list_price, sale_value, gross_margin, status, closed_at, updated_at)
      VALUES (${f.a.id}::uuid, ${f.a.veiculoPublicoId}::uuid, 50000, 48000.50, 5000.25,
              'invoiced'::"DealStatus", now(), now())
      RETURNING id`;
    await dono.$executeRaw`
      INSERT INTO deals (tenant_id, vehicle_id, list_price, sale_value, status, canceled_at, updated_at)
      VALUES (${f.a.id}::uuid, ${f.a.veiculoPrivadoId}::uuid, 50000, 50000,
              'canceled'::"DealStatus", now(), now())`;
    await dono.$executeRaw`
      UPDATE tenants SET legal_rep_name = 'Carlos Souza', legal_rep_email = 'carlos@exemplo.test'
      WHERE id = ${f.a.id}::uuid`;

    const [template] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO contract_templates (tenant_id, name, version, blocks, updated_at)
      VALUES (${f.a.id}::uuid, 'Compra e venda', 1, '{"blocos":[]}'::jsonb, now())
      RETURNING id`;
    const contrato = async (hash: string) => {
      const [c] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO deal_contracts (tenant_id, deal_id, template_id, status, snapshot, content_hash, signed_at, updated_at)
        VALUES (${f.a.id}::uuid, ${faturado.id}::uuid, ${template.id}::uuid, 'signed'::"ContractStatus",
                '{}'::jsonb, ${hash}, now(), now())
        RETURNING id`;
      return c.id;
    };
    await contrato('assinado-no-sistema');
    const externo = await contrato('assinado-no-provedor');
    await dono.$executeRaw`
      INSERT INTO contract_signature_requests (tenant_id, contract_id, provider, external_id, status, content_hash, signers, completed_at, updated_at)
      VALUES (${f.a.id}::uuid, ${externo}::uuid, 'simulado', ${`env-${randomUUID()}`},
              'completed'::"SignatureRequestStatus", 'assinado-no-provedor', '[]'::jsonb, now(), now())`;

    const consulta = async (status: string, custo: number) => dono.$executeRaw`
      INSERT INTO vehicle_queries (tenant_id, plate, kind, status, provider, cost_cents, idempotency_key, expires_at, updated_at)
      VALUES (${f.a.id}::uuid, 'ABC1D23', 'debts'::"VehicleQueryKind", ${status}::"VehicleQueryStatus",
              'contador', ${custo}, ${`admin-e2e-${randomUUID()}`}, now() + interval '1 day', now())`;
    await consulta('success', 250);
    await consulta('failed', 250);

    // Loja B: um negócio ainda aberto.
    await dono.$executeRaw`
      INSERT INTO deals (tenant_id, vehicle_id, list_price, sale_value, status, updated_at)
      VALUES (${f.b.id}::uuid, ${f.b.veiculoPublicoId}::uuid, 70000, 69000, 'proposal'::"DealStatus", now())`;

    depois = (await get('/admin/stats')).body as Stats;
  }, 90_000);

  afterAll(async () => {
    for (const t of [f?.a, f?.b].filter(Boolean)) {
      await dono.$executeRaw`DELETE FROM contract_signature_requests WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM deal_contracts WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM contract_templates WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM vehicle_queries WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM deals WHERE tenant_id = ${t.id}::uuid`;
    }
    await f?.limpar();
    await app?.close();
  });

  describe('acesso', () => {
    it.each(['/admin/stats', '/admin/tenants', `/admin/system`])(
      '%s recusa quem não é super admin (403)',
      async (rota) => {
        const res = await get(rota, tokenLoja);
        expect(res.status).toBe(403);
      },
    );

    it('o detalhe da loja também recusa (403), mesmo sendo a própria loja', async () => {
      const res = await get(`/admin/tenants/${f.a.id}`, tokenLoja);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /admin/stats — vendas e uso', () => {
    it('mantém as contagens antigas', () => {
      expect(depois.totalTenants).toBeGreaterThanOrEqual(2);
      expect(typeof depois.openConversations).toBe('number');
    });

    it('negócios por grupo: aberto, ganho (faturado) e cancelado', () => {
      expect(depois.deals.won - antes.deals.won).toBe(1);
      expect(depois.deals.canceled - antes.deals.canceled).toBe(1);
      expect(depois.deals.open - antes.deals.open).toBe(1);
      expect(depois.deals.total - antes.deals.total).toBe(3);
      expect(depois.deals.byStatus.invoiced - (antes.deals.byStatus.invoiced ?? 0)).toBe(1);
    });

    it('faturamento e margem saem como string decimal, nos 30 dias e no mês', () => {
      for (const janela of ['last30d', 'monthToDate'] as const) {
        const a = antes.revenue[janela];
        const d = depois.revenue[janela];
        expect(d.gmv).toMatch(/^-?\d+\.\d{2}$/);
        expect(d.count - a.count).toBe(1);
        expect(dec(d.gmv).minus(dec(a.gmv)).toFixed(2)).toBe('48000.50');
        expect(dec(d.margin).minus(dec(a.margin)).toFixed(2)).toBe('5000.25');
      }
    });

    it('contratos assinados separam o que foi pelo provedor do que foi no sistema', () => {
      expect(depois.contracts.signed - antes.contracts.signed).toBe(2);
      expect(depois.contracts.signedExternal - antes.contracts.signedExternal).toBe(1);
      expect(depois.contracts.signedInternal - antes.contracts.signedInternal).toBe(1);
      expect(depois.contracts.issued - antes.contracts.issued).toBe(2);
      expect((depois.externalSignatures.completed ?? 0) - (antes.externalSignatures.completed ?? 0)).toBe(1);
    });

    it('consulta veicular do mês: quantidade, falhas e o gasto em centavos', () => {
      const a = antes.vehicleQueries.month;
      const d = depois.vehicleQueries.month;
      expect(d.count - a.count).toBe(2);
      expect(d.failed - a.failed).toBe(1);
      // A falha também é cobrada: o fornecedor cobra a tentativa.
      expect(d.spendCents - a.spendCents).toBe(500);
      expect(typeof depois.vehicleQueries.provider).toBe('string');
    });
  });

  describe('GET /admin/tenants — métricas por loja', () => {
    type Linha = {
      id: string;
      legalRep: { configured: boolean; hasEmail: boolean };
      metrics: {
        invoicedDeals30d: number; gmv30d: string;
        vehicleQueriesMonth: number; vehicleQuerySpendMonthCents: number;
        lastActivityAt: string | null;
      };
    };

    it('traz faturado, gasto com consulta, representante e última atividade', async () => {
      const res = await get('/admin/tenants');
      expect(res.status).toBe(200);
      const linhas = res.body as Linha[];
      const a = linhas.find((t) => t.id === f.a.id)!;
      const b = linhas.find((t) => t.id === f.b.id)!;

      expect(a.metrics).toMatchObject({
        invoicedDeals30d: 1, gmv30d: '48000.50',
        vehicleQueriesMonth: 2, vehicleQuerySpendMonthCents: 500,
      });
      expect(a.legalRep).toEqual({ configured: true, hasEmail: true });
      expect(a.metrics.lastActivityAt).not.toBeNull();

      expect(b.metrics).toMatchObject({ invoicedDeals30d: 0, gmv30d: '0.00', vehicleQuerySpendMonthCents: 0 });
      expect(b.legalRep).toEqual({ configured: false, hasEmail: false });
    });

    it('a lista não expõe o CPF do representante', async () => {
      const res = await get('/admin/tenants');
      expect(JSON.stringify(res.body)).not.toMatch(/legalRepCpf/);
    });

    it('o detalhe traz as mesmas métricas, sem o CPF', async () => {
      const res = await get(`/admin/tenants/${f.a.id}`);
      expect(res.status).toBe(200);
      expect(res.body.metrics).toMatchObject({ invoicedDeals30d: 1, gmv30d: '48000.50' });
      expect(res.body.legalRep).toMatchObject({ configured: true, hasEmail: true, name: 'Carlos Souza' });
      expect(res.body).not.toHaveProperty('legalRepCpf');
    });
  });

  describe('GET /admin/system — "desligado" não é "com falha"', () => {
    type Servico = { key: string; status: string; provider?: string; detail?: string };

    it('serviço sem credencial aparece como off; provedor montado, como up', async () => {
      const res = await get('/admin/system');
      expect(res.status).toBe(200);
      const porChave = new Map((res.body.services as Servico[]).map((s) => [s.key, s]));

      for (const s of porChave.values()) expect(['up', 'down', 'off']).toContain(s.status);
      // setup-e2e zera as credenciais do Supabase e do e-mail: é ausência
      // deliberada, e a tela não pode pintar isso de vermelho.
      expect(porChave.get('documents')?.status).toBe('off');
      expect(porChave.get('email')?.status).toBe('off');
      // ... e liga a assinatura simulada.
      expect(porChave.get('signature')).toMatchObject({ status: 'up', provider: 'simulado' });
      expect(porChave.get('database')?.status).toBe('up');
      expect(Array.isArray(res.body.cronJobs)).toBe(true);
    }, 20_000);
  });

  describe('corpo e query passam por Zod', () => {
    it('plano inexistente é 400, não 500', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/tenants/${f.a.id}/plan`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ plan: 'platinum' });
      expect(res.status).toBe(400);
    });

    it('filtro de papel desconhecido é 400', async () => {
      const res = await get('/admin/users?role=root');
      expect(res.status).toBe(400);
    });
  });
});
