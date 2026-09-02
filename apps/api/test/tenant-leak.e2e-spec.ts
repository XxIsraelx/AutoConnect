import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Vazamento entre concessionárias na fronteira HTTP.
 *
 * Complementa `rls-isolation.e2e-spec.ts`, que prova o isolamento no banco.
 * Aqui o que se fixa é o contrato da API: **404, não 403**. Um 403 confirmaria
 * que o recurso existe, e saber que a concorrente tem um veículo com aquele id
 * já é informação a mais do que ela deveria ter.
 */
describe('Vazamento entre concessionárias (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let tokenDeA: string;

  /** Campos que só existiriam se o recurso da outra loja tivesse vazado. */
  const CAMPOS_VAZADOS = ['price', 'promoPrice', 'vin', 'plate', 'contactEmail', 'contactPhone'];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    // Semeia pela conexão dona: criar dados de duas lojas é justamente o que
    // nenhum contexto de tenant pode fazer.
    dono = app.get(PrivilegedPrismaService, { strict: false });
    f = await criarDoisTenants(dono);

    // Um admin da concessionária A. O payload é o mesmo que o auth.service
    // emite: { sub, role, tenantId }.
    tokenDeA = app.get(JwtService).sign({
      sub: f.a.usuarioId,
      role: 'tenant_admin',
      tenantId: f.a.id,
    });
  }, 90_000);

  afterAll(async () => {
    await f?.limpar();
    await app?.close();
  });

  const comoA = (rota: string) =>
    request(app.getHttpServer()).get(rota).set('Authorization', `Bearer ${tokenDeA}`);

  it('o token da A funciona no próprio veículo — senão o 404 abaixo não prova nada', async () => {
    const res = await comoA(`/api/v1/vehicles/${f.a.veiculoPrivadoId}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', f.a.veiculoPrivadoId);
  });

  it('veículo da B responde 404 para a A, sem devolver campo nenhum do recurso', async () => {
    const res = await comoA(`/api/v1/vehicles/${f.b.veiculoPrivadoId}`);

    expect(res.status).toBe(404);
    for (const campo of CAMPOS_VAZADOS) {
      expect(res.body).not.toHaveProperty(campo);
    }
    expect(JSON.stringify(res.body)).not.toContain(f.b.id);
  });

  it('lead da B responde 404 para a A', async () => {
    const res = await comoA(`/api/v1/leads/${f.b.leadId}/history`);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(f.b.id);
  });

  it('agendamento da B não é alterável pela A', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/appointments/${f.b.agendamentoId}`)
      .set('Authorization', `Bearer ${tokenDeA}`)
      .send({ status: 'canceled' });

    expect(res.status).toBe(404);

    // E o agendamento continua de pé: o 404 não pode ser "apagou e não achou".
    const [{ total }] = await dono.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total FROM appointments
      WHERE id = ${f.b.agendamentoId}::uuid AND status <> 'canceled'`;
    expect(total).toBe(1);
  });

  it('a listagem de leads da A não traz nada da B', async () => {
    const res = await comoA('/api/v1/leads');

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(f.b.leadId);
  });

  it('o catálogo público segue devolvendo veículos das duas, sem autenticação', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/catalog/vehicles?limit=100');

    expect(res.status).toBe(200);
    const corpo = JSON.stringify(res.body);
    expect(corpo).toContain(f.a.veiculoPublicoId);
    expect(corpo).toContain(f.b.veiculoPublicoId);
  });
});
