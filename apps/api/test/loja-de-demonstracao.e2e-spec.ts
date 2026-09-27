import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Loja de demonstração (`tenants.is_demo`) — a "Aurora Seminovos" de
 * produção. Ela aparecia na busca e no mapa para comprador de verdade; agora é
 * vitrine para o lojista em prospecção, que a landing linka em `/c/demo`.
 *
 * Aqui a loja B da fixture faz o papel da demo. O que se fixa é o par: fora
 * de tudo que é busca entre lojas, e dentro da própria vitrine, com o aviso.
 */
describe('Loja de demonstração (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;

  const rota = (caminho: string) => `/api/v1${caminho}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    f = await criarDoisTenants(dono);
    await dono.tenant.update({ where: { id: f.b.id }, data: { isDemo: true } });
  }, 90_000);

  afterAll(async () => {
    await f?.limpar();
    await app?.close();
  });

  const idsDaBusca = async (query = '') => {
    const res = await request(app.getHttpServer()).get(rota(`/catalog/vehicles?limit=50${query}`));
    expect(res.status).toBe(200);
    return (res.body.items as { id: string }[]).map((v) => v.id);
  };

  it('a busca global não mostra carro da loja de demonstração', async () => {
    const ids = await idsDaBusca();
    expect(ids).toContain(f.a.veiculoPublicoId);
    expect(ids).not.toContain(f.b.veiculoPublicoId);
  });

  it('nem com filtro de marca, que é outra consulta do /buscar', async () => {
    const carro = await dono.vehicle.findUniqueOrThrow({ where: { id: f.b.veiculoPublicoId } });
    const ids = await idsDaBusca(`&brandId=${carro.brandId}`);
    expect(ids).not.toContain(f.b.veiculoPublicoId);
  });

  it('a vitrine da própria loja continua listando o estoque dela', async () => {
    const ids = await idsDaBusca(`&tenantId=${f.b.id}`);
    expect(ids).toEqual([f.b.veiculoPublicoId]);
  });

  it('o mapa não tem pino da loja de demonstração', async () => {
    const res = await request(app.getHttpServer()).get(rota('/map/dealerships'));
    expect(res.status).toBe(200);
    const pinos = (res.body as { id: string }[]).map((p) => p.id);
    expect(pinos).toContain(f.a.filialId);
    expect(pinos).not.toContain(f.b.filialId);
  });

  it('a vitrine por slug e o perfil da loja dizem que ela é de demonstração', async () => {
    const porSlug = await request(app.getHttpServer()).get(rota(`/catalog/slug/${f.b.slug}`));
    expect(porSlug.status).toBe(200);
    expect(porSlug.body.isDemo).toBe(true);

    const perfil = await request(app.getHttpServer()).get(rota(`/catalog/dealer/${f.b.id}`));
    expect(perfil.body.isDemo).toBe(true);

    const comum = await request(app.getHttpServer()).get(rota(`/catalog/slug/${f.a.slug}`));
    expect(comum.body.isDemo).toBe(false);
  });
});
