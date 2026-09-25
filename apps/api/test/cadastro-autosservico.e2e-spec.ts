import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { LimiteDeCadastro, LIMITE_DE_CADASTROS } from '../src/modules/auth/limite-de-cadastro';
import { CODIGO_EMAIL_NAO_VERIFICADO } from '../src/common/guards/email-verificado.guard';
import { promoverSuperAdmin } from '../src/scripts/promover-super-admin';
import { DURACAO_DO_TRIAL_DIAS, cnpjValido } from '@autoconnect/shared';

/**
 * # Cadastro de concessionária em autosserviço
 *
 * O piloto do primeiro dia parou no primeiro clique: a home anunciava "Criar
 * conta grátis" em cinco botões e todos caíam numa tela que exigia token de
 * convite — e num banco recém-migrado **não havia caminho para criar o primeiro
 * super admin**, logo não havia quem emitisse o convite, logo não havia como
 * existir a primeira loja.
 *
 * Este arquivo fixa a porta aberta e as travas que ela precisa:
 *
 *  - cadastro **sem convite** cria loja + administrador + filial + trial com
 *    data de fim gravada (antes `trial_ends_at` nascia nulo);
 *  - o **convite continua valendo**, é consumido, e a conta que vem por ele
 *    nasce com o e-mail já verificado;
 *  - **a BrasilAPI deixou de ser ponto único de falha**: fora do ar, 429 ou 500
 *    não impedem o cadastro. O que recusa é o dígito verificador do CNPJ e uma
 *    situação cadastral conclusivamente negativa;
 *  - **teto por IP**, no espírito do dos leads: memória de processo, sem Redis;
 *  - **o primeiro login funciona sem e-mail confirmado** — e as duas ações que
 *    falam com terceiros em nome da loja não;
 *  - o **comando do primeiro super admin** promove uma vez e recusa depois.
 *
 * `global.fetch` é substituído em todos os casos: a suíte não fala com a
 * BrasilAPI, pela mesma razão que não fala com a Clicksign.
 */
