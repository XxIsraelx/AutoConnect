import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TasksService } from '../src/modules/tasks/tasks.service';
import { LimitePorIp } from '../src/modules/leads/limite-por-ip';
import { criarDoisTenants, comoApp, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Onda 1, itens 6 a 9 — rodízio, prazo de primeiro contato, carteira e motivo
 * de perda.
 *
 * Contra Postgres de verdade porque o que importa aqui só existe lá: o
 * `SELECT … FOR UPDATE` que serializa dois leads simultâneos (o caso que passa
 * verde em qualquer mock), o `groupBy` da carga e o RLS que separa as lojas.
 */
describe('Onda 1 — rodízio, SLA, carteira e motivo de perda (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let prisma: PrismaService;
  let f: DoisTenants;
  let jwt: JwtService;

  /** Vendedores da loja A, na ordem em que entraram na equipe. */
  let ana = '';
  let bruno = '';
  let gerente = '';

  const rota = (caminho: string) => `/api/v1${caminho}`;
  const comoAdmin = () => jwt.sign({ sub: gerente, role: 'tenant_admin', tenantId: f.a.id });
  const comoVendedor = (id: string) => jwt.sign({ sub: id, role: 'salesperson', tenantId: f.a.id });

  /** Cria um membro da loja A. O `created_at` fixa a posição no anel. */
  async function criarMembro(nome: string, papel: string, minutos: number): Promise<string> {
    const [{ id }] = await dono.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO users (tenant_id, email, full_name, role, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4::"UserRole", 'active', now() - ($5 || ' minutes')::interval, now())
       RETURNING id`,
      f.a.id, `${nome}-${Math.random().toString(36).slice(2, 8)}@exemplo.test`, nome, papel,
      String(minutos),
    );
    return id;
  }

  /**
   * Devolve os ajustes da loja A aos padrões e aplica o `patch`.
   *
   * Reescreve **todos** os campos, não só os do patch: um caso que desliga o
   * rodízio deixaria o seguinte sem responsável e a falha apareceria no lugar
   * errado.
   */
  async function ajustar(patch: Record<string, unknown> = {}): Promise<void> {
    const padrao = {
      rodizioAtivo: true,
      rodizioIncluiGerentes: false,
      slaPrimeiroContatoMinutos: 15,
      slaDevolveParaFila: false,
      vendedorVeTodosOsLeads: true,
      rodizioUltimoUsuarioId: null,
    };
    await dono.tenantCrmSettings.upsert({
      where: { tenantId: f.a.id },
      update: { ...padrao, ...patch },
      create: { tenantId: f.a.id, ...padrao, ...patch },
    });
  }

  async function limparLeads(): Promise<void> {
    await dono.leadInteraction.deleteMany({ where: { tenantId: f.a.id } });
    await dono.lead.deleteMany({ where: { tenantId: f.a.id, id: { not: f.a.leadId } } });
  }

  const formulario = (over: Record<string, unknown> = {}) => ({
    vehicleId: f.a.veiculoPublicoId,
    contactName: 'Visitante',
    contactPhone: '(11) 90000-0000',
    consentimento: true,
    consentText: 'Autorizo o contato desta concessionária e o tratamento dos meus dados.',
    ...over,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    dono = app.get(PrivilegedPrismaService, { strict: false });
    prisma = app.get(PrismaService, { strict: false });
    jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);

    // Ana entrou antes de Bruno: é essa ordem que o anel segue.
    ana = await criarMembro('Ana Vendedora', 'salesperson', 30);
    bruno = await criarMembro('Bruno Vendedor', 'salesperson', 20);
    gerente = await criarMembro('Gina Gerente', 'tenant_admin', 10);
  }, 120_000);

  beforeEach(async () => {
    app.get(LimitePorIp, { strict: false }).limpar();
    await limparLeads();
    await ajustar({});
  });

  afterAll(async () => {
    await dono.tenantCrmSettings.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await limparLeads();
    await f?.limpar();
    await app?.close();
  });

  /* ── 6. Rodízio ──────────────────────────────────────── */

  describe('rodízio', () => {
    it('distribui em ordem e dá a volta no anel', async () => {
      const recebidos: (string | null)[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await request(app.getHttpServer())
          .post(rota('/leads/public'))
          .send(formulario({ contactPhone: `(11) 9111${i}-000${i}` }));
        expect(res.status).toBe(201);
        const lead = await dono.lead.findUniqueOrThrow({ where: { id: res.body.leadId } });
        recebidos.push(lead.assignedTo);
      }

      // Sem ponteiro, o primeiro vai para quem tem menos leads abertos —
      // empate zerado, e o anel desempata em Ana. Depois é uma casa por lead.
      expect(recebidos).toEqual([ana, bruno, ana]);
    });

    it('o gerente só entra na fila quando a loja liga o interruptor', async () => {
      await ajustar({ rodizioIncluiGerentes: true });
      // Ponteiro em Bruno, o último do anel de vendedores: o próximo é o
      // gerente, que entrou depois dos dois.
      await dono.tenantCrmSettings.update({
        where: { tenantId: f.a.id }, data: { rodizioUltimoUsuarioId: bruno },
      });

      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 91200-0001' }));

      const lead = await dono.lead.findUniqueOrThrow({ where: { id: res.body.leadId } });
      expect(lead.assignedTo).toBe(gerente);
    });

    it('fora do plantão sai do rodízio, e o "ausente até" o faz sozinho', async () => {
      await dono.salespersonProfile.upsert({
        where: { userId: ana },
        update: { isAcceptingLeads: false },
        create: { userId: ana, tenantId: f.a.id, isAcceptingLeads: false },
      });
      await dono.salespersonProfile.upsert({
        where: { userId: bruno },
        update: { onDutyPausedUntil: new Date(Date.now() + 86_400_000) },
        create: {
          userId: bruno, tenantId: f.a.id,
          onDutyPausedUntil: new Date(Date.now() + 86_400_000),
        },
      });

      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 91300-0001' }));

      const lead = await dono.lead.findUniqueOrThrow({ where: { id: res.body.leadId } });
      // Ninguém elegível: o lead fica na fila, e a timeline diz por quê — em
      // vez de cair na caixa de quem está de férias.
      expect(lead.assignedTo).toBeNull();

      const rodizio = await dono.leadInteraction.findFirst({
        where: { leadId: lead.id, kind: 'rotation' },
      });
      expect(rodizio?.content).toContain('Ninguém de plantão');

      await dono.salespersonProfile.deleteMany({ where: { userId: { in: [ana, bruno] } } });
    });

    it('dois leads simultâneos NÃO caem no mesmo vendedor', async () => {
      // O caso que só o banco resolve: sem o `SELECT … FOR UPDATE` os dois
      // leem o mesmo ponteiro e escolhem o mesmo vendedor. Em memória de
      // processo isso nem aparece com uma réplica só.
      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post(rota('/leads/public'))
          .send(formulario({ contactPhone: '(11) 92000-0001' })),
        request(app.getHttpServer())
          .post(rota('/leads/public'))
          .send(formulario({ contactPhone: '(11) 92000-0002' })),
      ]);

      expect([a.status, b.status]).toEqual([201, 201]);
      const leads = await dono.lead.findMany({
        where: { id: { in: [a.body.leadId, b.body.leadId] } },
        select: { assignedTo: true },
      });

      expect(leads).toHaveLength(2);
      expect(new Set(leads.map((l) => l.assignedTo)).size).toBe(2);
    });

    it('com o rodízio desligado, o lead nasce na fila e sem linha de rodízio', async () => {
      await ajustar({ rodizioAtivo: false });

      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 92100-0001' }));

      const lead = await dono.lead.findUniqueOrThrow({ where: { id: res.body.leadId } });
      expect(lead.assignedTo).toBeNull();
      expect(
        await dono.leadInteraction.count({ where: { leadId: lead.id, kind: 'rotation' } }),
      ).toBe(0);
    });

    it('o ponteiro de uma loja não atravessa para a outra', async () => {
      await comoApp(prisma, { tenantId: f.b.id }, async (tx) => {
        const linhas = await tx.$queryRawUnsafe(
          'SELECT tenant_id FROM tenant_crm_settings',
        );
        // Sob RLS, a loja B não enxerga a linha de ajustes da loja A.
        expect(linhas).toEqual([]);
      });
    });
  });

  /* ── 7. Prazo de primeiro contato ────────────────────── */

  describe('prazo de primeiro contato', () => {
    it('todo lead novo nasce com prazo', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 93000-0001' }));

      const lead = await dono.lead.findUniqueOrThrow({ where: { id: res.body.leadId } });
      expect(lead.firstResponseDueAt).toBeInstanceOf(Date);
      expect(lead.firstRespondedAt).toBeNull();
    });

    it('interação de saída para o relógio; nota interna não', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 93100-0001' }));
      const leadId = res.body.leadId as string;

      // Nota interna: escrever sobre o cliente não é falar com ele.
      await request(app.getHttpServer())
        .post(rota(`/leads/${leadId}/interactions`))
        .set('Authorization', `Bearer ${comoAdmin()}`)
        .send({ kind: 'note', content: 'cliente parece quente' })
        .expect(201);

      expect((await dono.lead.findUniqueOrThrow({ where: { id: leadId } })).firstRespondedAt)
        .toBeNull();

      await request(app.getHttpServer())
        .post(rota(`/leads/${leadId}/interactions`))
        .set('Authorization', `Bearer ${comoAdmin()}`)
        .send({ kind: 'whatsapp' })
        .expect(201);

      const depois = await dono.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(depois.firstRespondedAt).toBeInstanceOf(Date);

      // Só a primeira conta: reescrever faria o indicador virar "tempo até a
      // última mensagem".
      const primeira = depois.firstRespondedAt;
      await request(app.getHttpServer())
        .post(rota(`/leads/${leadId}/interactions`))
        .set('Authorization', `Bearer ${comoAdmin()}`)
        .send({ kind: 'call' })
        .expect(201);

      expect((await dono.lead.findUniqueOrThrow({ where: { id: leadId } })).firstRespondedAt)
        .toEqual(primeira);
    });

    it('o estouro avisa o gerente e é registrado uma única vez', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 93200-0001' }));
      const leadId = res.body.leadId as string;

      // Empurra o prazo para o passado em vez de esperar 15 minutos.
      await dono.lead.update({
        where: { id: leadId },
        data: { firstResponseDueAt: new Date(Date.now() - 60_000) },
      });

      const tasks = app.get(TasksService, { strict: false });
      await tasks.alertarSlaEstourado();

      const depois = await dono.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(depois.slaBreachedAt).toBeInstanceOf(Date);
      // Devolução à fila é desligada por padrão: o responsável continua.
      expect(depois.assignedTo).not.toBeNull();

      const avisos = await dono.notification.findMany({
        where: { tenantId: f.a.id, userId: gerente, title: { contains: 'Prazo' } },
      });
      expect(avisos).toHaveLength(1);

      // Segunda rodada: `slaBreachedAt` torna o job idempotente. Sem isso o
      // gerente receberia o mesmo alerta a cada 5 minutos, para sempre.
      await tasks.alertarSlaEstourado();
      expect(
        await dono.notification.count({
          where: { tenantId: f.a.id, userId: gerente, title: { contains: 'Prazo' } },
        }),
      ).toBe(1);

      await dono.notification.deleteMany({ where: { tenantId: f.a.id } });
    });

    it('com a devolução ligada, o lead estourado volta para a fila', async () => {
      await ajustar({ slaDevolveParaFila: true });

      const res = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 93300-0001' }));
      const leadId = res.body.leadId as string;

      await dono.lead.update({
        where: { id: leadId },
        data: { firstResponseDueAt: new Date(Date.now() - 60_000) },
      });

      await app.get(TasksService, { strict: false }).alertarSlaEstourado();

      const depois = await dono.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(depois.assignedTo).toBeNull();
      expect(
        await dono.leadInteraction.count({ where: { leadId, kind: 'sla_breach' } }),
      ).toBe(1);

      await dono.notification.deleteMany({ where: { tenantId: f.a.id } });
    });

    it('GET /leads/sla-stats devolve uma linha por vendedor', async () => {
      const criado = await request(app.getHttpServer())
        .post(rota('/leads/public'))
        .send(formulario({ contactPhone: '(11) 93400-0001' }));
      const leadId = criado.body.leadId as string;

      await request(app.getHttpServer())
        .post(rota(`/leads/${leadId}/interactions`))
        .set('Authorization', `Bearer ${comoAdmin()}`)
        .send({ kind: 'call' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(rota('/leads/sla-stats?days=7'))
        .set('Authorization', `Bearer ${comoAdmin()}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const linha = res.body.find((l: { userId: string | null }) => l.userId !== null);
      expect(linha).toMatchObject({
        userId: expect.any(String),
        nome: expect.any(String),
        leads: expect.any(Number),
        respondidos: expect.any(Number),
        estourados: expect.any(Number),
      });
      expect(linha.respondidos).toBeGreaterThan(0);
      expect(linha.tempoMedioSegundos).toEqual(expect.any(Number));
    });
  });

  /* ── 8. Carteira do vendedor ─────────────────────────── */

  describe('carteira do vendedor', () => {
    let daAna = '';
    let doBruno = '';
    let naFila = '';

    beforeEach(async () => {
      await ajustar({ vendedorVeTodosOsLeads: false });

      const criar = async (nome: string, dono_: string | null) => {
        const lead = await dono.lead.create({
          data: { tenantId: f.a.id, contactName: nome, assignedTo: dono_ },
        });
        return lead.id;
      };
      daAna = await criar('Cliente da Ana', ana);
      doBruno = await criar('Cliente do Bruno', bruno);
      naFila = await criar('Cliente sem dono', null);
    });

    it('a lista traz os próprios e os da fila, nunca os do colega', async () => {
      const res = await request(app.getHttpServer())
        .get(rota('/leads?perPage=100'))
        .set('Authorization', `Bearer ${comoVendedor(ana)}`);

      expect(res.status).toBe(200);
      const ids = res.body.items.map((l: { id: string }) => l.id);
      expect(ids).toEqual(expect.arrayContaining([daAna, naFila]));
      expect(ids).not.toContain(doBruno);
    });

    it('os contadores contam o mesmo que a lista mostra', async () => {
      const res = await request(app.getHttpServer())
        .get(rota('/leads/stats'))
        .set('Authorization', `Bearer ${comoVendedor(ana)}`);

      expect(res.status).toBe(200);
      const total = Object.values(res.body.porStatus as Record<string, number>)
        .reduce((a, b) => a + b, 0);
      // O lead da fixture (`f.a.leadId`) também está na fila e conta.
      expect(total).toBe(3);
    });

    it('o CSV não exporta o que a lista esconde', async () => {
      const res = await request(app.getHttpServer())
        .get(rota('/leads/export/csv'))
        .set('Authorization', `Bearer ${comoVendedor(ana)}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('Cliente da Ana');
      expect(res.text).toContain('Cliente sem dono');
      // O botão de CSV era o caminho para contornar a carteira inteira.
      expect(res.text).not.toContain('Cliente do Bruno');
    });

    it('o detalhe do lead do colega responde 404, não 403', async () => {
      const res = await request(app.getHttpServer())
        .get(rota(`/leads/${doBruno}/history`))
        .set('Authorization', `Bearer ${comoVendedor(ana)}`);

      // 403 confirmaria que o lead existe — e o id circula por link.
      expect(res.status).toBe(404);
    });

    it('o vendedor não consegue puxar para si o lead do colega', async () => {
      const res = await request(app.getHttpServer())
        .patch(rota(`/leads/${doBruno}/assign`))
        .set('Authorization', `Bearer ${comoVendedor(ana)}`)
        .send({ salesPersonId: ana });

      expect(res.status).toBe(404);
      expect((await dono.lead.findUniqueOrThrow({ where: { id: doBruno } })).assignedTo)
        .toBe(bruno);
    });

    it('o gerente continua vendo tudo', async () => {
      const res = await request(app.getHttpServer())
        .get(rota('/leads?perPage=100'))
        .set('Authorization', `Bearer ${comoAdmin()}`);

      const ids = res.body.items.map((l: { id: string }) => l.id);
      expect(ids).toEqual(expect.arrayContaining([daAna, doBruno, naFila]));
    });

    it('com o interruptor ligado (padrão), o vendedor volta a ver tudo', async () => {
      await ajustar({ vendedorVeTodosOsLeads: true });

      const res = await request(app.getHttpServer())
        .get(rota('/leads?perPage=100'))
        .set('Authorization', `Bearer ${comoVendedor(ana)}`);

      expect(res.body.items.map((l: { id: string }) => l.id)).toContain(doBruno);
    });

    it('o filtro "sem responsável" mostra a fila', async () => {
      const res = await request(app.getHttpServer())
        .get(rota('/leads?responsavel=sem_responsavel&perPage=100'))
        .set('Authorization', `Bearer ${comoAdmin()}`);

      const ids = res.body.items.map((l: { id: string }) => l.id);
      expect(ids).toContain(naFila);
      expect(ids).not.toContain(daAna);
    });
  });

  /* ── 9. Motivo de perda ──────────────────────────────── */

  describe('motivo de perda', () => {
    async function leadNovo(): Promise<string> {
      const lead = await dono.lead.create({
        data: { tenantId: f.a.id, contactName: 'A perder', assignedTo: ana },
      });
      return lead.id;
    }

    it('perder sem motivo é 400, apontando o campo', async () => {
      const id = await leadNovo();

      const res = await request(app.getHttpServer())
        .patch(rota(`/leads/${id}`))
        .set('Authorization', `Bearer ${comoAdmin()}`)
        .send({ status: 'lost' });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'lostReasonCode' })]),
      );
      expect((await dono.lead.findUniqueOrThrow({ where: { id } })).status).toBe('new');
    });

    it('"outro" sem texto é recusado', async () => {
      const id = await leadNovo();

      const res = await request(app.getHttpServer())
        .patch(rota(`/leads/${id}`))
        .set('Authorization', `Bearer ${comoAdmin()}`)
        .send({ status: 'lost', lostReasonCode: 'outro' });

      expect(res.status).toBe(400);
    });

    it('com motivo, grava o código e registra na timeline', async () => {
      const id = await leadNovo();

      const res = await request(app.getHttpServer())
        .patch(rota(`/leads/${id}`))
        .set('Authorization', `Bearer ${comoAdmin()}`)
        .send({ status: 'lost', lostReasonCode: 'preco' });

      expect(res.status).toBe(200);
      const lead = await dono.lead.findUniqueOrThrow({ where: { id } });
      expect(lead).toMatchObject({ status: 'lost', lostReasonCode: 'preco' });

      const evento = await dono.leadInteraction.findFirst({
        where: { leadId: id, kind: 'status_change' },
      });
      expect(evento?.content).toContain('Preço');
    });

    it('sair de "perdido" limpa o motivo', async () => {
      const id = await leadNovo();
      await request(app.getHttpServer())
        .patch(rota(`/leads/${id}`))
        .set('Authorization', `Bearer ${comoAdmin()}`)
        .send({ status: 'lost', lostReasonCode: 'sem_credito' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(rota(`/leads/${id}`))
        .set('Authorization', `Bearer ${comoAdmin()}`)
        .send({ status: 'negotiating' })
        .expect(200);

      // Sem isto o relatório contaria como perda por crédito um lead que está
      // em negociação.
      expect((await dono.lead.findUniqueOrThrow({ where: { id } })).lostReasonCode).toBeNull();
    });

    it('GET /leads/stats conta por motivo', async () => {
      for (const motivo of ['preco', 'preco', 'nao_respondeu']) {
        const id = await leadNovo();
        await request(app.getHttpServer())
          .patch(rota(`/leads/${id}`))
          .set('Authorization', `Bearer ${comoAdmin()}`)
          .send({ status: 'lost', lostReasonCode: motivo })
          .expect(200);
      }

      const res = await request(app.getHttpServer())
        .get(rota('/leads/stats'))
        .set('Authorization', `Bearer ${comoAdmin()}`);

      expect(res.status).toBe(200);
      expect(res.body.porMotivoDePerda).toMatchObject({ preco: 2, nao_respondeu: 1 });
    });
  });

  /* ── Ajustes de CRM ──────────────────────────────────── */

  describe('ajustes de CRM', () => {
    it('vendedor não configura o CRM da loja', async () => {
      const res = await request(app.getHttpServer())
        .patch(rota('/crm/settings'))
        .set('Authorization', `Bearer ${comoVendedor(ana)}`)
        .send({ vendedorVeTodosOsLeads: true });

      expect(res.status).toBe(403);
    });

    it('prazo fora da faixa é recusado pelo Zod, antes do CHECK do banco', async () => {
      const res = await request(app.getHttpServer())
        .patch(rota('/crm/settings'))
        .set('Authorization', `Bearer ${comoAdmin()}`)
        .send({ slaPrimeiroContatoMinutos: 0 });

      expect(res.status).toBe(400);
    });

    it('campo fora do schema é descartado — não vira mass assignment', async () => {
      const res = await request(app.getHttpServer())
        .patch(rota('/crm/settings'))
        .set('Authorization', `Bearer ${comoAdmin()}`)
        .send({ slaPrimeiroContatoMinutos: 30, rodizioUltimoUsuarioId: bruno });

      expect(res.status).toBe(200);
      const linha = await dono.tenantCrmSettings.findUniqueOrThrow({
        where: { tenantId: f.a.id },
      });
      expect(linha.slaPrimeiroContatoMinutos).toBe(30);
      // O ponteiro do rodízio é do sistema: aceitar pelo corpo deixaria o
      // gerente escolher quem recebe o próximo lead sem aparecer na timeline.
      expect(linha.rodizioUltimoUsuarioId).toBeNull();
    });

    it('o plantão liga e desliga pela tela da equipe', async () => {
      const res = await request(app.getHttpServer())
        .patch(rota(`/team/members/${ana}/plantao`))
        .set('Authorization', `Bearer ${comoAdmin()}`)
        .send({ emPlantao: false });

      expect(res.status).toBe(200);
      expect(
        (await dono.salespersonProfile.findUniqueOrThrow({ where: { userId: ana } }))
          .isAcceptingLeads,
      ).toBe(false);

      await dono.salespersonProfile.deleteMany({ where: { userId: ana } });
    });

    it('a loja B não altera o plantão de um membro da loja A', async () => {
      const tokenDeB = jwt.sign({
        sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id,
      });

      const res = await request(app.getHttpServer())
        .patch(rota(`/team/members/${ana}/plantao`))
        .set('Authorization', `Bearer ${tokenDeB}`)
        .send({ emPlantao: false });

      expect(res.status).toBe(404);
    });
  });
});
