import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Convite de equipe, ponta a ponta — pela **rota HTTP**, de propósito.
 *
 * O `PublicInvitationsController` existia, tinha `@Public()` e `@Post('accept')`,
 * e não estava em `controllers:` do `InvitationsModule`: a rota respondia 404 e
 * nenhum vendedor entrava na loja. Nenhum teste pegou isso porque nenhum
 * chegava a bater na rota — é a armadilha nº 1 do CLAUDE.md invertida, e o
 * único jeito de fixá-la é um caso que atravesse o HTTP.
 *
 * Por isso o caminho inteiro está aqui: convidar, aceitar com token válido, e
 * as três recusas (expirado, já usado, inexistente).
 */
describe('Convite de equipe (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let tokenDeAdmin: string;

  const rota = (caminho: string) => `/api/v1${caminho}`;

  /** E-mails criados aqui, para limpar sem tocar no resto da fixture. */
  const emailsCriados: string[] = [];

  const emailNovo = (prefixo: string) => {
    const e = `${prefixo}-${Math.random().toString(36).slice(2, 10)}@exemplo.test`;
    emailsCriados.push(e);
    return e;
  };

  /** Cria o convite pela rota privada e devolve o token cru da URL de aceite. */
  async function convidar(
    email: string,
    role: 'salesperson' | 'manager' | 'tenant_admin' = 'salesperson',
  ): Promise<{ id: string; token: string }> {
    const res = await request(app.getHttpServer())
      .post(rota('/invitations'))
      .set('Authorization', `Bearer ${tokenDeAdmin}`)
      .send({ email, role });

    expect(res.status).toBe(201);
    const acceptUrl: string = res.body.acceptUrl;
    expect(acceptUrl).toContain('/invite/');
    return { id: res.body.id, token: acceptUrl.split('/invite/')[1] };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    dono = app.get(PrivilegedPrismaService, { strict: false });
    f = await criarDoisTenants(dono);

    tokenDeAdmin = app
      .get(JwtService)
      .sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
  }, 90_000);

  afterAll(async () => {
    if (emailsCriados.length) {
      await dono.userInvitation.deleteMany({ where: { email: { in: emailsCriados } } });
      await dono.salespersonProfile.deleteMany({
        where: { user: { email: { in: emailsCriados } } },
      });
      await dono.user.deleteMany({ where: { email: { in: emailsCriados } } });
    }
    await f?.limpar();
    await app?.close();
  });

  it('a rota pública de aceite está montada — não pode responder 404', async () => {
    // Corpo vazio: interessa só que a rota EXISTA. Um 404 aqui é o defeito do
    // primeiro dia (`Cannot POST /api/v1/public/invitations/accept`).
    const res = await request(app.getHttpServer())
      .post(rota('/public/invitations/accept'))
      .send({});

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(400);
  });

  it('convidar → aceitar: o vendedor entra na loja, já logado', async () => {
    const email = emailNovo('wesley');
    const { id, token } = await convidar(email);

    const res = await request(app.getHttpServer())
      .post(rota('/public/invitations/accept'))
      .send({ token, fullName: 'Wesley Prado', password: 'senha-forte-123', phone: '31988776655' });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      email,
      fullName: 'Wesley Prado',
      role: 'salesperson',
      tenantId: f.a.id,
    });

    // Nasce ativo e verificado: o convite já provou o e-mail.
    const usuario = await dono.user.findUniqueOrThrow({ where: { email } });
    expect(usuario.status).toBe('active');
    expect(usuario.emailVerifiedAt).toBeInstanceOf(Date);
    expect(usuario.passwordHash).toEqual(expect.any(String));

    // Vendedor ganha perfil, que é o que o põe no rodízio.
    const perfil = await dono.salespersonProfile.findUnique({ where: { userId: usuario.id } });
    expect(perfil).not.toBeNull();

    // E o token com que ele entra serve de verdade.
    const painel = await request(app.getHttpServer())
      .get(rota('/tenant/me'))
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(painel.status).toBe(200);
    expect(painel.body.tenant).toMatchObject({ id: f.a.id });

    // O convite sai da lista de pendentes.
    const pendentes = await request(app.getHttpServer())
      .get(rota('/invitations'))
      .set('Authorization', `Bearer ${tokenDeAdmin}`);
    expect(pendentes.body.map((i: { id: string }) => i.id)).not.toContain(id);
  });

  it('token expirado é recusado, e ninguém é criado', async () => {
    const email = emailNovo('expirado');
    const { id, token } = await convidar(email);

    await dono.userInvitation.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await request(app.getHttpServer())
      .post(rota('/public/invitations/accept'))
      .send({ token, fullName: 'Quem Demorou', password: 'senha-forte-123' });

    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/expirado/i);
    expect(await dono.user.count({ where: { email } })).toBe(0);
  });

  it('token já usado não cria um segundo usuário', async () => {
    const email = emailNovo('repetido');
    const { token } = await convidar(email);

    const primeiro = await request(app.getHttpServer())
      .post(rota('/public/invitations/accept'))
      .send({ token, fullName: 'Primeira Vez', password: 'senha-forte-123' });
    expect(primeiro.status).toBe(201);

    const segundo = await request(app.getHttpServer())
      .post(rota('/public/invitations/accept'))
      .send({ token, fullName: 'Segunda Vez', password: 'senha-forte-123' });

    expect(segundo.status).toBe(400);
    expect(String(segundo.body.message)).toMatch(/já utilizado/i);
    expect(await dono.user.count({ where: { email } })).toBe(1);
  });

  it('token inexistente responde 404, sem dizer nada da loja', async () => {
    const res = await request(app.getHttpServer())
      .post(rota('/public/invitations/accept'))
      .send({
        token: 'token-que-nunca-existiu-0123456789',
        fullName: 'Ninguém',
        password: 'senha-forte-123',
      });

    expect(res.status).toBe(404);
    expect(String(res.body.message)).toMatch(/inválido/i);
  });

  it('corpo inválido volta com erro de campo, não com 500', async () => {
    const { token } = await convidar(emailNovo('curta'));

    const res = await request(app.getHttpServer())
      .post(rota('/public/invitations/accept'))
      .send({ token, fullName: 'Senha Curta', password: '123' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
    );
  });
});
