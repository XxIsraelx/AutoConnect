import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, comoApp, type DoisTenants } from './helpers/tenant-fixture';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { LimiteDeVisitante } from '../src/modules/conversations/limite-de-visitante';

/**
 * Três achados do piloto do primeiro dia que não tinham cobertura nenhuma.
 *
 * - **B7 — o mapa anunciava "0 veíc." com o estoque publicado.** A contagem era
 *   `branch._count.vehicles`, o assistente de cadastro nunca gravava
 *   `branch_id`, e nenhuma loja jamais contava nada. Aqui se fixa as duas
 *   pontas: o veículo cadastrado **nasce** na filial, e a contagem soma o que
 *   está sem filial mesmo assim — a contagem não pode voltar a mentir por causa
 *   de uma coluna vazia.
 * - **B8 — o pino caía no centro da cidade.** Não havia campo de coordenada em
 *   lugar nenhum da interface. Agora a filial aceita a coordenada do lojista,
 *   ela é marcada como `manual` e a geocodificação nunca a sobrescreve; apagar
 *   as duas devolve a filial ao pino do endereço.
 * - **B11 — o lead anônimo não tinha chat.** `POST /conversations/from-lead`
 *   respondia **400** para lead sem conta, que é o único jeito de o lead da Onda
 *   0 nascer. Agora a conversa existe, com o contato copiado, e o visitante lê e
 *   responde por um link.
 */
