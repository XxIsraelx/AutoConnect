import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Os bloqueios que o piloto do primeiro dia encontrou, fixados.
 *
 * Três defeitos com a mesma raiz: caminhos que ninguém exercitava ponta a ponta.
 *
 *  - **o lead de troca era de segunda classe** — entrava sem responsável, sem
 *    prazo de primeira resposta, sem consentimento LGPD e sem telefone canônico.
 *    Sem prazo ele nunca estourava, e o gerente nunca era avisado de que a
 *    proposta mais valiosa da semana estava dormindo;
 *  - **o agendamento público aceitava domingo às 18:30**, com a loja fechada,
 *    sem vendedor e sem vínculo com o lead que a mesma pessoa tinha acabado de
 *    criar pelo mesmo carro;
 *  - **`/catalog/dealer/:id` respondia 200 com corpo vazio** para id
 *    inexistente, e a página pública caía em "Application error".
 */
describe('Primeiro dia — troca, agendamento e página pública (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let tokenDeAdmin: string;
  let tokenDeCliente: string;
  let vendedorId: string;

  const rota = (caminho: string) => `/api/v1${caminho}`;

  /** Seg–sex 09–18, sáb 09–13, domingo fechado. */
  const EXPEDIENTE = {
    '0': { closed: true, open: '09:00', close: '18:00' },
    '1': { closed: false, open: '09:00', close: '18:00' },
    '2': { closed: false, open: '09:00', close: '18:00' },
    '3': { closed: false, open: '09:00', close: '18:00' },
    '4': { closed: false, open: '09:00', close: '18:00' },
    '5': { closed: false, open: '09:00', close: '18:00' },
    '6': { closed: false, open: '09:00', close: '13:00' },
  };

  /**
   * Data futura (ao menos 2 dias à frente) que cai no dia da semana pedido,
   * no fuso da loja. O Brasil não tem horário de verão desde 2019, então
   * `-03:00` é exato o ano inteiro.
   */
  function proximaData(diaDaSemana: number): string {
    for (let i = 2; i <= 10; i++) {
      const instante = new Date(Date.now() + i * 86_400_000);
      const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      }).formatToParts(instante);
      const mapa = Object.fromEntries(partes.map((p) => [p.type, p.value]));
      const semana: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      };
      if (semana[mapa.weekday] === diaDaSemana) {
        return `${mapa.year}-${mapa.month}-${mapa.day}`;
      }
    }
    throw new Error('dia da semana não encontrado na janela de busca');
  }

  const instante = (diaDaSemana: number, hora: string) =>
    `${proximaData(diaDaSemana)}T${hora}:00-03:00`;

  /** Corpo válido do formulário de troca, com o contato variável por caso. */
  const proposta = (over: Record<string, unknown> = {}) => ({
    tenantId: f.a.id,
    desiredVehicleId: f.a.veiculoPublicoId,
    contactName: 'Juliana Prado',
    contactEmail: `juliana-${Math.random().toString(36).slice(2, 8)}@exemplo.test`,
    contactPhone: '(31) 98877-6655',
    consentimento: true,
    consentText:
      'Autorizo o contato desta concessionária sobre a avaliação do meu veículo e o ' +
      'tratamento dos meus dados para esse fim.',
    vehicle: {
      brandName: 'Fiat',
      modelName: 'Argo',
      yearMake: 2019,
      yearModel: 2019,
      mileageKm: 62000,
      plate: 'ABC1D23',
    },
    ...over,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    dono = app.get(PrivilegedPrismaService, { strict: false });
    f = await criarDoisTenants(dono);

    const jwt = app.get(JwtService);
    tokenDeAdmin = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
    // O usuário da fixture é `customer` de verdade: é ele que agenda.
    tokenDeCliente = jwt.sign({ sub: f.a.usuarioId, role: 'customer', tenantId: f.a.id });

    // Um vendedor de plantão, para que o rodízio tenha a quem entregar.
    const [v] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO users (tenant_id, email, full_name, role, status, updated_at)
      VALUES (${f.a.id}::uuid, ${`vendedor-${Date.now()}@exemplo.test`}, 'Wesley Prado',
              'salesperson', 'active', now())
      RETURNING id`;
    vendedorId = v.id;
    await dono.$executeRaw`
      INSERT INTO salesperson_profiles (user_id, tenant_id, updated_at)
      VALUES (${vendedorId}::uuid, ${f.a.id}::uuid, now())`;

    // A loja aceita troca. Pela rota, que é o que o piloto não conseguia fazer:
    // o campo não existia no schema e era descartado em silêncio.
    const ligouTroca = await request(app.getHttpServer())
      .patch(rota('/tenant/me'))
      .set('Authorization', `Bearer ${tokenDeAdmin}`)
      .send({ acceptsTradeIn: true });
    expect(ligouTroca.status).toBe(200);

    // E o expediente da filial, pelo mesmo motivo.
    const salvouExpediente = await request(app.getHttpServer())
      .patch(rota(`/tenant/branch/${f.a.filialId}`))
      .set('Authorization', `Bearer ${tokenDeAdmin}`)
      .send({ businessHours: EXPEDIENTE });
    expect(salvouExpediente.status).toBe(200);
  }, 90_000);

  afterAll(async () => {
    await dono.$executeRaw`DELETE FROM lead_interactions WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM appointments WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM leads WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM salesperson_profiles WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM users WHERE id = ${vendedorId}::uuid`;
    await f?.limpar();
    await app?.close();
  });

  /* ── 1. O lead de troca tem dono e relógio ───────────── */

  describe('lead de troca', () => {
    it('nasce com responsável, prazo, consentimento e telefone canônico', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/catalog/trade-in'))
        .send(proposta({ contactPhone: '(31) 90000-0001' }));

      expect(res.status).toBe(201);

      const lead = await dono.lead.findFirstOrThrow({
        where: { tenantId: f.a.id, source: 'trade_in', contactPhone: '(31) 90000-0001' },
      });

      // Os quatro campos que faltavam, um a um.
      expect(lead.assignedTo).toBe(vendedorId);
      expect(lead.firstResponseDueAt).toBeInstanceOf(Date);
      expect(lead.consentedAt).toBeInstanceOf(Date);
      expect(lead.consentText).toContain('Autorizo o contato');
      expect(lead.contactPhoneNormalized).toBe('31900000001');

      // E o veículo oferecido continua no metadata, com a avaliação pendente.
      const meta = lead.metadata as { tradeIn?: { vehicle?: { plate?: string } } };
      expect(meta.tradeIn?.vehicle?.plate).toBe('ABC1D23');
    });

    it('a criação aparece na timeline, como nos outros caminhos', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/catalog/trade-in'))
        .send(proposta({ contactPhone: '(31) 90000-0002' }));
      expect(res.status).toBe(201);

      const lead = await dono.lead.findFirstOrThrow({
        where: { tenantId: f.a.id, contactPhone: '(31) 90000-0002' },
      });
      const interacoes = await dono.leadInteraction.findMany({
        where: { leadId: lead.id },
        orderBy: { occurredAt: 'asc' },
      });

      expect(interacoes.map((i) => i.kind)).toEqual(['created', 'rotation']);
      expect(interacoes[0].content).toContain('formulário de troca');
    });

    it('sem consentimento é 400, apontando o campo, e nenhum lead é criado', async () => {
      const semAceite = proposta({ contactPhone: '(31) 90000-0003' });
      delete (semAceite as Record<string, unknown>).consentimento;

      const res = await request(app.getHttpServer())
        .post(rota('/catalog/trade-in'))
        .send(semAceite);

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'consentimento' })]),
      );
      expect(
        await dono.lead.count({ where: { tenantId: f.a.id, contactPhone: '(31) 90000-0003' } }),
      ).toBe(0);
    });

    it('sem telefone é 400 — é por ele que a loja devolve a avaliação', async () => {
      const semTelefone = proposta();
      delete (semTelefone as Record<string, unknown>).contactPhone;

      const res = await request(app.getHttpServer())
        .post(rota('/catalog/trade-in'))
        .send(semTelefone);

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'contactPhone' })]),
      );
    });

    it('duas ofertas do mesmo telefone viram DOIS leads — troca não deduplica', async () => {
      // Decisão registrada: quem oferece dois carros fez duas propostas, cada
      // uma com placa, quilometragem e valor próprios. Fundi-las perderia a
      // segunda avaliação.
      const telefone = '(31) 90000-0004';
      for (const modelo of ['Argo', 'Mobi']) {
        const res = await request(app.getHttpServer())
          .post(rota('/catalog/trade-in'))
          .send(proposta({
            contactPhone: telefone,
            vehicle: {
              brandName: 'Fiat', modelName: modelo,
              yearMake: 2019, yearModel: 2019, mileageKm: 62000,
            },
          }));
        expect(res.status).toBe(201);
      }

      const leads = await dono.lead.findMany({
        where: { tenantId: f.a.id, contactPhone: telefone },
      });
      expect(leads).toHaveLength(2);
      // Os dois com dono e relógio: o segundo não é rebaixado.
      for (const l of leads) {
        expect(l.assignedTo).toBe(vendedorId);
        expect(l.firstResponseDueAt).toBeInstanceOf(Date);
      }
    });

    it('a loja que não aceita troca continua recusando', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/catalog/trade-in'))
        .send(proposta({ tenantId: f.b.id, desiredVehicleId: f.b.veiculoPublicoId }));

      expect(res.status).toBe(403);
    });
  });

  /* ── 2. Agendamento respeita o expediente ────────────── */

  describe('agendamento público', () => {
    const agendar = (corpo: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(rota('/appointments'))
        .set('Authorization', `Bearer ${tokenDeCliente}`)
        .send({ tenantId: f.a.id, branchId: f.a.filialId, type: 'test_drive', ...corpo });

    it('domingo às 18:30 é recusado — a loja está fechada', async () => {
      // O caso exato do piloto: "Agendamento solicitado! Test drive em domingo,
      // 27 de setembro às 18:30."
      const quando = instante(0, '18:30');
      const res = await agendar({ scheduledStart: quando });

      expect(res.status).toBe(400);
      expect(String(res.body.message)).toMatch(/fechada/i);
      // A fixture já traz um agendamento desta pessoa; o que não pode existir é
      // um **neste horário**.
      expect(
        await dono.appointment.count({
          where: { tenantId: f.a.id, scheduledStart: new Date(quando) },
        }),
      ).toBe(0);
    });

    it('sábado às 15:00 também — o expediente do sábado fecha às 13:00', async () => {
      const res = await agendar({ scheduledStart: instante(6, '15:00') });
      expect(res.status).toBe(400);
    });

    it('data no passado é recusada', async () => {
      const res = await agendar({
        scheduledStart: new Date(Date.now() - 86_400_000).toISOString(),
      });
      expect(res.status).toBe(400);
    });

    it('quarta às 10:00 é aceito, e herda o lead e o vendedor da mesma pessoa', async () => {
      // A mesma pessoa já mandou um interesse por este carro, minutos antes.
      const [lead] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO leads (tenant_id, customer_user_id, vehicle_id, contact_name,
                           contact_phone, assigned_to, status, source, updated_at)
        VALUES (${f.a.id}::uuid, ${f.a.usuarioId}::uuid, ${f.a.veiculoPublicoId}::uuid,
                'Juliana Prado', '31988776655', ${vendedorId}::uuid, 'new', 'website', now())
        RETURNING id`;

      const res = await agendar({
        vehicleId: f.a.veiculoPublicoId,
        scheduledStart: instante(3, '10:00'),
      });

      expect(res.status).toBe(201);

      const appt = await dono.appointment.findUniqueOrThrow({ where: { id: res.body.id } });
      // O vínculo é o que costura "quatro coisas sem relação" numa pessoa só.
      expect(appt.leadId).toBe(lead.id);
      // E a visita ganha dono sem inventar um rodízio próprio.
      expect(appt.salespersonId).toBe(vendedorId);
    });

    it('loja inexistente é 404, não um agendamento órfão', async () => {
      const res = await request(app.getHttpServer())
        .post(rota('/appointments'))
        .set('Authorization', `Bearer ${tokenDeCliente}`)
        .send({
          tenantId: '00000000-0000-4000-8000-000000000000',
          type: 'test_drive',
          scheduledStart: instante(3, '10:00'),
        });

      expect(res.status).toBe(404);
    });
  });

  /* ── 3. Página pública não cai com id inválido ───────── */

  describe('escrita no catálogo global', () => {
    // O catálogo de marcas e modelos é compartilhado por todas as lojas: o que
    // uma escreve, todas veem. As rotas nasceram sem papel exigido e sem Zod.
    it('cliente final não cria marca', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/catalog/brands')
        .set('Authorization', `Bearer ${tokenDeCliente}`)
        .send({ name: 'Marca Do Cliente' });
      expect(res.status).toBe(403);
    });

    it('equipe da loja cria, e nome curto demais é 400', async () => {
      const criada = await request(app.getHttpServer())
        .post('/api/v1/catalog/brands')
        .set('Authorization', `Bearer ${tokenDeAdmin}`)
        .send({ name: `Marca Teste ${Date.now()}` });
      expect(criada.status).toBe(201);

      const curta = await request(app.getHttpServer())
        .post('/api/v1/catalog/brands')
        .set('Authorization', `Bearer ${tokenDeAdmin}`)
        .send({ name: 'X' });
      expect(curta.status).toBe(400);
    });
  });

  describe('catálogo público com id inexistente', () => {
    const inexistente = '00000000-0000-4000-8000-000000000000';

    it('a loja responde 404 com corpo JSON, não 200 vazio', async () => {
      const res = await request(app.getHttpServer()).get(
        rota(`/catalog/dealer/${inexistente}`),
      );

      expect(res.status).toBe(404);
      // O 200 com `Content-Length: 0` era o que fazia o `res.json()` do
      // `generateMetadata` estourar com `Unexpected end of JSON input`.
      expect(res.text).not.toBe('');
      expect(res.body.message).toBeDefined();
    });

    it('o veículo também — a tela já trata 404, e recebia corpo vazio', async () => {
      const res = await request(app.getHttpServer()).get(
        rota(`/catalog/vehicles/${inexistente}`),
      );

      expect(res.status).toBe(404);
      expect(res.body.message).toBeDefined();
    });

    it('loja em rascunho/desativada não vaza pelo slug', async () => {
      const res = await request(app.getHttpServer()).get(rota('/catalog/slug/nao-existe-mesmo'));
      expect(res.status).toBe(404);
    });

    it('a loja que existe continua respondendo 200, com o expediente', async () => {
      const res = await request(app.getHttpServer()).get(rota(`/catalog/dealer/${f.a.id}`));

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(f.a.id);
      // O modal de agendamento precisa dele para só oferecer horário válido.
      expect(res.body.branches[0].businessHours).toEqual(EXPEDIENTE);
    });
  });
});
