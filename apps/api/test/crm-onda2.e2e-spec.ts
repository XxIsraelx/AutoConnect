import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Onda 2, itens 12a a 12c — lead manual completo, preço negociável e uma base
 * só para comissão —, mais os cinco defeitos que o piloto simulado encontrou
 * no mesmo caminho (B7, B10, B11, B12, B14).
 *
 * Contra Postgres de verdade pelos motivos de sempre: `Decimal`, o índice
 * único parcial do negócio vivo e a carteira do vendedor só existem lá.
 */
describe('Onda 2 — lead manual, preço e comissão (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let jwt: JwtService;

  /** Dois vendedores da loja A — a carteira separa um do outro. */
  let ana = '';
  let bruno = '';
  let gerenteId = '';

  let comoAna = '';
  let comoBruno = '';
  let comoGerente = '';

  const http = () => request(app.getHttpServer());
  const rota = (c: string) => `/api/v1${c}`;
  const post = (c: string, t: string, corpo: object = {}) =>
    http().post(rota(c)).set('Authorization', `Bearer ${t}`).set('User-Agent', 'jest-e2e/1.0').send(corpo);
  const patch = (c: string, t: string, corpo: object) =>
    http().patch(rota(c)).set('Authorization', `Bearer ${t}`).send(corpo);
  const get = (c: string, t: string) =>
    http().get(rota(c)).set('Authorization', `Bearer ${t}`);

  async function criarMembro(nome: string, papel: string, pct: number | null): Promise<string> {
    const [{ id }] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO users (tenant_id, email, full_name, role, status, updated_at)
      VALUES (${f.a.id}::uuid, ${`${nome}-${Math.random().toString(36).slice(2, 8)}@exemplo.test`},
              ${nome}, ${papel}::"UserRole", 'active', now())
      RETURNING id`;
    if (pct !== null) {
      await dono.$executeRaw`
        INSERT INTO salesperson_profiles (user_id, tenant_id, commission_pct, updated_at)
        VALUES (${id}::uuid, ${f.a.id}::uuid, ${pct}, now())`;
    }
    return id;
  }

  async function criarVeiculo(tenantId: string, preco = 80000): Promise<string> {
    const [{ id }] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO vehicles (tenant_id, brand_id, model_id, year_model, year_make, price,
                            status, listing_status, color, fuel, transmission, updated_at)
      VALUES (${tenantId}::uuid, ${f.marcaId}::uuid, ${f.modeloId}::uuid, 2021, 2021, ${preco},
              'available'::"VehicleStatus", 'published'::"ListingStatus",
              'Prata', 'flex', 'automatic', now())
      RETURNING id`;
    return id;
  }

  /** Lead de balcão, como o modal "Novo lead" o cria: sem veículo. */
  async function leadDeBalcao(token: string, telefone: string) {
    const res = await post('/leads/manual', token, {
      contactName: 'Carlos do Corolla',
      contactPhone: telefone,
      source: 'walk_in',
      message: 'Quer um sedã automático até 85 mil.',
    });
    expect(res.status).toBe(201);
    expect(res.body.vehicleId).toBeNull();
    return res.body.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    dono = app.get(PrivilegedPrismaService, { strict: false });
    jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);

    ana = await criarMembro('Ana Vendedora', 'salesperson', 2.5);
    bruno = await criarMembro('Bruno Vendedor', 'salesperson', null);
    gerenteId = await criarMembro('Gina Gerente', 'tenant_admin', null);

    comoAna = jwt.sign({ sub: ana, role: 'salesperson', tenantId: f.a.id });
    comoBruno = jwt.sign({ sub: bruno, role: 'salesperson', tenantId: f.a.id });
    comoGerente = jwt.sign({ sub: gerenteId, role: 'tenant_admin', tenantId: f.a.id });

    // Carteira fechada — é o padrão do produto desde 23/09/2026, e é o que
    // faz o lead do colega responder 404.
    await dono.tenantCrmSettings.upsert({
      where: { tenantId: f.a.id },
      update: { vendedorVeTodosOsLeads: false, rodizioAtivo: false },
      create: { tenantId: f.a.id, vendedorVeTodosOsLeads: false, rodizioAtivo: false },
    });

    await dono.$executeRaw`
      UPDATE tenants
         SET legal_rep_name = 'Carlos Souza', legal_rep_cpf = '52998224725',
             legal_rep_role = 'sócio-administrador'
       WHERE id = ${f.a.id}::uuid`;
  }, 120_000);

  afterEach(async () => {
    await dono.$executeRaw`DELETE FROM contract_signatures WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM deal_contracts WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM deal_payments WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM deal_buyers WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM deal_status_events WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM deals WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.leadInteraction.deleteMany({ where: { tenantId: f.a.id } });
    await dono.lead.deleteMany({ where: { tenantId: f.a.id, id: { not: f.a.leadId } } });
  });

  afterAll(async () => {
    await dono.$executeRaw`DELETE FROM contract_templates WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.tenantCrmSettings.deleteMany({ where: { tenantId: f.a.id } });
    await dono.salespersonProfile.deleteMany({ where: { tenantId: f.a.id } });
    await f?.limpar();
    await app?.close();
  });

  /* ══════════ 12a — lead manual completo ══════════ */

  describe('12a — vincular veículo ao lead manual', () => {
    it('o lead de balcão nasce sem veículo, ganha um e vira negócio', async () => {
      // É o caminho inteiro do item: até 25/09/2026 ele parava no primeiro
      // passo, porque `PATCH /leads/:id` só movia status e o lead sem veículo
      // não ganha botão de negócio.
      const leadId = await leadDeBalcao(comoAna, '(11) 98111-0001');
      const carro = await criarVeiculo(f.a.id);

      const vinculado = await patch(`/leads/${leadId}`, comoAna, { vehicleId: carro });
      expect(vinculado.status).toBe(200);
      expect(vinculado.body.vehicleId).toBe(carro);
      // A resposta traz a relação: é ela que o card usa para desenhar o carro
      // sem recarregar a lista.
      expect(vinculado.body.vehicle).toMatchObject({ id: carro });

      const negocio = await post('/deals', comoAna, {
        vehicleId: carro,
        leadId,
        listPrice: '80000.00',
        discount: '0',
        saleValue: '80000.00',
      });
      expect(negocio.status).toBe(201);
      expect(negocio.body.leadId).toBe(leadId);
    });

    it('trocar e remover o veículo deixam rastro na timeline', async () => {
      const leadId = await leadDeBalcao(comoAna, '(11) 98111-0002');
      const corolla = await criarVeiculo(f.a.id);
      const onix = await criarVeiculo(f.a.id, 60000);

      await patch(`/leads/${leadId}`, comoAna, { vehicleId: corolla });
      await patch(`/leads/${leadId}`, comoAna, { vehicleId: onix });
      const removido = await patch(`/leads/${leadId}`, comoAna, { vehicleId: null });
      expect(removido.body.vehicleId).toBeNull();

      const historico = await dono.leadInteraction.findMany({
        where: { leadId, kind: 'other' }, orderBy: { occurredAt: 'asc' },
      });
      expect(historico).toHaveLength(3);
      expect(historico[2].content).toMatch(/removido/i);
    });

    it('vincular veículo de outra loja é 404', async () => {
      const leadId = await leadDeBalcao(comoAna, '(11) 98111-0003');
      const res = await patch(`/leads/${leadId}`, comoAna, {
        vehicleId: f.b.veiculoPublicoId,
      });

      expect(res.status).toBe(404);
      const lead = await dono.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.vehicleId).toBeNull();
    });

    it('a carteira vale para o veículo: o lead do colega é 404, não 403', async () => {
      // 403 confirmaria que o lead existe — e o id circula por link.
      const leadId = await leadDeBalcao(comoAna, '(11) 98111-0004');
      const carro = await criarVeiculo(f.a.id);

      const res = await patch(`/leads/${leadId}`, comoBruno, { vehicleId: carro });
      expect(res.status).toBe(404);

      // A gerência alcança o mesmo lead.
      const doGerente = await patch(`/leads/${leadId}`, comoGerente, { vehicleId: carro });
      expect(doGerente.status).toBe(200);
    });

    it('corpo sem status e sem veículo é recusado em vez de gravar nada', async () => {
      const leadId = await leadDeBalcao(comoAna, '(11) 98111-0005');
      const res = await patch(`/leads/${leadId}`, comoAna, {});
      expect(res.status).toBe(400);
    });

    /* ── B7 ── */
    it('B7: o PATCH devolve o motivo da perda que acabou de gravar', async () => {
      // A tela substitui o lead da lista por esta resposta. Sem o motivo aqui,
      // o card mostrava "SEM MOTIVO INFORMADO" até alguém recarregar a página.
      const leadId = await leadDeBalcao(comoAna, '(11) 98111-0006');
      const res = await patch(`/leads/${leadId}`, comoAna, {
        status: 'lost', lostReasonCode: 'nao_respondeu',
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'lost', lostReasonCode: 'nao_respondeu' });
    });
  });

  /* ══════════ 12b — preço negociável ══════════ */

  describe('12b — preço do negócio aberto', () => {
    const abrir = async (preco = 80000) => {
      const carro = await criarVeiculo(f.a.id, preco);
      const res = await post('/deals', comoAna, {
        vehicleId: carro,
        listPrice: `${preco}.00`,
        discount: '0',
        saleValue: `${preco}.00`,
      });
      expect(res.status).toBe(201);
      return { dealId: res.body.id as string, carro };
    };

    it('aplica desconto e a margem acompanha', async () => {
      const { dealId, carro } = await abrir();
      // Custo do carro: 70.000. Margem antes = 10.000; depois do desconto de
      // 5.000, 5.000.
      await dono.$executeRaw`
        INSERT INTO vehicle_acquisitions (tenant_id, vehicle_id, origin, purchase_value, entered_at, updated_at)
        VALUES (${f.a.id}::uuid, ${carro}::uuid, 'direct_purchase', 70000, now() - interval '30 days', now())`;

      const antes = await get(`/deals/${dealId}/margin`, comoGerente);
      expect(antes.body.grossMargin).toBe('10000.00');

      const res = await patch(`/deals/${dealId}`, comoAna, {
        listPrice: '80000.00', discount: '5000.00', saleValue: '75000.00',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ discount: '5000', saleValue: '75000' });

      const depois = await get(`/deals/${dealId}/margin`, comoGerente);
      expect(depois.body.grossMargin).toBe('5000.00');
    });

    it('recusa venda que não bate com tabela menos desconto', async () => {
      const { dealId } = await abrir();
      const res = await patch(`/deals/${dealId}`, comoAna, {
        listPrice: '80000.00', discount: '5000.00', saleValue: '80000.00',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/deveria ser 75000\.00/);
    });

    it('negócio assinado não aceita alteração de valores', async () => {
      const { dealId } = await abrir();
      await dono.$executeRaw`
        UPDATE deals SET status = 'signed' WHERE id = ${dealId}::uuid`;

      const res = await patch(`/deals/${dealId}`, comoAna, {
        listPrice: '80000.00', discount: '1000.00', saleValue: '79000.00',
      });
      expect(res.status).toBe(409);
    });

    it('negócio cancelado não aceita alteração de valores', async () => {
      const { dealId } = await abrir();
      await dono.$executeRaw`
        UPDATE deals SET status = 'canceled', canceled_at = now() WHERE id = ${dealId}::uuid`;

      const res = await patch(`/deals/${dealId}`, comoAna, {
        listPrice: '80000.00', discount: '1000.00', saleValue: '79000.00',
      });
      expect(res.status).toBe(409);
    });

    it('com contrato emitido o preço congela até o contrato ser anulado', async () => {
      // O PDF arquivado tem os valores impressos e um hash que responde "qual
      // documento essa pessoa recebeu?". Mudar o preço por baixo dele faria o
      // hash confirmar um valor que não é mais o do sistema.
      const { dealId } = await abrir();
      await post(`/deals/${dealId}/transition`, comoAna, { to: 'proposal' });
      await dono.$executeRaw`
        INSERT INTO deal_payments (tenant_id, deal_id, kind, value, updated_at)
        VALUES (${f.a.id}::uuid, ${dealId}::uuid, 'cash', 80000, now())`;
      await dono.$executeRaw`
        INSERT INTO deal_buyers (deal_id, tenant_id, full_name, cpf, updated_at)
        VALUES (${dealId}::uuid, ${f.a.id}::uuid, 'Maria Silva', '52998224725', now())`;

      const contrato = await post(`/deals/${dealId}/contract`, comoAna);
      expect(contrato.status).toBe(201);

      const bloqueado = await patch(`/deals/${dealId}`, comoAna, {
        listPrice: '80000.00', discount: '2000.00', saleValue: '78000.00',
      });
      expect(bloqueado.status).toBe(409);
      expect(bloqueado.body.message).toMatch(/[Aa]nule o contrato/);

      await post(`/contracts/${contrato.body.id}/void`, comoGerente, {
        reason: 'Cliente renegociou o preço',
      });

      const liberado = await patch(`/deals/${dealId}`, comoAna, {
        listPrice: '80000.00', discount: '2000.00', saleValue: '78000.00',
      });
      expect(liberado.status).toBe(200);
    }, 30_000);
  });

  /* ══════════ 12c — uma base só para comissão ══════════ */

  describe('12c — comissão', () => {
    /** Um negócio faturado de R$ 80.000 com margem de R$ 9.000, fechado hoje. */
    async function negocioFaturado(): Promise<string> {
      const carro = await criarVeiculo(f.a.id);
      const [{ id }] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO deals (tenant_id, vehicle_id, salesperson_id, status, list_price, discount,
                           sale_value, vehicle_cost_snapshot, gross_margin, closed_at, updated_at)
        VALUES (${f.a.id}::uuid, ${carro}::uuid, ${ana}::uuid, 'invoiced',
                85000.00, 5000.00, 80000.00, 71000.00, 9000.00, now(), now())
        RETURNING id`;
      return id;
    }

    it('as duas telas dão o mesmo número a partir da mesma fixture', async () => {
      // O defeito que fechava piloto: R$ 1.950,00 em `/equipe` e R$ 147,50 em
      // `/relatorios` para a mesma pessoa, no mesmo mês, porque uma aplicava o
      // percentual sobre o faturamento e a outra sobre a margem.
      await negocioFaturado();
      const mes = new Date().toISOString().slice(0, 7);

      const equipe = await get(`/team/overview?period=${mes}`, comoGerente);
      const relatorio = await get('/tenant/reports/salespeople?days=30', comoGerente);

      const naEquipe = equipe.body.members.find((m: { id: string }) => m.id === ana);
      const noRelatorio = relatorio.body.vendedores
        .find((v: { userId: string }) => v.userId === ana);

      // 2,5% sobre o valor de venda de R$ 80.000,00.
      expect(naEquipe.commission).toBe('2000.00');
      expect(noRelatorio.comissaoEstimada).toBe('2000.00');
      expect(naEquipe.commission).toBe(noRelatorio.comissaoEstimada);
    });

    it('o negócio mostra a mesma comissão ao próprio vendedor', async () => {
      const dealId = await negocioFaturado();
      const res = await get(`/deals/${dealId}`, comoAna);

      expect(res.status).toBe(200);
      expect(res.body.comissao).toMatchObject({
        percentual: '2.50', base: '80000.00', valor: '2000.00', faturada: true,
      });
    });

    it('a comissão do colega não sai para outro vendedor', async () => {
      const dealId = await negocioFaturado();

      expect((await get(`/deals/${dealId}`, comoBruno)).body.comissao).toBeNull();
      // A gerência vê — é ela que paga.
      expect((await get(`/deals/${dealId}`, comoGerente)).body.comissao)
        .toMatchObject({ valor: '2000.00' });
    });

    it('sem percentual configurado a comissão é null, e não zero', async () => {
      // Zero diria "não ganhou nada"; o que houve foi "ninguém informou quanto
      // ela ganha", e a tela diz coisas diferentes para os dois casos.
      const carro = await criarVeiculo(f.a.id);
      const [{ id }] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO deals (tenant_id, vehicle_id, salesperson_id, status, list_price, discount,
                           sale_value, closed_at, updated_at)
        VALUES (${f.a.id}::uuid, ${carro}::uuid, ${bruno}::uuid, 'invoiced',
                80000.00, 0, 80000.00, now(), now())
        RETURNING id`;

      const res = await get(`/deals/${id}`, comoBruno);
      expect(res.body.comissao).toMatchObject({ percentual: null, valor: null });
    });
  });

  /* ══════════ Defeitos do mesmo caminho ══════════ */

  describe('contrato e negócio', () => {
    async function negocioPronto(status = 'proposal'): Promise<string> {
      const carro = await criarVeiculo(f.a.id);
      const [{ id }] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO deals (tenant_id, vehicle_id, salesperson_id, status, list_price, discount,
                           sale_value, updated_at)
        VALUES (${f.a.id}::uuid, ${carro}::uuid, ${ana}::uuid, ${status}::"DealStatus",
                80000.00, 0, 80000.00, now())
        RETURNING id`;
      await dono.$executeRaw`
        INSERT INTO deal_payments (tenant_id, deal_id, kind, value, updated_at)
        VALUES (${f.a.id}::uuid, ${id}::uuid, 'cash', 80000, now())`;
      await dono.$executeRaw`
        INSERT INTO deal_buyers (deal_id, tenant_id, full_name, cpf, updated_at)
        VALUES (${id}::uuid, ${f.a.id}::uuid, 'Maria Silva', '52998224725', now())`;
      return id;
    }

    /* ── B10 ── */
    it('B10: emitir o contrato move o negócio para "contrato emitido"', async () => {
      // Sem isto o funil por valor contava como proposta um dinheiro que já
      // tinha documento emitido.
      const dealId = await negocioPronto('proposal');
      const res = await post(`/deals/${dealId}/contract`, comoAna);
      expect(res.status).toBe(201);

      const depois = await dono.deal.findUniqueOrThrow({ where: { id: dealId } });
      expect(depois.status).toBe('contract_issued');

      const eventos = await dono.dealStatusEvent.findMany({ where: { dealId } });
      expect(eventos.some((e) => e.toStatus === 'contract_issued')).toBe(true);
    }, 30_000);

    it('B10: rascunho não emite — a máquina de estados não vai de draft para emitido', async () => {
      const dealId = await negocioPronto('draft');
      const res = await post(`/deals/${dealId}/contract`, comoAna);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Proposta/);
    });

    it('B10: reemitir depois de anular não mexe no status', async () => {
      const dealId = await negocioPronto('proposal');
      const primeiro = await post(`/deals/${dealId}/contract`, comoAna);
      await post(`/contracts/${primeiro.body.id}/void`, comoGerente, { reason: 'Erro de digitação' });

      const segundo = await post(`/deals/${dealId}/contract`, comoAna);
      expect(segundo.status).toBe(201);

      const depois = await dono.deal.findUniqueOrThrow({ where: { id: dealId } });
      expect(depois.status).toBe('contract_issued');
    }, 40_000);

    /* ── B11 ── */
    it('B11: negócio cancelado não emite contrato', async () => {
      const dealId = await negocioPronto('canceled');
      const res = await post(`/deals/${dealId}/contract`, comoAna);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/não emite contrato/);
    });

    /* ── B12 ── */
    it('B12: o motivo do cancelamento fica no negócio e no histórico', async () => {
      const dealId = await negocioPronto('proposal');
      const res = await post(`/deals/${dealId}/transition`, comoAna, {
        to: 'canceled', cancelReasonCode: 'preco',
      });
      expect(res.status).toBe(201);
      // A lista e o detalhe leem daqui.
      expect(res.body.cancelReasonCode).toBe('preco');

      // E o histórico deixou de dizer só "Proposta → Cancelado".
      const evento = await dono.dealStatusEvent.findFirst({
        where: { dealId, toStatus: 'canceled' },
      });
      expect(evento?.reason).toMatch(/preço/i);
    });
  });

  /* ── B14 ── */
  describe('B14 — comparecimento é fato consumado', () => {
    it('agendamento futuro não aceita "não compareceu" nem "concluído"', async () => {
      // A fixture marca o agendamento para amanhã.
      const falta = await patch(`/appointments/${f.a.agendamentoId}`, comoGerente, {
        status: 'no_show',
      });
      expect(falta.status).toBe(409);

      const concluido = await patch(`/appointments/${f.a.agendamentoId}`, comoGerente, {
        status: 'completed',
      });
      expect(concluido.status).toBe(409);

      const intacto = await dono.appointment.findUniqueOrThrow({
        where: { id: f.a.agendamentoId },
      });
      expect(intacto.status).toBe('scheduled');
    });

    it('depois do horário marcado, registra normalmente', async () => {
      await dono.$executeRaw`
        UPDATE appointments
           SET scheduled_start = now() - interval '2 hours',
               scheduled_end   = now() - interval '1 hour'
         WHERE id = ${f.a.agendamentoId}::uuid`;

      const res = await patch(`/appointments/${f.a.agendamentoId}`, comoGerente, {
        status: 'no_show',
      });
      expect(res.status).toBe(200);

      await dono.$executeRaw`
        UPDATE appointments
           SET status = 'scheduled',
               scheduled_start = now() + interval '1 day',
               scheduled_end   = now() + interval '1 day 1 hour'
         WHERE id = ${f.a.agendamentoId}::uuid`;
    });
  });
});
