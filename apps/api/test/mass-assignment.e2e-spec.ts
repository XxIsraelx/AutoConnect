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
 *
 * Desde 25/09/2026 o schema é `.strict()` e a recusa é **dita**: campo
 * desconhecido volta 400 apontando o nome, em vez de sumir em silêncio. O que
 * se protege é o mesmo — `isActive` e `slug` não chegam ao Prisma —, mas o
 * silêncio tinha custo próprio: três campos que a tela mandava de verdade
 * (`businessHours`, `primaryPhone`, `acceptsTradeIn`) eram descartados assim, e
 * a tela comemorava. Ver a nota em `schemas/tenant.ts`.
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

  it('`isActive` é recusado — não desativa a loja', async () => {
    const antes = (await tenant()).is_active;

    const res = await patch('/tenant/me', { isActive: false });

    expect(res.status).toBe(400);
    expect((await tenant()).is_active).toBe(antes);
  });

  it('`slug` é recusado — a URL pública não se muda por aqui', async () => {
    const antes = (await tenant()).slug;

    const res = await patch('/tenant/me', { slug: 'sequestrado' });

    expect(res.status).toBe(400);
    expect((await tenant()).slug).toBe(antes);
  });

  it('campo desconhecido volta 400 com o nome do campo, e nada é gravado', async () => {
    const antes = (await tenant()).trade_name;

    const res = await patch('/tenant/me', { tradeName: 'Outro', campoInventado: 123 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'campoInventado' })]),
    );
    // A recusa é do corpo inteiro: o campo válido que veio junto também não
    // grava. É o que torna o erro honesto — "salvou metade" é o que se quer
    // evitar.
    expect((await tenant()).trade_name).toBe(antes);
  });

  it('o horário de funcionamento chega ao banco — era descartado em silêncio', async () => {
    const expediente = {
      '0': { closed: true, open: '09:00', close: '18:00' },
      '1': { closed: false, open: '08:00', close: '19:00' },
      '6': { closed: false, open: '09:00', close: '17:00' },
    };

    const res = await patch(`/tenant/branch/${f.a.filialId}`, { businessHours: expediente });

    expect(res.status).toBe(200);
    const [linha] = await dono.$queryRaw<{ business_hours: unknown }[]>`
      SELECT business_hours FROM dealership_branches WHERE id = ${f.a.filialId}::uuid`;
    expect(linha.business_hours).toEqual(expediente);
  });

  it('expediente com fechamento antes da abertura é recusado', async () => {
    const res = await patch(`/tenant/branch/${f.a.filialId}`, {
      businessHours: { '1': { closed: false, open: '19:00', close: '08:00' } },
    });

    expect(res.status).toBe(400);
  });

  it('telefone principal e "aceita troca" gravam — os outros dois descartados', async () => {
    const res = await patch('/tenant/me', {
      primaryPhone: '(31) 3271-8080',
      acceptsTradeIn: true,
    });

    expect(res.status).toBe(200);
    const [linha] = await dono.$queryRaw<{ primary_phone: string; accepts_trade_in: boolean }[]>`
      SELECT primary_phone, accepts_trade_in FROM tenants WHERE id = ${f.a.id}::uuid`;
    expect(linha.primary_phone).toBe('(31) 3271-8080');
    expect(linha.accepts_trade_in).toBe(true);
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
