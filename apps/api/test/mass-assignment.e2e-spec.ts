import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Corpo de requisição não pode chegar cru ao Prisma.
 *
 * `PATCH /tenant/me` tinha o corpo apenas **anotado** em TypeScript e repassado
 * inteiro para `tenant.update({ data })`. Tipo não existe em tempo de execução:
 * um `tenant_admin` mandando `{"isActive": false}` desativava a própria loja, e
 * o mesmo valeria para `slug` — a URL pública da concessionária.
 *
 * Zod descarta o que não está no schema. Este teste fixa isso.
 */
describe('Corpo de requisição não vaza para o banco (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let token: string;

  const patch = (rota: string, corpo: object) =>
    request(app.getHttpServer())
      .patch(`/api/v1${rota}`)
      .set('Authorization', `Bearer ${token}`)
      .send(corpo);

  const tenant = async () => {
    const [t] = await dono.$queryRaw<{ is_active: boolean; slug: string; trade_name: string }[]>`
      SELECT is_active, slug, trade_name FROM tenants WHERE id = ${f.a.id}::uuid`;
    return t;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    f = await criarDoisTenants(dono);
    token = app.get(JwtService).sign({
      sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id,
    });
  }, 90_000);

  afterAll(async () => {
    await f?.limpar();
    await app?.close();
  });

  it('o que está no schema é gravado', async () => {
    const res = await patch('/tenant/me', { tradeName: 'Nome Novo' });

    expect(res.status).toBe(200);
    expect((await tenant()).trade_name).toBe('Nome Novo');
  });

  it('`isActive` é ignorado — não desativa a loja', async () => {
    const antes = (await tenant()).is_active;

    const res = await patch('/tenant/me', { isActive: false });

    expect(res.status).toBe(200);
    expect((await tenant()).is_active).toBe(antes);
  });

  it('`slug` é ignorado — a URL pública não se muda por aqui', async () => {
    const antes = (await tenant()).slug;

    await patch('/tenant/me', { slug: 'sequestrado' });

    expect((await tenant()).slug).toBe(antes);
  });

  it('campo desconhecido não derruba a requisição, só é descartado', async () => {
    const res = await patch('/tenant/me', { tradeName: 'Outro', campoInventado: 123 });

    expect(res.status).toBe(200);
    expect((await tenant()).trade_name).toBe('Outro');
  });

  it('valor inválido é recusado com 400', async () => {
    const res = await patch('/tenant/me', { brandColor: 'nao-e-cor' });

    expect(res.status).toBe(400);
  });

  it('CPF do representante é validado e guardado só com dígitos', async () => {
    const ruim = await patch('/tenant/me', {
      legalRepName: 'Fulano de Tal', legalRepCpf: '111.111.111-11',
    });
    expect(ruim.status).toBe(400);

    const bom = await patch('/tenant/me', {
      legalRepName: 'Carlos Souza', legalRepCpf: '529.982.247-25',
    });
    expect(bom.status).toBe(200);

    const [t] = await dono.$queryRaw<{ legal_rep_cpf: string }[]>`
      SELECT legal_rep_cpf FROM tenants WHERE id = ${f.a.id}::uuid`;
    expect(t.legal_rep_cpf).toBe('52998224725');
  });
});
