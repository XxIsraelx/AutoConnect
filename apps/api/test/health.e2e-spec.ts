import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  }, 60_000);

  afterAll(async () => {
    // Fecha a app para desregistrar os @Cron do TasksService — senão os timers
    // do @nestjs/schedule seguram o event loop e o Jest não encerra.
    await app?.close();
  });

  it('está conectada ao banco de teste, não a um banco real', async () => {
    const prisma = app.get(PrismaService);
    const [{ current_database: banco }] =
      await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;

    expect(banco).toMatch(/_test$/);
  });

  it('GET /api/v1/health responde ok com o banco de pé', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
    expect(Date.parse(res.body.ts)).not.toBeNaN();
  });

  it('a rota responde sem autenticação, porque é @Public', async () => {
    // O JwtAuthGuard é global; se o @Public do HealthController se perder, esta
    // chamada passa a devolver 401 e o healthcheck do Railway derruba o deploy.
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Authorization', 'Bearer token-invalido');

    expect(res.status).toBe(200);
  });

  it('o prefixo /api/v1 está aplicado', async () => {
    const semPrefixo = await request(app.getHttpServer()).get('/health');

    expect(semPrefixo.status).toBe(404);
  });
});
