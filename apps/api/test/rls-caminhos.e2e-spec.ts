import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Caminhos que rodavam sem contexto de tenant e, por isso, ficavam cegos sob
 * RLS sem erro nenhum: a importação em lote (`this.prisma.$transaction`) e o
 * gráfico de leads por dia (`this.prisma.$queryRaw` dentro de um withTenant).
 *
 * Conectado como dono das tabelas, este arquivo passa de qualquer jeito. O que
 * ele prova vem do passo do CI que roda a suíte como `autoconnect_app` — que é
 * como a produção conecta.
 */
describe('Caminhos sob RLS (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let tokenDeA: string;
  const s = Math.random().toString(36).slice(2, 10);
  const marcaNova = `Importada ${s}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    dono = app.get(PrivilegedPrismaService, { strict: false });
    f = await criarDoisTenants(dono);
    tokenDeA = app.get(JwtService).sign({
      sub: f.a.usuarioId,
      role: 'tenant_admin',
      tenantId: f.a.id,
    });
  }, 90_000);

  afterAll(async () => {
    await f?.limpar();
    // Depois do limpar: os veículos importados referenciam a marca nova.
    if (dono) {
      await dono.$executeRaw`
        DELETE FROM vehicle_models WHERE brand_id IN
          (SELECT id FROM vehicle_brands WHERE name = ${marcaNova})`;
      await dono.$executeRaw`DELETE FROM vehicle_brands WHERE name = ${marcaNova}`;
    }
    await app?.close();
  });

  it('a importação em lote grava veículo e marca nova', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/vehicles/import')
      .set('Authorization', `Bearer ${tokenDeA}`)
      .send({
        rows: [{
          brandName: marcaNova,
          modelName: `Modelo ${s}`,
          condition: 'used',
          yearModel: 2020,
          yearMake: 2020,
          mileageKm: 1000,
          price: 50000,
        }],
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ imported: 1 });

    const [{ n }] = await dono.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM vehicles v JOIN vehicle_brands b ON b.id = v.brand_id
      WHERE v.tenant_id = ${f.a.id}::uuid AND b.name = ${marcaNova}`;
    expect(Number(n)).toBe(1);
  });

  it('o gráfico de leads por dia enxerga os leads da própria loja', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tenant/reports?days=30')
      .set('Authorization', `Bearer ${tokenDeA}`);

    expect(res.status).toBe(200);
    const total = (res.body.leadsPerDay as { count: number }[])
      .reduce((soma, d) => soma + d.count, 0);
    // A fixture cria exatamente um lead por loja, agora.
    expect(total).toBe(1);
  });
});
