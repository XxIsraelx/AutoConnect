import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TasksService } from '../src/modules/tasks/tasks.service';
import { LimitePorIp, LIMITE_POR_JANELA } from '../src/modules/leads/limite-por-ip';
import { criarDoisTenants, comoApp, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Onda 0 — "o funil não pode vazar".
 *
 * O que estes casos fixam é justamente o que estava quebrado: o visitante que
 * não vira lead, o vendedor que não cadastra quem ligou, o mesmo cliente
 * virando três leads, e o agendamento impossível para quem não tem conta.
 *
 * Contra Postgres de verdade porque tudo que importa aqui só existe lá: a
 * constraint do agendamento, o índice único do contato, o `citext` do e-mail e
 * o RLS que separa as duas lojas.
 */
describe('Onda 0 — captura de lead e agendamento (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let prisma: PrismaService;
  let f: DoisTenants;
  let tokenDeA: string;
  let tokenDeB: string;
  let limite: LimitePorIp;

  const rota = (caminho: string) => `/api/v1${caminho}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    dono = app.get(PrivilegedPrismaService, { strict: false });
    prisma = app.get(PrismaService, { strict: false });
    f = await criarDoisTenants(dono);

    const jwt = app.get(JwtService);
    tokenDeA = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
    tokenDeB = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });
    limite = app.get(LimitePorIp, { strict: false });
  }, 90_000);

  // Todos os casos saem do mesmo IP e do mesmo veículo, ou seja, da mesma
  // chave do limite. Zerar entre casos isola o que cada um mede — o teto tem
  // um caso só para ele, mais abaixo.
  beforeEach(() => limite.limpar());

  afterAll(async () => {
    // As interações são apagadas em cascata com os leads; os agendamentos
    // novos e os leads criados aqui saem junto da fixture.
    await f?.limpar();
    await app?.close();
  });

  /** Corpo válido do formulário público, com o contato variável por caso. */
  const formulario = (over: Record<string, unknown> = {}) => ({
    vehicleId: f.a.veiculoPublicoId,
    contactName: 'Joana Compradora',
    contactPhone: '(11) 98765-4321',
    consentimento: true,
    consentText:
      'Autorizo o contato desta concessionária e o tratamento dos meus dados para esse fim.',
    ...over,
  });

  /* ── 1. Lead anônimo ─────────────────────────────────── */

  describe('lead anônimo', () => {
    it('cria lead sem token nenhum — é o furo principal do funil', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 90000-0001', message: 'Tem para test drive?' }));

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ ok: true, deduplicado: false });
      expect(res.body.leadId).toEqual(expect.any(String));

      const lead = await dono.lead.findUniqueOrThrow({ where: { id: res.body.leadId } });
      expect(lead.tenantId).toBe(f.a.id);
      expect(lead.customerUserId).toBeNull();
      expect(lead.vehicleId).toBe(f.a.veiculoPublicoId);
      // O telefone é guardado como veio E na forma canônica: é a canônica que
      // faz a deduplicação enxergar as outras grafias.
      expect(lead.contactPhoneNormalized).toBe('11900000001');
      expect(lead.consentedAt).toBeInstanceOf(Date);
      expect(lead.consentText).toContain('Autorizo o contato');
    });

    it('sem consentimento responde 400, apontando o campo', async () => {
      const semAceite = formulario({ contactPhone: '(11) 90000-0002' });
      delete (semAceite as Record<string, unknown>).consentimento;

      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(semAceite);

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'consentimento' })]),
      );

      const criados = await dono.lead.count({
        where: { tenantId: f.a.id, contactPhone: '(11) 90000-0002' },
      });
      expect(criados).toBe(0);
    });

    it('consentimento explicitamente recusado também é 400 — `false` não é "não marcou"', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 90000-0003', consentimento: false }));

      expect(res.status).toBe(400);
    });

    it('telefone inválido é recusado antes de virar lead', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '1234' }));

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'contactPhone' })]),
      );
    });

    it('o honeypot descarta em silêncio, com a mesma cara de sucesso', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 90000-0004', website: 'http://spam.example' }));

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ ok: true, leadId: null });

      const criados = await dono.lead.count({
        where: { tenantId: f.a.id, contactPhone: '(11) 90000-0004' },
      });
      expect(criados).toBe(0);
    });

    it('a loja vem do VEÍCULO, não do corpo: tenantId trocado responde 404', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 90000-0005', tenantId: f.b.id }));

      // 404 e não 403: confirmar "esse veículo não é dessa loja" já conta
      // demais para quem está de fora.
      expect(res.status).toBe(404);
      const vazou = await dono.lead.count({ where: { tenantId: f.b.id, contactPhone: '(11) 90000-0005' } });
      expect(vazou).toBe(0);
    });

    it('veículo fora da vitrine não aceita lead — a policy pública não o enxerga', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 90000-0006', vehicleId: f.a.veiculoPrivadoId }));

      expect(res.status).toBe(404);
    });

    it('sem veículo, aceita a loja pelo tenantId', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send({
          ...formulario({ contactPhone: '(11) 90000-0007' }),
          vehicleId: undefined,
          tenantId: f.a.id,
        });

      expect(res.status).toBe(201);
      const lead = await dono.lead.findUniqueOrThrow({ where: { id: res.body.leadId } });
      expect(lead.tenantId).toBe(f.a.id);
      expect(lead.vehicleId).toBeNull();
    });
  });

  /* ── 2. Antiabuso ────────────────────────────────────── */

  describe('teto de envios por IP', () => {
    it('recusa o envio seguinte ao limite, sem criar lead', async () => {
      // Telefones diferentes de propósito: senão o que barraria seria a
      // deduplicação, e o teste passaria sem provar nada sobre o teto.
      for (let i = 0; i < LIMITE_POR_JANELA; i++) {
        const ok = await request(app.getHttpServer())
          .post(rota('/leads/public'))
          .send(formulario({ contactPhone: `(11) 9800${i}-000${i}` }));
        expect(ok.status).toBe(201);
      }

      const barrado = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 98099-9999' }));

      expect(barrado.status).toBe(409);
      const criados = await dono.lead.count({
        where: { tenantId: f.a.id, contactPhone: '(11) 98099-9999' },
      });
      expect(criados).toBe(0);
    });
  });

  /* ── 3. Deduplicação ─────────────────────────────────── */

  describe('deduplicação', () => {
    it('três cliques seguidos viram UM lead e duas interações', async () => {
      const telefone = '(21) 97777-1111';

      const respostas = [];
      for (let i = 0; i < 3; i++) {
        respostas.push(
          await request(app.getHttpServer())
            .post(rota('/leads/public'))
            .send(formulario({ contactPhone: telefone, message: `tentativa ${i + 1}` })),
        );
      }

      expect(respostas.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(respostas.map((r) => r.body.deduplicado)).toEqual([false, true, true]);
      // O mesmo lead volta nas três, para a tela poder mostrar o atendimento.
      expect(new Set(respostas.map((r) => r.body.leadId)).size).toBe(1);

      const leads = await dono.lead.findMany({
        where: { tenantId: f.a.id, contactPhoneNormalized: '21977771111' },
      });
      expect(leads).toHaveLength(1);

      const interacoes = await dono.leadInteraction.findMany({
        where: { leadId: leads[0].id },
        orderBy: { occurredAt: 'asc' },
      });
      // `rotation` entrou com a Onda 1: o rodízio roda em toda criação e
      // registra o resultado — aqui, "ninguém de plantão", porque a fixture não
      // tem vendedor. O contato repetido continua sem passar pelo rodízio.
      expect(interacoes.map((i) => i.kind))
        .toEqual(['created', 'rotation', 'duplicate', 'duplicate']);
      expect(interacoes[3].content).toContain('tentativa 3');
    });

    it('casa grafias diferentes do mesmo número, com e sem DDI e nono dígito', async () => {
      const primeiro = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '1188887777' }));
      expect(primeiro.body.deduplicado).toBe(false);

      for (const grafia of ['+55 11 98888-7777', '11988887777', '(11)98888.7777']) {
        const res = await request(app.getHttpServer())
          .post(rota('/leads/public'))
          .send(formulario({ contactPhone: grafia }));

        expect(res.body).toMatchObject({ deduplicado: true, leadId: primeiro.body.leadId });
      }
    });

    it('casa por e-mail quando o telefone é outro', async () => {
      const email = 'mesma.pessoa@exemplo.test';

      const primeiro = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(31) 96666-0001', contactEmail: email }));

      const segundo = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(31) 96666-0002', contactEmail: email }));

      expect(segundo.body).toMatchObject({ deduplicado: true, leadId: primeiro.body.leadId });
    });

    it('lead em status terminal NÃO recebe o contato novo — é atendimento novo', async () => {
      const primeiro = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(41) 95555-0001' }));

      await dono.lead.update({
        where: { id: primeiro.body.leadId },
        data: { status: 'lost' },
      });

      const segundo = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(41) 95555-0001' }));

      expect(segundo.body.deduplicado).toBe(false);
      expect(segundo.body.leadId).not.toBe(primeiro.body.leadId);
    });

    it('não atravessa lojas: o mesmo telefone na loja B cria lead próprio', async () => {
      const telefone = '(51) 94444-0001';

      await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: telefone }));

      const naB = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: telefone, vehicleId: f.b.veiculoPublicoId }));

      expect(naB.body.deduplicado).toBe(false);

      const daB = await dono.lead.findUniqueOrThrow({ where: { id: naB.body.leadId } });
      expect(daB.tenantId).toBe(f.b.id);
    });
  });

  /* ── 4. Lead manual ──────────────────────────────────── */

  describe('lead manual', () => {
    it('quem cadastra à mão sendo gerência não fica com o lead: vai para o rodízio', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/manual'))
        .set('Authorization', `Bearer ${tokenDeA}`)
        .send({
          contactName: 'Carlos do Balcão',
          contactPhone: '(11) 93333-0001',
          source: 'walk_in',
          message: 'Passou na loja e viu o carro da vitrine',
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        deduplicado: false,
        source: 'walk_in',
        tenantId: f.a.id,
      });
      // `tokenDeA` é tenant_admin: pela regra do rodízio (Onda 1), gerência
      // cadastra o que chegou por fora e não fica com o lead. Sem vendedor
      // elegível na fixture, ele nasce sem responsável e cai na fila.
      expect(res.body.assignedTo).toBeNull();
    });

    it('vendedor que cadastra à mão fica com o próprio lead', async () => {
      const [{ id: vendedorId }] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO users (tenant_id, email, full_name, role, status, updated_at)
        VALUES (${f.a.id}::uuid, ${`vend.${Date.now()}@teste.local`}, 'Vendedor Teste',
                'salesperson', 'active', now())
        RETURNING id`;
      const tokenVendedor = app
        .get(JwtService)
        .sign({ sub: vendedorId, role: 'salesperson', tenantId: f.a.id });

      const res = await request(app.getHttpServer())
        .post(rota('/leads/manual'))
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send({
          contactName: 'Cliente do Vendedor',
          contactPhone: '(11) 93333-0777',
          source: 'phone',
        });

      expect(res.status).toBe(201);
      expect(res.body.assignedTo).toBe(vendedorId);
    });

    it('origem que o sistema escreve sozinho (website) é recusada no cadastro manual', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/manual'))
        .set('Authorization', `Bearer ${tokenDeA}`)
        .send({ contactName: 'Fulano', contactPhone: '(11) 93333-0002', source: 'website' });

      expect(res.status).toBe(400);
    });

    it('cai na mesma deduplicação da rota pública', async () => {
      const telefone = '(11) 92222-0001';

      const doSite = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: telefone }));

      const doBalcao = await request(app.getHttpServer())
        .post(rota('/leads/manual'))
        .set('Authorization', `Bearer ${tokenDeA}`)
        .send({ contactName: 'A mesma pessoa', contactPhone: telefone, source: 'phone' });

      expect(doBalcao.body).toMatchObject({ deduplicado: true, id: doSite.body.leadId });
    });

    it('veículo de outra loja responde 404', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/manual'))
        .set('Authorization', `Bearer ${tokenDeA}`)
        .send({
          contactName: 'Tentativa',
          contactPhone: '(11) 91111-0001',
          source: 'phone',
          vehicleId: f.b.veiculoPublicoId,
        });

      expect(res.status).toBe(404);
    });
  });

  /* ── 5. Agendamento pela loja ────────────────────────── */

  describe('agendamento criado pelo vendedor', () => {
    const daquiADias = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

    it('agenda para contato avulso, sem conta nenhuma', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/appointments/dealer'))
        .set('Authorization', `Bearer ${tokenDeA}`)
        .send({
          contactName: 'Marta Sem Conta',
          contactPhone: '(11) 98888-0001',
          type: 'test_drive',
          scheduledStart: daquiADias(3),
          vehicleId: f.a.veiculoPublicoId,
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        customerUserId: null,
        contactName: 'Marta Sem Conta',
        salespersonId: f.a.usuarioId,
        status: 'scheduled',
      });
      // Uma hora por padrão.
      expect(new Date(res.body.scheduledEnd).getTime() - new Date(res.body.scheduledStart).getTime())
        .toBe(60 * 60 * 1000);
    });

    it('sem cliente, sem lead e sem contato é 400 — agendamento anônimo não diz quem esperar', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/appointments/dealer'))
        .set('Authorization', `Bearer ${tokenDeA}`)
        .send({ type: 'in_person', scheduledStart: daquiADias(2) });

      expect(res.status).toBe(400);
    });

    it('a mesma regra vale no banco, não só no Zod', async () => {
      // A constraint existe para o caminho que o Zod não cobre — uma escrita
      // futura, um script, uma migração de dados.
      await expect(
        dono.$executeRaw`
          INSERT INTO appointments (tenant_id, type, scheduled_start, scheduled_end, updated_at)
          VALUES (${f.a.id}::uuid, 'test_drive', now() + interval '2 days',
                  now() + interval '2 days 1 hour', now())`,
      ).rejects.toThrow(/appointments_tem_contato/);
    });

    it('a partir de um lead, copia o contato e registra na timeline', async () => {
      const doSite = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 98888-0002', contactEmail: 'agendado@exemplo.test' }));

      const res = await request(app.getHttpServer())
        .post(rota('/appointments/dealer'))
        .set('Authorization', `Bearer ${tokenDeA}`)
        .send({
          leadId: doSite.body.leadId,
          type: 'test_drive',
          scheduledStart: daquiADias(4),
          durationMinutes: 30,
        });

      expect(res.status).toBe(201);
      // Copiado, não referenciado: o agendamento continua sabendo quem esperar
      // mesmo se o lead sumir.
      expect(res.body).toMatchObject({
        leadId: doSite.body.leadId,
        contactName: 'Joana Compradora',
        contactEmail: 'agendado@exemplo.test',
      });
      expect(new Date(res.body.scheduledEnd).getTime() - new Date(res.body.scheduledStart).getTime())
        .toBe(30 * 60 * 1000);

      const timeline = await dono.leadInteraction.findMany({
        where: { leadId: doSite.body.leadId, kind: 'visit' },
      });
      expect(timeline).toHaveLength(1);
    });

    it('lead de outra loja responde 404', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/appointments/dealer'))
        .set('Authorization', `Bearer ${tokenDeA}`)
        .send({ leadId: f.b.leadId, type: 'in_person', scheduledStart: daquiADias(5) });

      expect(res.status).toBe(404);
    });

    it('a busca por nome alcança o contato avulso', async () => {
      const res = await request(app.getHttpServer())
        .get(rota('/appointments?q=Marta Sem Conta'))
        .set('Authorization', `Bearer ${tokenDeA}`);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items[0].contactName).toBe('Marta Sem Conta');
    });
  });

  /* ── 6. Lembrete sem e-mail ──────────────────────────── */

  describe('lembrete de agendamento', () => {
    it('não quebra com contato avulso sem e-mail, e continua idempotente', async () => {
      const semEmail = await dono.appointment.create({
        data: {
          tenantId: f.a.id,
          contactName: 'Só Telefone',
          contactPhone: '11987650000',
          type: 'test_drive',
          status: 'scheduled',
          // Dentro da janela de 24h que o cron varre.
          scheduledStart: new Date(Date.now() + 3 * 60 * 60 * 1000),
          scheduledEnd: new Date(Date.now() + 4 * 60 * 60 * 1000),
        },
      });

      const tasks = app.get(TasksService, { strict: false });
      await expect(tasks.sendAppointmentReminders()).resolves.not.toThrow();

      const depois = await dono.appointment.findUniqueOrThrow({ where: { id: semEmail.id } });
      // Marcado mesmo sem e-mail: sem isto o cron releria este agendamento a
      // cada hora, para sempre.
      expect(depois.reminderSentAt).toBeInstanceOf(Date);

      // Segunda rodada não muda nada — é o que "idempotente" quer dizer aqui.
      await tasks.sendAppointmentReminders();
      const denovo = await dono.appointment.findUniqueOrThrow({ where: { id: semEmail.id } });
      expect(denovo.reminderSentAt).toEqual(depois.reminderSentAt);
    });
  });

  /* ── 7. Isolamento entre lojas ───────────────────────── */

  describe('isolamento', () => {
    it('a loja B não enxerga, pela API, o lead anônimo criado na loja A', async () => {
      const daA = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 90909-0001', contactName: 'Segredo da A' }));

      const listaDaB = await request(app.getHttpServer())
        .get(rota('/leads?perPage=100'))
        .set('Authorization', `Bearer ${tokenDeB}`);

      expect(listaDaB.status).toBe(200);
      expect(JSON.stringify(listaDaB.body)).not.toContain('Segredo da A');

      const historicoNaB = await request(app.getHttpServer())
        .get(rota(`/leads/${daA.body.leadId}/history`))
        .set('Authorization', `Bearer ${tokenDeB}`);
      expect(historicoNaB.status).toBe(404);
    });

    it('sob o papel da aplicação, o RLS esconde o lead da A do contexto da B', async () => {
      const daA = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 90909-0002' }));

      const noContextoDaA = await comoApp(prisma, { tenantId: f.a.id }, (tx) =>
        tx.$queryRawUnsafe('SELECT id FROM leads WHERE id = $1::uuid', daA.body.leadId),
      );
      expect(noContextoDaA).toHaveLength(1);

      const noContextoDaB = await comoApp(prisma, { tenantId: f.b.id }, (tx) =>
        tx.$queryRawUnsafe('SELECT id FROM leads WHERE id = $1::uuid', daA.body.leadId),
      );
      expect(noContextoDaB).toHaveLength(0);

      // E sem contexto nenhum fecha tudo, que é o padrão seguro das policies.
      const semContexto = await comoApp(prisma, {}, (tx) =>
        tx.$queryRawUnsafe('SELECT id FROM leads WHERE id = $1::uuid', daA.body.leadId),
      );
      expect(semContexto).toHaveLength(0);
    });

    it('o agendamento com contato avulso da A também não vaza para a B', async () => {
      const criado = await request(app.getHttpServer())
        .post(rota('/appointments/dealer'))
        .set('Authorization', `Bearer ${tokenDeA}`)
        .send({
          contactName: 'Avulso Confidencial',
          contactPhone: '(11) 90909-0003',
          type: 'in_person',
          scheduledStart: new Date(Date.now() + 6 * 86_400_000).toISOString(),
        });
      expect(criado.status).toBe(201);

      const listaDaB = await request(app.getHttpServer())
        .get(rota('/appointments?limit=500'))
        .set('Authorization', `Bearer ${tokenDeB}`);

      expect(JSON.stringify(listaDaB.body)).not.toContain('Avulso Confidencial');
    });
  });
});
