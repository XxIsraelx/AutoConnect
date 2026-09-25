import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import {
  CATALOGO_DE_PLANOS, DIAS_DE_CARENCIA, somarDias,
} from '@autoconnect/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { PROVEDOR_DE_COBRANCA } from '../src/modules/cobranca/provedor';
import { ProvedorSimuladoDeCobranca } from '../src/modules/cobranca/provedor-simulado';
import { EstadoDaLojaService } from '../src/modules/cobranca/estado-da-loja.service';
import { VencimentosCron } from '../src/modules/cobranca/vencimentos.cron';
import { CABECALHO_TOKEN_ASAAS } from '../src/modules/cobranca/token-webhook';
import { comoApp, criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Cobrança da assinatura da loja, ponta a ponta, com o gateway simulado.
 *
 * O `setup-e2e.ts` liga `COBRANCA_FORNECEDOR=simulado` e zera as `ASAAS_*` —
 * nenhuma requisição sai deste processo.
 *
 * O que este arquivo fixa, e que nenhum teste unitário alcança: o **bloqueio
 * de escrita valendo em rota de verdade**, a volta imediata pelo webhook, a
 * carência, o teto de estoque e o isolamento entre lojas.
 */
describe('Cobrança e bloqueio por vencimento (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let prisma: PrismaService;
  let provedor: ProvedorSimuladoDeCobranca;
  let estado: EstadoDaLojaService;
  let cron: VencimentosCron;
  let f: DoisTenants;
  let jwt: JwtService;

  let comoAdmin: string;
  let comoVendedor: string;
  let comoOutraLoja: string;
  let comoSuperAdmin: string;

  const http = () => request(app.getHttpServer());
  const get = (rota: string, t: string) =>
    http().get(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`);
  const post = (rota: string, t: string, corpo: object = {}) =>
    http().post(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`).send(corpo);
  const patch = (rota: string, t: string, corpo: object = {}) =>
    http().patch(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`).send(corpo);

  const webhook = (corpo: Buffer, token?: string) => {
    const req = http().post('/api/v1/webhooks/cobranca').set('Content-Type', 'application/json');
    if (token !== undefined) req.set(CABECALHO_TOKEN_ASAAS, token);
    return req.send(corpo.toString('utf8'));
  };

  /** Escreve direto na assinatura e derruba o cache — é o "avance o relógio" daqui. */
  const ajustarAssinatura = async (tenantId: string, campos: Record<string, unknown>) => {
    await dono.tenantSubscription.update({ where: { tenantId }, data: campos });
    estado.invalidar(tenantId);
  };

  const assinaturaDe = (tenantId: string) =>
    dono.tenantSubscription.findUnique({ where: { tenantId } });

  /** Uma escrita qualquer de dado da loja — é o que o bloqueio tem de barrar. */
  const escreverAlgo = (t: string) =>
    patch('/tenant/me', t, { tradeName: `Loja ${Date.now()}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    dono = app.get(PrivilegedPrismaService, { strict: false });
    prisma = app.get(PrismaService, { strict: false });
    provedor = app.get(PROVEDOR_DE_COBRANCA, { strict: false });
    estado = app.get(EstadoDaLojaService, { strict: false });
    cron = app.get(VencimentosCron, { strict: false });
    jwt = app.get(JwtService);

    f = await criarDoisTenants(dono);

    // A fixture cria a loja sem linha de assinatura; o cadastro real cria uma
    // em trial. Aqui as duas nascem em trial, como nasceriam na vida real.
    // `tax_id` é único no banco, e o teste roda contra um banco que pode ter
    // resíduo: cada loja ganha o seu, derivado do id.
    for (const loja of [f.a, f.b]) {
      await dono.tenantSubscription.create({
        data: { tenantId: loja.id, plan: 'trial', status: 'active', trialEndsAt: somarDias(new Date(), 14) },
      });
      await dono.tenant.update({
        where: { id: loja.id },
        data: {
          taxId: loja.id.replace(/\D/g, '').padEnd(14, '0').slice(0, 14),
          primaryPhone: '11999998888',
        },
      });
    }

    comoAdmin = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
    comoVendedor = jwt.sign({ sub: f.a.usuarioId, role: 'salesperson', tenantId: f.a.id });
    comoOutraLoja = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });
    comoSuperAdmin = jwt.sign({ sub: f.a.usuarioId, role: 'super_admin', tenantId: null });
  }, 90_000);

  beforeEach(async () => {
    // Cada teste parte de uma loja em trial, em dia.
    await dono.tenantInvoice.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.billingWebhookEvent.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    for (const loja of [f.a, f.b]) {
      await ajustarAssinatura(loja.id, {
        plan: 'trial', status: 'active', trialEndsAt: somarDias(new Date(), 14),
        graceUntil: null, canceledAt: null, lastNoticeAt: null,
        externalId: null, externalCustomerId: null, externalProvider: null,
        currentPeriodEnd: null, currentPeriodStart: null,
      });
    }
  });

  afterAll(async () => {
    await dono.tenantInvoice.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.billingWebhookEvent.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.tenantSubscription.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await f?.limpar();
    await app?.close();
  });

  /* ── Capacidade e catálogo ──────────────────────────────── */

  it('o gateway dos testes é o simulado, e a tela sabe disso', async () => {
    expect(provedor).toBeInstanceOf(ProvedorSimuladoDeCobranca);

    const res = await get('/cobranca', comoAdmin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ disponivel: true, provedor: 'simulado', simulado: true });
    expect(res.body.planos).toHaveLength(3);
    expect(res.body.planos[0]).toMatchObject({ plano: 'essencial', precoMensal: '279.00', limiteVeiculos: 30 });
  });

  it('só tenant_admin mexe em plano e pagamento', async () => {
    // Vendedor e gerente não decidem o que a empresa paga.
    expect((await get('/cobranca', comoVendedor)).status).toBe(403);
    expect((await post('/cobranca/contratar', comoVendedor, { plano: 'essencial' })).status).toBe(403);
    expect((await get('/cobranca', comoAdmin)).status).toBe(200);
  });

  it('o corpo da contratação passa por Zod estrito', async () => {
    expect((await post('/cobranca/contratar', comoAdmin, { plano: 'inexistente' })).status).toBe(400);
    // Campo a mais é descartado com erro, não ignorado em silêncio: era assim
    // que `{"isActive": false}` chegava ao Prisma.
    expect((await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', status: 'active' })).status).toBe(400);
  });

  /* ── Trial, carência e bloqueio ─────────────────────────── */

  describe('fim do trial', () => {
    it('em dia, a loja escreve normalmente', async () => {
      expect((await escreverAlgo(comoAdmin)).status).toBe(200);
      const res = await get('/cobranca', comoAdmin);
      expect(res.body).toMatchObject({ situacao: 'trial', somenteLeitura: false });
    });

    it('trial vencido → somente leitura: lê e exporta tudo, não escreve nada', async () => {
      await ajustarAssinatura(f.a.id, { trialEndsAt: somarDias(new Date(), -1) });

      const bloqueada = await escreverAlgo(comoAdmin);
      expect(bloqueada.status).toBe(402);
      expect(bloqueada.body.codigo).toBe('assinatura_somente_leitura');

      // O bloqueio é de escrita, não de acesso: tudo continua visível.
      expect((await get('/tenant/me', comoAdmin)).status).toBe(200);
      expect((await get('/vehicles', comoAdmin)).status).toBe(200);
      expect((await get('/leads', comoAdmin)).status).toBe(200);
      expect((await get('/deals', comoAdmin)).status).toBe(200);
    });

    it('o bloqueio vale para todo mundo da loja, não só para o admin', async () => {
      await ajustarAssinatura(f.a.id, { trialEndsAt: somarDias(new Date(), -1) });
      expect((await post('/leads', comoVendedor, { contactName: 'x', contactPhone: '11999998888' })).status).toBe(402);
    });

    it('a vitrine pública continua no ar, e o lead de visitante continua entrando', async () => {
      // Decisão registrada: derrubar a vitrine pune o consumidor, que não tem
      // nada com a fatura, e mata o inbound que pagaria a conta. O lead que
      // chega bloqueado é argumento para pagar, não punição.
      await ajustarAssinatura(f.a.id, { trialEndsAt: somarDias(new Date(), -1) });

      expect((await http().get(`/api/v1/catalog/slug/${f.a.slug}`)).status).toBe(200);
      expect((await http().get('/api/v1/catalog/vehicles')).status).toBe(200);

      const lead = await http().post('/api/v1/leads/public').send({
        vehicleId: f.a.veiculoPublicoId,
        contactName: 'Visitante',
        contactPhone: '11988887777',
        consentimento: true,
        consentText: 'Aceito que a loja use meus dados para entrar em contato comigo.',
      });
      expect(lead.status).toBeLessThan(400);
    });

    it('a loja bloqueada ainda consegue despublicar e mexer no próprio perfil', async () => {
      await ajustarAssinatura(f.a.id, { trialEndsAt: somarDias(new Date(), -1) });

      // Tirar do ar nunca pode ficar travado: uma loja que fechou precisa
      // sumir da vitrine mesmo devendo.
      expect((await post(`/vehicles/${f.a.veiculoPublicoId}/unpublish`, comoAdmin)).status).toBe(201);
      // O perfil é da pessoa, não da loja.
      expect((await patch('/users/me', comoAdmin, { fullName: 'Nome Novo' })).status).toBe(200);
      // E a tela de pagar tem de abrir — senão o bloqueio é uma armadilha fechada.
      expect((await get('/cobranca', comoAdmin)).status).toBe(200);
    });

    it('fatura vencida respeita a carência, e só bloqueia depois dela', async () => {
      await ajustarAssinatura(f.a.id, {
        plan: 'essencial', status: 'past_due', trialEndsAt: somarDias(new Date(), -30),
        graceUntil: somarDias(new Date(), 2),
      });
      expect((await escreverAlgo(comoAdmin)).status).toBe(200);
      expect((await get('/cobranca', comoAdmin)).body.situacao).toBe('em_carencia');

      await ajustarAssinatura(f.a.id, { graceUntil: somarDias(new Date(), -1) });
      expect((await escreverAlgo(comoAdmin)).status).toBe(402);
    });
  });

  /* ── Contratar e pagar ──────────────────────────────────── */

  describe('contratação e pagamento', () => {
    const contratar = (plano = 'essencial', t = comoAdmin) =>
      post('/cobranca/contratar', t, { plano, meio: 'pix' });

    it('contratar cria cliente e assinatura no gateway e devolve o link de pagamento', async () => {
      const res = await contratar();
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ contratada: true, plano: 'essencial' });
      expect(res.body.fatura.urlPagamento).toMatch(/^https:\/\//);
      expect(res.body.fatura.valor).toBe('279.00');

      const sub = await assinaturaDe(f.a.id);
      expect(sub).toMatchObject({ plan: 'essencial', externalProvider: 'simulado', paymentMethod: 'pix' });
      expect(sub!.externalId).toMatch(/^sub_sim_/);
      expect(sub!.externalCustomerId).toMatch(/^cus_sim_/);
    });

    it('a carência da contratação é o PRIMEIRO vencimento + 7, não o ciclo seguinte', async () => {
      // O gateway devolve, em `proximoVencimento`, o vencimento do **ciclo
      // seguinte** — a Asaas de verdade responde 28/10 para uma assinatura
      // cuja primeira cobrança vence em 28/09 (validado no sandbox em
      // 25/09/2026, e o simulado passou a imitar isso). Calcular a carência
      // com aquele campo daria ~37 dias de produto liberado a quem contratou
      // e nunca pagou.
      await contratar();

      const sub = await assinaturaDe(f.a.id);
      // Primeiro vencimento = hoje + 3 (regra do `cobranca.service`).
      const esperado = somarDias(new Date(), 3 + DIAS_DE_CARENCIA);
      const diferencaEmDias =
        Math.abs(sub!.graceUntil!.getTime() - esperado.getTime()) / 86_400_000;
      expect(diferencaEmDias).toBeLessThan(1);
    });

    it('contratar no último dia do trial não bloqueia antes de a fatura vencer', async () => {
      await ajustarAssinatura(f.a.id, { trialEndsAt: somarDias(new Date(), -1) });
      expect((await escreverAlgo(comoAdmin)).status).toBe(402);

      expect((await contratar()).status).toBe(201);
      // Contratar não é pagar, mas a loja que se comprometeu volta a escrever
      // enquanto o boleto dela nem venceu.
      expect((await escreverAlgo(comoAdmin)).status).toBe(200);
    });

    it('pagamento confirmado pelo webhook desbloqueia na hora', async () => {
      await contratar();
      await ajustarAssinatura(f.a.id, {
        status: 'past_due', trialEndsAt: somarDias(new Date(), -30), graceUntil: somarDias(new Date(), -1),
      });
      expect((await escreverAlgo(comoAdmin)).status).toBe(402);

      const sub = await assinaturaDe(f.a.id);
      const [entrega] = provedor.simular(sub!.externalId!, 'pagar');
      const res = await webhook(entrega!.corpo, String(entrega!.cabecalhos[CABECALHO_TOKEN_ASAAS]));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ recebido: true, aplicado: true });

      // **Sem esperar o TTL do cache**: o webhook derruba a entrada da loja.
      expect((await escreverAlgo(comoAdmin)).status).toBe(200);
      expect((await assinaturaDe(f.a.id))!.status).toBe('active');
      expect((await assinaturaDe(f.a.id))!.graceUntil).toBeNull();
    });

    it('a fatura paga vai para o histórico, com valor em Decimal', async () => {
      await contratar();
      const sub = await assinaturaDe(f.a.id);
      for (const e of provedor.simular(sub!.externalId!, 'pagar')) {
        await webhook(e.corpo, String(e.cabecalhos[CABECALHO_TOKEN_ASAAS]));
      }

      const res = await get('/cobranca', comoAdmin);
      const paga = res.body.faturas.find((x: { status: string }) => x.status === 'paga');
      expect(paga).toMatchObject({ valor: '279.00', meio: 'pix' });
      expect(paga.pagoEm).not.toBeNull();
    });

    it('vencimento pelo webhook abre a carência de 7 dias', async () => {
      await contratar();
      const sub = await assinaturaDe(f.a.id);
      const [e] = provedor.simular(sub!.externalId!, 'vencer');
      await webhook(e!.corpo, String(e!.cabecalhos[CABECALHO_TOKEN_ASAAS]));

      const depois = await assinaturaDe(f.a.id);
      expect(depois!.status).toBe('past_due');
      expect(depois!.graceUntil).not.toBeNull();
      // Ainda escreve: a carência existe para quem pagou na sexta e compensou
      // na terça.
      expect((await escreverAlgo(comoAdmin)).status).toBe(200);
    });

    it('cancelar leva a somente leitura sem apagar nada', async () => {
      await contratar();
      const veiculosAntes = await dono.vehicle.count({ where: { tenantId: f.a.id } });

      expect((await post('/cobranca/cancelar', comoAdmin)).status).toBe(201);
      expect((await escreverAlgo(comoAdmin)).status).toBe(402);

      expect(await dono.vehicle.count({ where: { tenantId: f.a.id } })).toBe(veiculosAntes);
      expect((await get('/vehicles', comoAdmin)).status).toBe(200);
    });
  });

  /* ── Webhook: autenticidade e idempotência ──────────────── */

  describe('webhook', () => {
    let idExterno: string;

    beforeEach(async () => {
      await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix' });
      idExterno = (await assinaturaDe(f.a.id))!.externalId!;
    });

    it('token inválido, ausente ou vazio é 401 — e nada é gravado', async () => {
      const [e] = provedor.simular(idExterno, 'pagar');

      expect((await webhook(e!.corpo, 'token-errado')).status).toBe(401);
      expect((await webhook(e!.corpo)).status).toBe(401);
      expect((await webhook(e!.corpo, '')).status).toBe(401);

      expect(await dono.billingWebhookEvent.count({ where: { tenantId: f.a.id } })).toBe(0);
      // Nada foi aplicado: o pagamento teria preenchido o período pago.
      expect((await assinaturaDe(f.a.id))!.currentPeriodEnd).toBeNull();
      expect(await dono.tenantInvoice.count({ where: { tenantId: f.a.id, status: 'paga' } })).toBe(0);
    });

    it('o mesmo evento entregue duas vezes não duplica nem reaplica', async () => {
      const [e] = provedor.simular(idExterno, 'pagar');
      const token = String(e!.cabecalhos[CABECALHO_TOKEN_ASAAS]);

      const primeira = await webhook(e!.corpo, token);
      expect(primeira.body).toMatchObject({ aplicado: true });

      const segunda = await webhook(e!.corpo, token);
      expect(segunda.status).toBe(200);
      expect(segunda.body).toMatchObject({ aplicado: false, motivo: 'duplicado' });

      // Uma linha de evento, uma de fatura.
      expect(await dono.billingWebhookEvent.count({ where: { tenantId: f.a.id } })).toBe(1);
      expect(await dono.tenantInvoice.count({ where: { tenantId: f.a.id, status: 'paga' } })).toBe(1);
    });

    it('guarda o corpo cru para auditoria, com a loja certa', async () => {
      const [e] = provedor.simular(idExterno, 'pagar');
      await webhook(e!.corpo, String(e!.cabecalhos[CABECALHO_TOKEN_ASAAS]));

      const [evento] = await dono.billingWebhookEvent.findMany({ where: { tenantId: f.a.id } });
      expect(evento!.provider).toBe('simulado');
      expect(evento!.kind).toBe('pagamento_confirmado');
      expect(evento!.applied).toBe(true);
      expect(JSON.parse(evento!.rawBody)).toMatchObject({ event: 'PAYMENT_RECEIVED' });
    });

    it('assinatura desconhecida responde 200, não 404', async () => {
      // A entrega é autêntica: o envelope veio de outra instalação na mesma
      // conta do gateway. 4xx faria o gateway reentregar para sempre.
      const corpo = Buffer.from(JSON.stringify({
        id: 'evt_orfao', event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_x', subscription: 'sub_que_nao_existe', value: 279, dueDate: '2026-10-04' },
      }));
      const res = await webhook(corpo, process.env.COBRANCA_WEBHOOK_TOKEN!);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ aplicado: false, motivo: 'assinatura-desconhecida' });
    });

    it('evento que não nos interessa é ignorado sem tocar no banco', async () => {
      const corpo = Buffer.from(JSON.stringify({ id: 'evt_z', event: 'PAYMENT_CREATED' }));
      const res = await webhook(corpo, process.env.COBRANCA_WEBHOOK_TOKEN!);
      expect(res.body).toMatchObject({ aplicado: false, motivo: 'ignorado' });
      expect(await dono.billingWebhookEvent.count({ where: { tenantId: f.a.id } })).toBe(0);
    });

    it('o webhook de uma loja não toca na outra', async () => {
      const antes = await assinaturaDe(f.b.id);
      const [e] = provedor.simular(idExterno, 'pagar');
      await webhook(e!.corpo, String(e!.cabecalhos[CABECALHO_TOKEN_ASAAS]));

      const depois = await assinaturaDe(f.b.id);
      expect(depois!.status).toBe(antes!.status);
      expect(await dono.billingWebhookEvent.count({ where: { tenantId: f.b.id } })).toBe(0);
    });
  });

  /* ── Teto de estoque ────────────────────────────────────── */

  describe('limite de estoque da faixa', () => {
    const LIMITE = CATALOGO_DE_PLANOS.essencial.limiteVeiculos!;

    /** Enche o estoque da loja A até passar do teto do Essencial. */
    const encher = async (quantos: number) => {
      for (let i = 0; i < quantos; i++) {
        await dono.vehicle.create({
          data: {
            tenantId: f.a.id, brandId: f.marcaId, modelId: f.modeloId,
            yearModel: 2022, yearMake: 2022, price: 50_000,
            status: 'available', listingStatus: 'draft',
          },
        });
      }
    };

    afterEach(async () => {
      await dono.$executeRaw`
        DELETE FROM vehicles
         WHERE tenant_id = ${f.a.id}::uuid
           AND id NOT IN (${f.a.veiculoPublicoId}::uuid, ${f.a.veiculoPrivadoId}::uuid)`;
    });

    /** Um veículo publicável: preço, cor, combustível, câmbio e uma foto. */
    const publicavel = async () => {
      const v = await dono.vehicle.create({
        data: {
          tenantId: f.a.id, brandId: f.marcaId, modelId: f.modeloId,
          yearModel: 2022, yearMake: 2022, price: 50_000,
          color: 'Prata', fuel: 'flex', transmission: 'automatic',
          status: 'available', listingStatus: 'draft',
          images: {
            create: { tenantId: f.a.id, url: 'https://exemplo.test/foto.jpg', position: 0 },
          },
        },
      });
      return v.id;
    };

    it('dentro da faixa, publica normalmente', async () => {
      const id = await publicavel();
      expect((await post(`/vehicles/${id}/publish`, comoAdmin)).status).toBe(201);
    });

    it('passando do teto, recusa publicar novo anúncio e diz qual plano resolve', async () => {
      const usados = await dono.vehicle.count({
        where: { tenantId: f.a.id, status: { in: ['available', 'reserved', 'sold', 'in_maintenance'] } },
      });
      await encher(LIMITE - usados + 1);
      const id = await publicavel();

      const res = await post(`/vehicles/${id}/publish`, comoAdmin);
      expect(res.status).toBe(422);
      expect(res.body.message).toContain('Crescimento');
      expect(res.body.message).toContain('continuam no ar');
    });

    it('não despublica o que já está no ar, e republicar continua permitido', async () => {
      const id = await publicavel();
      expect((await post(`/vehicles/${id}/publish`, comoAdmin)).status).toBe(201);

      await encher(LIMITE + 5);

      // Já no ar: continua no ar.
      const v = await dono.vehicle.findUnique({ where: { id } });
      expect(v!.listingStatus).toBe('published');

      // E quem já ocupou uma vaga pode voltar depois de sair do ar.
      expect((await post(`/vehicles/${id}/unpublish`, comoAdmin)).status).toBe(201);
      expect((await post(`/vehicles/${id}/publish`, comoAdmin)).status).toBe(201);
    });

    it('subir de plano libera a publicação na hora', async () => {
      await encher(LIMITE + 1);
      const id = await publicavel();
      expect((await post(`/vehicles/${id}/publish`, comoAdmin)).status).toBe(422);

      await post('/cobranca/contratar', comoAdmin, { plano: 'crescimento', meio: 'pix' });
      expect((await post(`/vehicles/${id}/publish`, comoAdmin)).status).toBe(201);
    });

    it('veículo arquivado não conta — ninguém precisa apagar o histórico para caber', async () => {
      await encher(LIMITE);
      await dono.vehicle.updateMany({
        where: { tenantId: f.a.id, listingStatus: 'draft', status: 'available' },
        data: { status: 'archived' },
      });

      const id = await publicavel();
      expect((await post(`/vehicles/${id}/publish`, comoAdmin)).status).toBe(201);
    });
  });

  /* ── Super admin ────────────────────────────────────────── */

  describe('super admin', () => {
    it('estender o trial destrava uma loja bloqueada, na hora', async () => {
      await ajustarAssinatura(f.a.id, { trialEndsAt: somarDias(new Date(), -5) });
      expect((await escreverAlgo(comoAdmin)).status).toBe(402);

      const res = await patch(`/admin/tenants/${f.a.id}/extend-trial`, comoSuperAdmin, { days: 14 });
      expect(res.status).toBe(200);

      expect((await escreverAlgo(comoAdmin)).status).toBe(200);
    });

    it('trocar o plano à mão também destrava — é o caminho sem gateway', async () => {
      await ajustarAssinatura(f.a.id, { trialEndsAt: somarDias(new Date(), -5) });
      expect((await escreverAlgo(comoAdmin)).status).toBe(402);

      expect((await patch(`/admin/tenants/${f.a.id}/plan`, comoSuperAdmin, { plano: 'x' })).status).toBe(400);
      expect((await patch(`/admin/tenants/${f.a.id}/plan`, comoSuperAdmin, { plan: 'crescimento' })).status).toBe(200);

      expect((await escreverAlgo(comoAdmin)).status).toBe(200);
    });

    it('o super admin não é bloqueado pelo modo somente leitura', async () => {
      await ajustarAssinatura(f.a.id, { trialEndsAt: somarDias(new Date(), -5) });
      expect((await patch(`/admin/tenants/${f.a.id}/toggle`, comoSuperAdmin)).status).toBe(200);
      await patch(`/admin/tenants/${f.a.id}/toggle`, comoSuperAdmin);
    });

    it('o painel mostra plano, situação, dias de trial e última fatura por loja', async () => {
      await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix' });
      const sub = await assinaturaDe(f.a.id);
      for (const e of provedor.simular(sub!.externalId!, 'pagar')) {
        await webhook(e.corpo, String(e.cabecalhos[CABECALHO_TOKEN_ASAAS]));
      }

      const res = await get('/admin/tenants', comoSuperAdmin);
      expect(res.status).toBe(200);
      const loja = (res.body as { id: string; cobranca: Record<string, unknown> }[])
        .find((t) => t.id === f.a.id)!;

      expect(loja.cobranca).toMatchObject({
        plan: 'essencial', status: 'active', situacao: 'ativa',
        somenteLeitura: false, inadimplente: false,
      });
      expect(loja.cobranca.ultimaFatura).toMatchObject({ status: 'paga', valor: '279.00' });
    });

    it('o painel marca a loja bloqueada como inadimplente', async () => {
      await ajustarAssinatura(f.a.id, {
        plan: 'essencial', status: 'past_due', graceUntil: somarDias(new Date(), -1),
      });
      const res = await get('/admin/tenants', comoSuperAdmin);
      const loja = (res.body as { id: string; cobranca: Record<string, unknown> }[])
        .find((t) => t.id === f.a.id)!;

      expect(loja.cobranca).toMatchObject({ situacao: 'somente_leitura', inadimplente: true });
    });
  });

  /* ── Cron de vencimentos ────────────────────────────────── */

  describe('varredura de vencimentos', () => {
    it('avisa uma vez por marco, e não repete no dia seguinte', async () => {
      await ajustarAssinatura(f.a.id, { trialEndsAt: somarDias(new Date(), 2), lastNoticeAt: null });

      await cron.processar();
      const depois = await assinaturaDe(f.a.id);
      expect(depois!.lastNoticeAt).not.toBeNull();

      // Segunda rodada no mesmo marco: nada muda.
      const antes = depois!.lastNoticeAt;
      await cron.processar();
      expect((await assinaturaDe(f.a.id))!.lastNoticeAt!.getTime()).toBe(antes!.getTime());
    });

    it('loja com plano pago e em dia não recebe aviso nenhum', async () => {
      await ajustarAssinatura(f.a.id, {
        plan: 'essencial', status: 'active', trialEndsAt: null,
        graceUntil: null, currentPeriodEnd: somarDias(new Date(), 20), lastNoticeAt: null,
      });
      await cron.processar();
      expect((await assinaturaDe(f.a.id))!.lastNoticeAt).toBeNull();
    });

    it('o vencimento gera um aviso novo mesmo depois do aviso de trial', async () => {
      await ajustarAssinatura(f.a.id, {
        plan: 'essencial', status: 'past_due',
        graceUntil: somarDias(new Date(), DIAS_DE_CARENCIA - 1),
        lastNoticeAt: somarDias(new Date(), -20),
      });

      await cron.processar();
      const depois = await assinaturaDe(f.a.id);
      expect(depois!.lastNoticeAt!.getTime()).toBeGreaterThan(somarDias(new Date(), -1).getTime());
    });
  });

  /* ── Isolamento ─────────────────────────────────────────── */

  describe('isolamento entre lojas', () => {
    it('uma loja não vê a fatura da outra, nem pelo RLS', async () => {
      await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix' });
      const sub = await assinaturaDe(f.a.id);
      for (const e of provedor.simular(sub!.externalId!, 'pagar')) {
        await webhook(e.corpo, String(e.cabecalhos[CABECALHO_TOKEN_ASAAS]));
      }

      // Pela API: a loja B vê só o que é dela.
      const daB = await get('/cobranca', comoOutraLoja);
      expect(daB.status).toBe(200);
      expect(daB.body.faturas).toEqual([]);

      // E sob RLS, com a conexão da aplicação: a policy é que barra, não o WHERE.
      const vistas = await comoApp(prisma, { tenantId: f.b.id }, (tx) =>
        tx.$queryRawUnsafe('SELECT id FROM tenant_invoices'),
      );
      expect(vistas).toEqual([]);

      const eventos = await comoApp(prisma, { tenantId: f.b.id }, (tx) =>
        tx.$queryRawUnsafe('SELECT id FROM billing_webhook_events'),
      );
      expect(eventos).toEqual([]);
    });

    it('o bloqueio de uma loja não bloqueia a outra', async () => {
      await ajustarAssinatura(f.a.id, { trialEndsAt: somarDias(new Date(), -1) });

      expect((await escreverAlgo(comoAdmin)).status).toBe(402);
      expect((await escreverAlgo(comoOutraLoja)).status).toBe(200);
    });
  });
});