describe('Mapa, coordenada da filial e chat de lead sem conta (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let tokenDeAdmin: string;
  let vendedorId: string;

  const rota = (caminho: string) => `/api/v1${caminho}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    dono = app.get(PrivilegedPrismaService, { strict: false });
    f = await criarDoisTenants(dono);

    const jwt = app.get(JwtService);
    tokenDeAdmin = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });

    const [v] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO users (tenant_id, email, full_name, role, status, updated_at)
      VALUES (${f.a.id}::uuid, ${`vendedor-mapa-${Date.now()}@exemplo.test`}, 'Wesley Prado',
              'salesperson', 'active', now())
      RETURNING id`;
    vendedorId = v.id;
    await dono.$executeRaw`
      INSERT INTO salesperson_profiles (user_id, tenant_id, updated_at)
      VALUES (${vendedorId}::uuid, ${f.a.id}::uuid, now())`;

    // A filial da fixture nasce sem matriz declarada. O dia zero de uma loja de
    // verdade tem uma matriz, e é dela que o cadastro de veículo parte.
    await dono.$executeRaw`
      UPDATE dealership_branches SET is_headquarters = true WHERE id = ${f.a.filialId}::uuid`;
  }, 90_000);

  afterAll(async () => {
    await dono.$executeRaw`DELETE FROM messages WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM conversations WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM lead_interactions WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM leads WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM salesperson_profiles WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM users WHERE id = ${vendedorId}::uuid`;
    await f?.limpar();
    await app?.close();
  });

  const criarVeiculo = (corpo: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(rota('/vehicles'))
      .set('Authorization', `Bearer ${tokenDeAdmin}`)
      .send({
        brandId: f.marcaId,
        modelId: f.modeloId,
        yearModel: 2022,
        yearMake: 2022,
        price: 89900,
        ...corpo,
      });

  /* ── B7 — a filial do veículo e a contagem do mapa ─────── */

  describe('B7 — filial do veículo e contagem do mapa', () => {
    it('o veículo cadastrado nasce na matriz, sem ninguém escolher', async () => {
      const res = await criarVeiculo();
      expect(res.status).toBe(201);

      const veiculo = await dono.vehicle.findUniqueOrThrow({
        where: { id: (res.body as { id: string }).id },
        select: { branchId: true },
      });

      // Antes: `null`, e o cartão do mapa dizia "0 veíc." com o carro no ar.
      expect(veiculo.branchId).toBe(f.a.filialId);

      await dono.vehicle.delete({ where: { id: (res.body as { id: string }).id } });
    });

    it('a filial pedida é respeitada, e a de outra loja é 404', async () => {
      const certa = await criarVeiculo({ branchId: f.a.filialId });
      expect(certa.status).toBe(201);
      await dono.vehicle.delete({ where: { id: (certa.body as { id: string }).id } });

      // Sem a conferência, a chave estrangeira devolveria 500 para um dado que
      // a rota tem como checar.
      const alheia = await criarVeiculo({ branchId: f.b.filialId });
      expect(alheia.status).toBe(404);
    });

    it('o mapa conta o estoque publicado mesmo sem filial preenchida', async () => {
      // O veículo público da fixture é criado por SQL, sem `branch_id` — é
      // exatamente o dado que existia em toda loja quando o piloto rodou.
      await dono.$executeRaw`
        UPDATE vehicles SET branch_id = NULL WHERE tenant_id = ${f.a.id}::uuid`;

      const res = await request(app.getHttpServer()).get(rota('/map/dealerships'));
      expect(res.status).toBe(200);

      const pino = (res.body as { id: string; vehiclesCount: number }[])
        .find((p) => p.id === f.a.filialId);

      // Antes: 0. O veículo arquivado da fixture continua de fora — a contagem
      // é "o que o visitante encontraria ao clicar".
      expect(pino?.vehiclesCount).toBe(1);
    });

    it('o carro sem filial é somado numa filial só, não em todas', async () => {
      const [segunda] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO dealership_branches (tenant_id, name, is_active, updated_at)
        VALUES (${f.a.id}::uuid, 'Filial Bairro', true, now())
        RETURNING id`;

      const res = await request(app.getHttpServer()).get(rota('/map/dealerships'));
      const pinos = (res.body as { id: string; vehiclesCount: number }[])
        .filter((p) => p.id === f.a.filialId || p.id === segunda.id);

      expect(pinos).toHaveLength(2);
      // Um carro, uma contagem: somar nos dois pinos faria o mapa mentir para
      // cima, que é pior que mentir para baixo.
      expect(pinos.reduce((s, p) => s + p.vehiclesCount, 0)).toBe(1);
      expect(pinos.find((p) => p.id === segunda.id)?.vehiclesCount).toBe(0);

      await dono.$executeRaw`DELETE FROM dealership_branches WHERE id = ${segunda.id}::uuid`;
    });

    it('com duas filiais e nenhuma matriz, a API não chuta a filial', async () => {
      await dono.$executeRaw`
        UPDATE dealership_branches SET is_headquarters = false WHERE id = ${f.a.filialId}::uuid`;
      const [segunda] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO dealership_branches (tenant_id, name, is_active, updated_at)
        VALUES (${f.a.id}::uuid, 'Filial Sem Matriz', true, now())
        RETURNING id`;

      const res = await criarVeiculo();
      expect(res.status).toBe(201);
      const veiculo = await dono.vehicle.findUniqueOrThrow({
        where: { id: (res.body as { id: string }).id },
        select: { branchId: true },
      });
      // Estoque que se divide entre duas lojas físicas não se adivinha: quem
      // pergunta é a tela (o `select` aparece a partir da segunda filial).
      expect(veiculo.branchId).toBeNull();

      await dono.vehicle.delete({ where: { id: (res.body as { id: string }).id } });
      await dono.$executeRaw`DELETE FROM dealership_branches WHERE id = ${segunda.id}::uuid`;
      await dono.$executeRaw`
        UPDATE dealership_branches SET is_headquarters = true WHERE id = ${f.a.filialId}::uuid`;
    });
  });

  /* ── B8 — a coordenada da filial ───────────────────────── */

  describe('B8 — coordenada da filial', () => {
    it('a coordenada informada pelo lojista é gravada como `manual`', async () => {
      const res = await request(app.getHttpServer())
        .patch(rota(`/tenant/branch/${f.a.filialId}`))
        .set('Authorization', `Bearer ${tokenDeAdmin}`)
        .send({
          addressLine: 'Rua dos Aimorés',
          addressNumber: '1200',
          city: 'Belo Horizonte',
          state: 'MG',
          postalCode: '30140-071',
          latitude: -19.9245,
          longitude: -43.9352,
        });

      expect(res.status).toBe(200);

      const filial = await dono.dealershipBranch.findUniqueOrThrow({
        where: { id: f.a.filialId },
        select: { latitude: true, longitude: true, geocodePrecision: true },
      });
      expect(filial.latitude).toBeCloseTo(-19.9245, 4);
      expect(filial.longitude).toBeCloseTo(-43.9352, 4);
      // É o que impede a geocodificação de sobrescrever quem sabe onde a loja
      // fica: o dono dela.
      expect(filial.geocodePrecision).toBe('manual');
    });

    it('o mapa entrega a coordenada e a precisão, sem mexer no que é manual', async () => {
      const res = await request(app.getHttpServer()).get(rota('/map/dealerships'));
      const pino = (res.body as {
        id: string; latitude: number; longitude: number; geocodePrecision: string;
      }[]).find((p) => p.id === f.a.filialId);

      expect(pino?.latitude).toBeCloseTo(-19.9245, 4);
      // A tela usa isto para dizer "pino aproximado" — e para mandar o "Como
      // chegar" pelo endereço escrito em vez do ponto, quando é município.
      expect(pino?.geocodePrecision).toBe('manual');
    });

    it('meia coordenada é recusada por campo — não vira ponto no Atlântico', async () => {
      const res = await request(app.getHttpServer())
        .patch(rota(`/tenant/branch/${f.a.filialId}`))
        .set('Authorization', `Bearer ${tokenDeAdmin}`)
        .send({ latitude: -19.9245 });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('longitude');
    });

    it('apagar as duas devolve a filial ao pino do endereço', async () => {
      const res = await request(app.getHttpServer())
        .patch(rota(`/tenant/branch/${f.a.filialId}`))
        .set('Authorization', `Bearer ${tokenDeAdmin}`)
        .send({ latitude: null, longitude: null });

      expect(res.status).toBe(200);

      const filial = await dono.dealershipBranch.findUniqueOrThrow({
        where: { id: f.a.filialId },
        select: { latitude: true, geocodePrecision: true, geocodedAt: true },
      });
      expect(filial.latitude).toBeNull();
      // Precisão e carimbo zerados: é o que libera uma nova busca pelo endereço.
      expect(filial.geocodePrecision).toBeNull();
      expect(filial.geocodedAt).toBeNull();
    });

    it('coordenada fora do planeta é recusada', async () => {
      const res = await request(app.getHttpServer())
        .patch(rota(`/tenant/branch/${f.a.filialId}`))
        .set('Authorization', `Bearer ${tokenDeAdmin}`)
        .send({ latitude: 120, longitude: -43.9 });

      expect(res.status).toBe(400);
    });
  });

  /* ── B11 — o chat do lead sem conta ────────────────────── */

  describe('B11 — chat de lead sem conta', () => {
    let leadAnonimoId: string;
    let conversaId: string;
    let link: string;

    beforeAll(async () => {
      app.get(LimiteDeVisitante).limpar();

      // O lead da Onda 0: entra pela rota pública, sem conta.
      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send({
          vehicleId: f.a.veiculoPublicoId,
          contactName: 'Juliana Prado',
          contactPhone: '(31) 98877-6655',
          contactEmail: `juliana-${Math.random().toString(36).slice(2, 8)}@exemplo.test`,
          consentimento: true,
          consentText:
            'Autorizo o contato desta concessionária sobre este veículo e o tratamento dos ' +
            'meus dados para esse fim.',
        });
      expect(res.status).toBe(201);
      leadAnonimoId = (res.body as { leadId: string }).leadId;
    });

    it('a conversa nasce sem conta, com o contato copiado e um link', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/conversations/from-lead'))
        .set('Authorization', `Bearer ${tokenDeAdmin}`)
        .send({ leadId: leadAnonimoId });

      // Antes: 400 "só é possível conversar pelo chat com clientes que possuem conta".
      expect(res.status).toBe(201);
      const corpo = res.body as { id: string; guestUrl: string; customerUserId: string | null };
      expect(corpo.customerUserId).toBeNull();
      expect(corpo.guestUrl).toMatch(/\/conversa\/[A-Za-z0-9_-]{20,}$/);

      conversaId = corpo.id;
      link = corpo.guestUrl;

      const conversa = await dono.conversation.findUniqueOrThrow({
        where: { id: conversaId },
        select: {
          contactName: true, contactPhone: true, contactEmail: true,
          guestTokenHash: true, leadId: true, vehicleId: true, salespersonId: true,
        },
      });
      // Contato copiado, como no agendamento sem conta: a conversa precisa dizer
      // com quem é mesmo que o lead seja apagado depois.
      expect(conversa.contactName).toBe('Juliana Prado');
      expect(conversa.contactPhone).toBeTruthy();
      expect(conversa.leadId).toBe(leadAnonimoId);
      expect(conversa.vehicleId).toBe(f.a.veiculoPublicoId);
      // O token cru não fica no banco — só o hash, como no convite de equipe.
      expect(conversa.guestTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(link).not.toContain(conversa.guestTokenHash!);
    });

    it('abrir de novo devolve a mesma conversa, sem duplicar', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/conversations/from-lead'))
        .set('Authorization', `Bearer ${tokenDeAdmin}`)
        .send({ leadId: leadAnonimoId });

      expect(res.status).toBe(201);
      expect((res.body as { id: string }).id).toBe(conversaId);
      // O link cru não é mostrado duas vezes: o banco só tem o hash.
      expect((res.body as { guestUrl: string | null }).guestUrl).toBeNull();
    });

    it('a loja escreve e o visitante lê pelo link, sem conta', async () => {
      const token = link.split('/').pop()!;

      await dono.message.create({
        data: {
          conversationId: conversaId,
          tenantId: f.a.id,
          senderUserId: vendedorId,
          body: 'Oi Juliana, o Onix está disponível para test drive amanhã.',
          kind: 'text',
        },
      });

      const res = await request(app.getHttpServer()).get(rota(`/public/conversations/${token}`));

      expect(res.status).toBe(200);
      const corpo = res.body as {
        conversa: { contactName: string; tenant: { tradeName: string } };
        mensagens: { body: string; deLoja: boolean; autor: string | null }[];
      };
      expect(corpo.conversa.contactName).toBe('Juliana Prado');
      expect(corpo.conversa.tenant.tradeName).toBeTruthy();
      expect(corpo.mensagens).toHaveLength(1);
      expect(corpo.mensagens[0].deLoja).toBe(true);
      expect(corpo.mensagens[0].body).toContain('test drive');
    });

    it('o visitante responde, e a resposta é dele — não da loja', async () => {
      const token = link.split('/').pop()!;

      const res = await request(app.getHttpServer())
        .post(rota(`/public/conversations/${token}/messages`))
        .send({ body: 'Pode ser amanhã às 10h?' });

      expect(res.status).toBe(201);
      expect((res.body as { deLoja: boolean }).deLoja).toBe(false);

      const mensagens = await dono.message.findMany({
        where: { conversationId: conversaId },
        orderBy: { createdAt: 'asc' },
        select: { senderUserId: true, body: true },
      });
      expect(mensagens).toHaveLength(2);
      // Sem usuário: é o que distingue os dois lados na tela, dos dois lados.
      expect(mensagens[1].senderUserId).toBeNull();
      expect(mensagens[1].body).toContain('10h');
    });

    it('token inválido é 404 — e não diz que a conversa existe', async () => {
      await request(app.getHttpServer())
        .get(rota('/public/conversations/naoexisteestetokenaqui123456'))
        .expect(404);

      await request(app.getHttpServer())
        .post(rota('/public/conversations/naoexisteestetokenaqui123456/messages'))
        .send({ body: 'oi' })
        .expect(404);

      // Curto demais para ser token: recusado antes de chegar ao banco.
      await request(app.getHttpServer()).get(rota('/public/conversations/abc')).expect(404);
    });

    it('corpo vazio é recusado com erro de campo', async () => {
      const token = link.split('/').pop()!;
      const res = await request(app.getHttpServer())
        .post(rota(`/public/conversations/${token}/messages`))
        .send({ body: '   ' });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('body');
    });

    it('gerar um link novo invalida o anterior', async () => {
      const antigo = link.split('/').pop()!;

      const res = await request(app.getHttpServer())
        .post(rota(`/conversations/${conversaId}/guest-link`))
        .set('Authorization', `Bearer ${tokenDeAdmin}`)
        .send();

      expect(res.status).toBe(201);
      const novo = (res.body as { guestUrl: string }).guestUrl.split('/').pop()!;
      expect(novo).not.toBe(antigo);

      await request(app.getHttpServer()).get(rota(`/public/conversations/${antigo}`)).expect(404);
      await request(app.getHttpServer()).get(rota(`/public/conversations/${novo}`)).expect(200);

      link = (res.body as { guestUrl: string }).guestUrl;
    });

    it('conversa encerrada não recebe mensagem do visitante', async () => {
      const token = link.split('/').pop()!;
      await request(app.getHttpServer())
        .patch(rota(`/conversations/${conversaId}/close`))
        .set('Authorization', `Bearer ${tokenDeAdmin}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(rota(`/public/conversations/${token}/messages`))
        .send({ body: 'ainda tem?' });

      expect(res.status).toBe(400);
      // Ler continua valendo: o histórico é dele também.
      await request(app.getHttpServer()).get(rota(`/public/conversations/${token}`)).expect(200);

      await dono.conversation.update({ where: { id: conversaId }, data: { status: 'open' } });
    });

    it('lead com conta continua entrando pelo login, sem link', async () => {
      const [lead] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO leads (tenant_id, customer_user_id, contact_name, updated_at)
        VALUES (${f.a.id}::uuid, ${f.a.usuarioId}::uuid, 'Cliente com conta', now())
        RETURNING id`;

      const res = await request(app.getHttpServer())
        .post(rota('/conversations/from-lead'))
        .set('Authorization', `Bearer ${tokenDeAdmin}`)
        .send({ leadId: lead.id });

      expect(res.status).toBe(201);
      const corpo = res.body as { id: string; guestUrl: string | null; customerUserId: string };
      expect(corpo.customerUserId).toBe(f.a.usuarioId);
      expect(corpo.guestUrl).toBeNull();

      // E não dá para forçar um link para quem tem conta: ele entra pelo login.
      await request(app.getHttpServer())
        .post(rota(`/conversations/${corpo.id}/guest-link`))
        .set('Authorization', `Bearer ${tokenDeAdmin}`)
        .expect(400);
    });

    it('a conversa sem conta não vaza para o papel da aplicação sem contexto', async () => {
      const prisma = app.get(PrismaService, { strict: false });

      // Sem `app.tenant_id` nem `app.user_id`, o RLS fecha tudo — inclusive a
      // conversa que não pertence a cliente nenhum. Era a preocupação de tornar
      // `customer_user_id` nulo: a policy `acesso_cliente` compara essa coluna,
      // e nulo não pode virar "de todos".
      const semContexto = await comoApp(prisma, {}, (tx) =>
        tx.$queryRawUnsafe('SELECT count(*)::int AS n FROM conversations'),
      );
      expect((semContexto as { n: number }[])[0].n).toBe(0);

      // E com o contexto de OUTRA loja, também não.
      const outraLoja = await comoApp(prisma, { tenantId: f.b.id }, (tx) =>
        tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM conversations WHERE id = '${conversaId}'`),
      );
      expect((outraLoja as { n: number }[])[0].n).toBe(0);

      // A loja dona vê.
      const daLoja = await comoApp(prisma, { tenantId: f.a.id }, (tx) =>
        tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM conversations WHERE id = '${conversaId}'`),
      );
      expect((daLoja as { n: number }[])[0].n).toBe(1);
    });

    it('a conversa aparece na caixa da loja identificada pelo contato copiado', async () => {
      const res = await request(app.getHttpServer())
        .get(rota('/conversations'))
        .set('Authorization', `Bearer ${tokenDeAdmin}`);

      expect(res.status).toBe(200);
      const item = (res.body as {
        items: { id: string; customer: unknown; contactName: string | null }[];
      }).items.find((c) => c.id === conversaId);

      expect(item).toBeDefined();
      expect(item!.customer).toBeNull();
      expect(item!.contactName).toBe('Juliana Prado');
    });
  });
});