describe('Cadastro em autosserviço (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let jwt: JwtService;
  let limite: LimiteDeCadastro;

  const rota = (caminho: string) => `/api/v1${caminho}`;

  /** Tudo o que este arquivo criou, para limpar sem tocar no resto do banco. */
  const cnpjsCriados: string[] = [];

  /** CNPJ com dígitos verificadores corretos, único por chamada. */
  let contador = 0;
  function cnpjNovo(): string {
    const dv = (c: string, n: number) => {
      let s = 0, p = n - 7;
      for (let i = 0; i < n; i++) { s += Number(c[i]) * p--; if (p < 2) p = 9; }
      return s % 11 < 2 ? 0 : 11 - (s % 11);
    };
    // 8 dígitos de raiz variáveis + "0001" de matriz.
    const raiz = String(10_000_000 + ((Date.now() + contador++ * 977) % 89_999_999)).slice(0, 8);
    const base = `${raiz}0001`;
    const d1 = dv(base, 12);
    const cnpj = `${base}${d1}${dv(`${base}${d1}`, 13)}`;
    cnpjsCriados.push(cnpj);
    return cnpj;
  }

  const emailNovo = (p: string) => `${p}-${Math.random().toString(36).slice(2, 10)}@exemplo.test`;

  /** O corpo mínimo que a tela manda: cinco campos. */
  const corpoMinimo = (over: Record<string, unknown> = {}) => ({
    tenant: { cnpj: cnpjNovo(), tradeName: 'Garagem Central' },
    admin: { fullName: 'Márcio Tavares', email: emailNovo('marcio'), password: 'senha-forte-1' },
    ...over,
  });

  /**
   * Substitui a BrasilAPI. `resposta` decide o que ela "responde": um objeto
   * vira 200 com esse corpo, um número vira aquele status sem corpo útil, e
   * `'rede'` simula a conexão caindo.
   */
  function fingirBrasilApi(resposta: Record<string, unknown> | number | 'rede') {
    const espiao = jest.spyOn(globalThis, 'fetch');
    espiao.mockImplementation(async () => {
      if (resposta === 'rede') throw new Error('getaddrinfo ENOTFOUND brasilapi.com.br');
      if (typeof resposta === 'number') {
        return new Response('', { status: resposta });
      }
      return new Response(JSON.stringify(resposta), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    return espiao;
  }

  const ATIVA = { descricao_situacao_cadastral: 'ATIVA', situacao_cadastral: 2, razao_social: 'GARAGEM CENTRAL LTDA' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    dono = app.get(PrivilegedPrismaService, { strict: false });
    jwt = app.get(JwtService);
    limite = app.get(LimiteDeCadastro);
  });

  beforeEach(() => {
    // A janela é de processo e o app é um só para o arquivo inteiro: sem isto,
    // o caso do teto contaminaria todos os que vêm depois dele.
    limite.limpar();
    fingirBrasilApi(ATIVA);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    for (const cnpj of cnpjsCriados) {
      const t = await dono.tenant.findUnique({ where: { taxId: cnpj }, select: { id: true } });
      if (!t) continue;
      // `onDelete: Cascade` cobre filial e assinatura; usuário não tem cascade.
      await dono.user.deleteMany({ where: { tenantId: t.id } });
      await dono.tenant.delete({ where: { id: t.id } });
    }
    await app.close();
  });

  /* ── A porta ────────────────────────────────────────────── */

  describe('cadastro sem convite', () => {
    it('cria loja, administrador, filial e trial com data de fim', async () => {
      const corpo = corpoMinimo();
      const res = await request(app.getHttpServer())
        .post(rota('/auth/signup-tenant'))
        .send(corpo);

      expect(res.status).toBe(201);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user.role).toBe('tenant_admin');
      // Sem convite, ninguém provou o e-mail — e a sessão sai assim mesmo.
      expect(res.body.user.emailVerified).toBe(false);

      const tenant = await dono.tenant.findUnique({
        where: { taxId: (corpo.tenant as { cnpj: string }).cnpj },
        include: { subscription: true, branches: true, users: true },
      });

      expect(tenant).not.toBeNull();
      expect(tenant!.tradeName).toBe('Garagem Central');
      // Razão social não é pedida: vem da Receita quando ela responde.
      expect(tenant!.legalName).toBe('GARAGEM CENTRAL LTDA');
      // Slug não é pedido: é derivado do nome da loja.
      expect(tenant!.slug).toMatch(/^garagem-central(-\d+)?$/);
      // E-mail da loja não é pedido: nasce igual ao de acesso.
      expect(tenant!.primaryEmail.toLowerCase()).toBe((corpo.admin as { email: string }).email);

      expect(tenant!.subscription?.plan).toBe('trial');
      expect(tenant!.subscription?.status).toBe('active');
      const dias = (tenant!.subscription!.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
      expect(dias).toBeGreaterThan(DURACAO_DO_TRIAL_DIAS - 1);
      expect(dias).toBeLessThanOrEqual(DURACAO_DO_TRIAL_DIAS);

      // Uma filial matriz, sem endereço — ele é cobrado pelo checklist depois.
      expect(tenant!.branches).toHaveLength(1);
      expect(tenant!.branches[0].isHeadquarters).toBe(true);

      expect(tenant!.users).toHaveLength(1);
      expect(tenant!.users[0].role).toBe('tenant_admin');
      expect(tenant!.users[0].emailVerifiedAt).toBeNull();
      // O que saiu do formulário não vira dado inventado: fica nulo.
      expect(tenant!.users[0].cpf).toBeNull();
      expect(tenant!.users[0].jobTitle).toBeNull();
    });

    it('duas lojas com o mesmo nome ganham slugs diferentes, sem recusar a segunda', async () => {
      const primeira = await request(app.getHttpServer())
        .post(rota('/auth/signup-tenant')).send(corpoMinimo());
      const segunda = await request(app.getHttpServer())
        .post(rota('/auth/signup-tenant')).send(corpoMinimo());

      expect(primeira.status).toBe(201);
      expect(segunda.status).toBe(201);

      const slugs = await dono.tenant.findMany({
        where: { taxId: { in: cnpjsCriados.slice(-2) } },
        select: { slug: true },
      });
      expect(new Set(slugs.map((s) => s.slug)).size).toBe(2);
    });

    it('e-mail já cadastrado é 409, e nenhuma loja fica pela metade', async () => {
      const email = emailNovo('repetido');
      const primeiro = await request(app.getHttpServer())
        .post(rota('/auth/signup-tenant'))
        .send(corpoMinimo({ admin: { fullName: 'Márcio', email, password: 'senha-forte-1' } }));
      expect(primeiro.status).toBe(201);

      const cnpjDaSegunda = cnpjNovo();
      const segundo = await request(app.getHttpServer())
        .post(rota('/auth/signup-tenant'))
        .send({
          tenant: { cnpj: cnpjDaSegunda, tradeName: 'Outra Loja' },
          admin: { fullName: 'Outro', email, password: 'senha-forte-1' },
        });

      expect(segundo.status).toBe(409);
      // A checagem vem ANTES da transação: nada da segunda loja foi escrito.
      expect(await dono.tenant.findUnique({ where: { taxId: cnpjDaSegunda } })).toBeNull();
    });

    it('CNPJ com dígito verificador errado é 400 e aponta o campo', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/auth/signup-tenant'))
        .send({
          tenant: { cnpj: '11.222.333/0001-82', tradeName: 'Garagem Central' },
          admin: { fullName: 'Márcio', email: emailNovo('invalido'), password: 'senha-forte-1' },
        });

      expect(res.status).toBe(400);
      // `errors` é o que o `ZodFilter` devolve e o `ApiError` do web traduz
      // para `fieldErrors` — a tela marca o campo, em vez de "Validation failed".
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'tenant.cnpj' })]),
      );
      expect(cnpjValido('11222333000182')).toBe(false);
    });

    it('mesmo CNPJ em duas lojas é 409', async () => {
      const cnpj = cnpjNovo();
      const um = await request(app.getHttpServer()).post(rota('/auth/signup-tenant')).send({
        tenant: { cnpj, tradeName: 'Garagem Central' },
        admin: { fullName: 'Márcio', email: emailNovo('a'), password: 'senha-forte-1' },
      });
      const dois = await request(app.getHttpServer()).post(rota('/auth/signup-tenant')).send({
        tenant: { cnpj, tradeName: 'Garagem Central' },
        admin: { fullName: 'Outro', email: emailNovo('b'), password: 'senha-forte-1' },
      });
      expect(um.status).toBe(201);
      expect(dois.status).toBe(409);
    });
  });

  /* ── A BrasilAPI não é mais ponto único de falha ─────────── */

  describe('consulta à Receita é enriquecimento, não porteiro', () => {
    // Era o defeito B3: qualquer resposta não-2xx virava "CNPJ não encontrado" e
    // o cadastro parava. Um serviço gratuito, sem chave e com limite de uso,
    // decidia se alguém podia virar cliente.
    it.each([
      ['fora do ar (falha de rede)', 'rede' as const],
      ['429 — limite de uso do serviço gratuito', 429],
      ['404 — empresa nova que a Receita ainda não devolve', 404],
      ['500 — manutenção', 500],
    ])('%s não impede o cadastro', async (_nome, resposta) => {
      jest.restoreAllMocks();
      fingirBrasilApi(resposta);

      const corpo = corpoMinimo();
      const res = await request(app.getHttpServer())
        .post(rota('/auth/signup-tenant')).send(corpo);

      expect(res.status).toBe(201);
      const tenant = await dono.tenant.findUnique({
        where: { taxId: (corpo.tenant as { cnpj: string }).cnpj },
      });
      // Sem resposta da Receita, a razão social nasce igual ao nome fantasia e
      // é confirmada em /configuracoes — onde o contrato já manda o lojista.
      expect(tenant!.legalName).toBe('Garagem Central');
    });

    it('situação conclusivamente negativa continua recusando', async () => {
      jest.restoreAllMocks();
      fingirBrasilApi({ descricao_situacao_cadastral: 'BAIXADA', situacao_cadastral: 8 });

      const res = await request(app.getHttpServer())
        .post(rota('/auth/signup-tenant')).send(corpoMinimo());

      expect(res.status).toBe(400);
      expect(String(res.body.message)).toContain('BAIXADA');
    });
  });

  /* ── Teto por IP ────────────────────────────────────────── */

  it(`aceita ${LIMITE_DE_CADASTROS} cadastros por IP na janela e recusa o seguinte com 429`, async () => {
    for (let i = 0; i < LIMITE_DE_CADASTROS; i++) {
      const res = await request(app.getHttpServer())
        .post(rota('/auth/signup-tenant')).send(corpoMinimo());
      expect(res.status).toBe(201);
    }

    const excedente = await request(app.getHttpServer())
      .post(rota('/auth/signup-tenant')).send(corpoMinimo());

    expect(excedente.status).toBe(429);
    expect(String(excedente.body.message)).toContain('Tente novamente');

    // O teto vale mesmo para corpo inválido: um script que despeja lixo não
    // pode sair de graça só porque o corpo não passaria na validação.
    const lixo = await request(app.getHttpServer())
      .post(rota('/auth/signup-tenant')).send({ qualquer: 'coisa' });
    expect(lixo.status).toBe(429);
  });

  /* ── O convite continua existindo ───────────────────────── */

  describe('convite de super admin', () => {
    it('cadastro com convite consome o token e nasce com o e-mail verificado', async () => {
      const token = `convite-${Math.random().toString(36).slice(2, 12)}`;
      await dono.tenantInvite.create({
        data: { token, expiresAt: new Date(Date.now() + 86_400_000) },
      });

      const corpo = corpoMinimo({ inviteToken: token });
      const res = await request(app.getHttpServer())
        .post(rota('/auth/signup-tenant')).send(corpo);

      expect(res.status).toBe(201);
      expect(res.body.user.emailVerified).toBe(true);

      const convite = await dono.tenantInvite.findUnique({ where: { token } });
      expect(convite!.usedAt).not.toBeNull();

      await dono.tenantInvite.delete({ where: { token } });
    });

    it('convite inválido continua sendo recusado — não vira "sem convite"', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/auth/signup-tenant'))
        .send(corpoMinimo({ inviteToken: 'nao-existe' }));

      expect(res.status).toBe(400);
      expect(String(res.body.message)).toContain('Convite inválido');
    });
  });

  /* ── E-mail: o que ele trava e o que não trava ──────────── */

  describe('verificação de e-mail', () => {
    let tokenDoDono: string;
    let usuarioId: string;
    let tenantId: string;
    let veiculoId: string;
    let email: string;

    beforeEach(async () => {
      email = emailNovo('dono');
      const res = await request(app.getHttpServer())
        .post(rota('/auth/signup-tenant'))
        .send(corpoMinimo({ admin: { fullName: 'Márcio', email, password: 'senha-forte-1' } }));
      expect(res.status).toBe(201);

      tokenDoDono = res.body.accessToken;
      usuarioId = res.body.user.id;
      tenantId = res.body.user.tenantId;

      const [marca] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO vehicle_brands (name) VALUES (${`Marca ${Math.random().toString(36).slice(2, 8)}`})
        RETURNING id`;
      const [modelo] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO vehicle_models (brand_id, name) VALUES (${marca.id}::uuid, 'Modelo') RETURNING id`;
      const [v] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO vehicles (tenant_id, brand_id, model_id, year_model, year_make, price, status,
                              listing_status, color, fuel, transmission, updated_at)
        VALUES (${tenantId}::uuid, ${marca.id}::uuid, ${modelo.id}::uuid, 2022, 2022, 84900,
                'available', 'draft', 'Prata', 'flex', 'automatic', now())
        RETURNING id`;
      veiculoId = v.id;
      // Publicar exige ao menos uma foto (`domain/anuncio.ts`) — sem ela o 403
      // do e-mail e o 422 do anúncio se confundiriam.
      await dono.$executeRaw`
        INSERT INTO vehicle_images (tenant_id, vehicle_id, url, is_cover, position)
        VALUES (${tenantId}::uuid, ${veiculoId}::uuid, 'https://exemplo.test/1.jpg', true, 0)`;
    });

    it('o primeiro login funciona sem e-mail confirmado — a loja não fica trancada fora', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/auth/login'))
        .send({ email, password: 'senha-forte-1' });

      expect(res.status).toBe(201);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user.emailVerified).toBe(false);
    });

    it('explorar o painel não exige confirmação', async () => {
      const stats = await request(app.getHttpServer())
        .get(rota('/tenant/stats'))
        .set('Authorization', `Bearer ${tokenDoDono}`);
      expect(stats.status).toBe(200);
      // O endereço saiu do cadastro e passou a ser item do checklist.
      expect(stats.body.onboarding.hasAddress).toBe(false);
    });

    it('publicar anúncio e convidar equipe recusam com 403 e mensagem clara', async () => {
      const publicar = await request(app.getHttpServer())
        .post(rota(`/vehicles/${veiculoId}/publish`))
        .set('Authorization', `Bearer ${tokenDoDono}`);

      expect(publicar.status).toBe(403);
      expect(publicar.body.codigo).toBe(CODIGO_EMAIL_NAO_VERIFICADO);
      expect(String(publicar.body.message)).toContain('Confirme seu e-mail');

      const convidar = await request(app.getHttpServer())
        .post(rota('/invitations'))
        .set('Authorization', `Bearer ${tokenDoDono}`)
        .send({ email: emailNovo('vendedor'), role: 'salesperson' });

      expect(convidar.status).toBe(403);
      expect(convidar.body.codigo).toBe(CODIGO_EMAIL_NAO_VERIFICADO);

      // Nada foi criado pela tentativa.
      expect(await dono.userInvitation.count({ where: { tenantId } })).toBe(0);
    });

    it('depois de confirmar, as duas liberam — e o guard lê o banco, não o token antigo', async () => {
      const verificacao = jwt.sign({ sub: usuarioId, purpose: 'email-verification' }, { expiresIn: '24h' });
      const confirmou = await request(app.getHttpServer())
        .get(rota(`/auth/verify-email?token=${verificacao}`));
      expect(confirmou.status).toBe(200);

      // O MESMO token de sessão de antes da confirmação: se o guard lesse o
      // JWT, o dono continuaria barrado até ele expirar.
      const publicar = await request(app.getHttpServer())
        .post(rota(`/vehicles/${veiculoId}/publish`))
        .set('Authorization', `Bearer ${tokenDoDono}`);
      expect(publicar.status).toBe(201);

      const convidar = await request(app.getHttpServer())
        .post(rota('/invitations'))
        .set('Authorization', `Bearer ${tokenDoDono}`)
        .send({ email: emailNovo('vendedor'), role: 'salesperson' });
      expect(convidar.status).toBe(201);
    });

    it('reenviar responde igual existindo ou não a conta, e respeita o Zod', async () => {
      const existe = await request(app.getHttpServer())
        .post(rota('/auth/resend-verification')).send({ email });
      const naoExiste = await request(app.getHttpServer())
        .post(rota('/auth/resend-verification')).send({ email: 'ninguem@exemplo.test' });

      expect(existe.status).toBe(201);
      expect(naoExiste.status).toBe(201);
      expect(existe.body).toEqual(naoExiste.body);

      const invalido = await request(app.getHttpServer())
        .post(rota('/auth/resend-verification')).send({ email: 'nao-e-email' });
      expect(invalido.status).toBe(400);
    });

    it('o consumidor final continua tendo que confirmar antes de entrar', async () => {
      const emailDoCliente = emailNovo('cliente');
      const cadastro = await request(app.getHttpServer())
        .post(rota('/auth/signup-customer'))
        .send({ fullName: 'Juliana Prado', email: emailDoCliente, password: 'senha-forte-1' });
      expect(cadastro.status).toBe(201);

      const login = await request(app.getHttpServer())
        .post(rota('/auth/login'))
        .send({ email: emailDoCliente, password: 'senha-forte-1' });

      expect(login.status).toBe(401);
      expect(String(login.body.message)).toContain('Confirme seu e-mail');

      await dono.user.deleteMany({ where: { email: emailDoCliente } });
    });
  });

  /* ── O primeiro super admin de um banco novo ────────────── */

  describe('comando do primeiro super admin', () => {
    /**
     * Roda dentro de uma transação que é **desfeita no fim**: o banco de teste
     * é compartilhado com as outras suítes, e promover (ou apagar) super admins
     * de verdade ali quebraria o que elas assumem.
     */
    async function numaTransacaoDesfeita<T>(fn: (tx: Parameters<Parameters<PrivilegedPrismaService['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
      const marcador = new Error('rollback proposital');
      let resultado!: T;
      await dono.$transaction(async (tx) => {
        resultado = await fn(tx);
        throw marcador;
      }).catch((e: unknown) => { if (e !== marcador) throw e; });
      return resultado;
    }

    it('promove um usuário existente quando não há nenhum super admin', async () => {
      const email = emailNovo('bootstrap');
      const corpo = corpoMinimo({ admin: { fullName: 'Márcio', email, password: 'senha-forte-1' } });
      expect((await request(app.getHttpServer()).post(rota('/auth/signup-tenant')).send(corpo)).status).toBe(201);

      const resultado = await numaTransacaoDesfeita(async (tx) => {
        // Banco "novo": sem super admin nenhum.
        await tx.user.updateMany({ where: { role: 'super_admin' }, data: { role: 'manager' } });
        const r = await promoverSuperAdmin(tx, email.toUpperCase());
        expect(r.ok).toBe(true);

        const promovido = await tx.user.findUnique({ where: { email } });
        expect(promovido!.role).toBe('super_admin');
        // Super admin não pertence a loja nenhuma — senão `escopoDa` devolveria
        // o escopo daquela loja e o painel global ficaria vazio.
        expect(promovido!.tenantId).toBeNull();
        expect(promovido!.emailVerifiedAt).not.toBeNull();
        return r;
      });

      expect(resultado.ok).toBe(true);
    });

    it('recusa quando já existe super admin — é bootstrap, não escalada de privilégio', async () => {
      const email = emailNovo('tarde-demais');
      const corpo = corpoMinimo({ admin: { fullName: 'Márcio', email, password: 'senha-forte-1' } });
      expect((await request(app.getHttpServer()).post(rota('/auth/signup-tenant')).send(corpo)).status).toBe(201);

      const resultado = await numaTransacaoDesfeita(async (tx) => {
        await tx.user.update({ where: { email }, data: { role: 'super_admin' } });
        // Outro usuário qualquer tenta ser promovido com um super admin vivo.
        const outro = emailNovo('oportunista');
        await tx.user.create({
          data: { email: outro, fullName: 'Oportunista', role: 'salesperson', status: 'active' },
        });
        return promoverSuperAdmin(tx, outro);
      });

      expect(resultado).toEqual({ ok: false, motivo: 'ja-existe-super-admin', quantos: expect.any(Number) });
    });

    it('recusa e-mail que não existe, em vez de criar conta sem senha', async () => {
      const resultado = await numaTransacaoDesfeita(async (tx) => {
        await tx.user.updateMany({ where: { role: 'super_admin' }, data: { role: 'manager' } });
        return promoverSuperAdmin(tx, 'nao-existe@exemplo.test');
      });

      expect(resultado).toEqual({
        ok: false, motivo: 'usuario-nao-encontrado', email: 'nao-existe@exemplo.test',
      });
    });
  });
});
