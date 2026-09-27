import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import {
  CATALOGO_DE_PLANOS, DIAS_DE_CARENCIA, DIAS_DO_CICLO, DIAS_PARA_ESCOLHER_PLANO_APOS_CORTESIA,
  TABELA_VIGENTE, somarDias,
} from '@autoconnect/shared';

/** O preço do Essencial como a API o devolve ("197.00"): lido do catálogo, não digitado. */
const PRECO_ESSENCIAL = (Number(CATALOGO_DE_PLANOS.essencial.precoMensalCentavos) / 100).toFixed(2);
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { PROVEDOR_DE_COBRANCA } from '../src/modules/cobranca/provedor';
import { ProvedorSimuladoDeCobranca } from '../src/modules/cobranca/provedor-simulado';
import { EstadoDaLojaService } from '../src/modules/cobranca/estado-da-loja.service';
import { VencimentosCron } from '../src/modules/cobranca/vencimentos.cron';
import { CABECALHO_TOKEN_ASAAS } from '../src/modules/cobranca/token-webhook';
import { EmailService } from '../src/common/email/email.service';
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
        pendingPlan: null, pendingSince: null,
        graceUntil: null, canceledAt: null, lastNoticeAt: null,
        courtesySince: null, courtesyReason: null, courtesyGrantedBy: null,
        externalId: null, externalCustomerId: null, externalProvider: null,
        currentPeriodEnd: null, currentPeriodStart: null,
        priceTable: null, billingCycle: 'mensal',
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
    expect(res.body.planos[0]).toMatchObject({ plano: 'essencial', precoMensal: PRECO_ESSENCIAL, limiteVeiculos: 30 });
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
      expect(res.body).toMatchObject({
        contratada: true, plano: 'essencial', pendente: true, planoEfetivo: 'trial',
      });
      expect(res.body.fatura.urlPagamento).toMatch(/^https:\/\//);
      expect(res.body.fatura.valor).toBe(PRECO_ESSENCIAL);

      const sub = await assinaturaDe(f.a.id);
      expect(sub).toMatchObject({ externalProvider: 'simulado', paymentMethod: 'pix' });
      expect(sub!.externalId).toMatch(/^sub_sim_/);
      expect(sub!.externalCustomerId).toMatch(/^cus_sim_/);
    });

    /* ── O defeito de 27/09/2026 ─────────────────────────── */

    it('contratar NÃO muda o plano efetivo: a intenção fica pendente', async () => {
      await contratar();

      const sub = await assinaturaDe(f.a.id);
      // O plano efetivo continua o que era; a escolha ficou registrada.
      expect(sub!.plan).toBe('trial');
      expect(sub!.pendingPlan).toBe('essencial');
      expect(sub!.pendingSince).not.toBeNull();

      const tela = await get('/cobranca', comoAdmin);
      expect(tela.body.assinatura).toMatchObject({ plano: 'trial', planoPendente: 'essencial' });
      expect(tela.body.planoPendente).toBe('essencial');
      expect(tela.body.aviso).toContain('aguardando o pagamento');
      // E o teto de estoque é o do plano efetivo, não o do contratado.
      expect(tela.body.uso.limite).toBe(CATALOGO_DE_PLANOS.essencial.limiteVeiculos);
    });

    it('contratar e nunca pagar NÃO deixa a loja em dia — passada a carência, bloqueia', async () => {
      // O caso do usuário: antes, `contratar` gravava `plan: 'essencial'` e
      // `avaliarCobranca` lia "plano pago + active" como loja em dia. A loja
      // ficava com o plano, e com o teto dele, para sempre.
      await ajustarAssinatura(f.a.id, { trialEndsAt: somarDias(new Date(), -1) });
      await contratar();

      // Durante a carência da contratação, escreve — isso é de propósito.
      expect((await escreverAlgo(comoAdmin)).status).toBe(200);

      // Passada a carência sem nenhum pagamento: somente leitura.
      await ajustarAssinatura(f.a.id, { graceUntil: somarDias(new Date(), -1) });
      const bloqueada = await escreverAlgo(comoAdmin);
      expect(bloqueada.status).toBe(402);

      const sub = await assinaturaDe(f.a.id);
      expect(sub!.plan).toBe('trial');
      expect(sub!.pendingPlan).toBe('essencial');
      expect((await get('/cobranca', comoAdmin)).body.situacao).toBe('somente_leitura');
    });

    it('o pagamento confirmado é o que promove o plano contratado', async () => {
      await contratar();
      const sub = await assinaturaDe(f.a.id);

      for (const e of provedor.simular(sub!.externalId!, 'pagar')) {
        await webhook(e.corpo, String(e.cabecalhos[CABECALHO_TOKEN_ASAAS]));
      }

      const depois = await assinaturaDe(f.a.id);
      expect(depois!.plan).toBe('essencial');
      expect(depois!.pendingPlan).toBeNull();
      expect(depois!.pendingSince).toBeNull();
      expect(depois!.status).toBe('active');

      const tela = await get('/cobranca', comoAdmin);
      expect(tela.body).toMatchObject({ situacao: 'ativa', planoPendente: null });
    });

    it('contratar o mesmo plano que já está pendente é 409, não uma segunda cobrança', async () => {
      await contratar();
      const antes = await dono.tenantInvoice.count({ where: { tenantId: f.a.id } });

      const segunda = await contratar();
      expect(segunda.status).toBe(409);
      expect(segunda.body.message).toContain('aguardando o pagamento');
      expect(await dono.tenantInvoice.count({ where: { tenantId: f.a.id } })).toBe(antes);
    });

    it('trocar de plano preserva o plano pago antigo até a primeira fatura do novo ser paga', async () => {
      // Quem está no Essencial e contrata o Profissional não pode perder o
      // Essencial nem ganhar o teto do Profissional antes de pagar.
      await contratar();
      const primeira = await assinaturaDe(f.a.id);
      for (const e of provedor.simular(primeira!.externalId!, 'pagar')) {
        await webhook(e.corpo, String(e.cabecalhos[CABECALHO_TOKEN_ASAAS]));
      }
      expect((await assinaturaDe(f.a.id))!.plan).toBe('essencial');

      const troca = await contratar('profissional');
      expect(troca.status).toBe(201);
      expect(troca.body).toMatchObject({ plano: 'profissional', planoEfetivo: 'essencial' });

      const pendente = await assinaturaDe(f.a.id);
      expect(pendente!.plan).toBe('essencial');
      expect(pendente!.pendingPlan).toBe('profissional');
      // Loja pagante e em dia não ganha carência ao trocar de plano: ela não
      // está vencida, e um prazo gravado aqui seria data errada mais tarde.
      expect(pendente!.graceUntil).toBeNull();

      const tela = await get('/cobranca', comoAdmin);
      expect(tela.body.situacao).toBe('ativa');
      expect(tela.body.uso.limite).toBe(CATALOGO_DE_PLANOS.essencial.limiteVeiculos);

      // Pagando a fatura do plano novo, aí sim.
      for (const e of provedor.simular(pendente!.externalId!, 'pagar')) {
        await webhook(e.corpo, String(e.cabecalhos[CABECALHO_TOKEN_ASAAS]));
      }
      const promovida = await assinaturaDe(f.a.id);
      expect(promovida!.plan).toBe('profissional');
      expect(promovida!.pendingPlan).toBeNull();
      expect((await get('/cobranca', comoAdmin)).body.uso.limite).toBeNull();
    });

    it('cancelar apaga a intenção pendente: sem assinatura não há fatura para pagar', async () => {
      await contratar();
      expect((await post('/cobranca/cancelar', comoAdmin)).status).toBe(201);

      const sub = await assinaturaDe(f.a.id);
      expect(sub!.pendingPlan).toBeNull();
      expect(sub!.pendingSince).toBeNull();
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
      expect(paga).toMatchObject({ valor: PRECO_ESSENCIAL, meio: 'pix' });
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

  /* ── Preço travado e ciclo anual ────────────────────────── */

  describe('preço travado e ciclo anual', () => {
    const pagar = async () => {
      const sub = await assinaturaDe(f.a.id);
      for (const e of provedor.simular(sub!.externalId!, 'pagar')) {
        await webhook(e.corpo, String(e.cabecalhos[CABECALHO_TOKEN_ASAAS]));
      }
    };

    it('a tela mostra o preço mensal e o anual de cada plano, e o teto de filiais', async () => {
      const res = await get('/cobranca', comoAdmin);
      expect(res.body.planos[0]).toMatchObject({
        plano: 'essencial', precoMensal: PRECO_ESSENCIAL, precoAnual: '1970.00', limiteFiliais: 1,
      });
    });

    it('a primeira contratação trava a tabela vigente na loja', async () => {
      expect((await assinaturaDe(f.a.id))!.priceTable).toBeNull();
      await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix' });
      expect(await assinaturaDe(f.a.id)).toMatchObject({ priceTable: TABELA_VIGENTE, billingCycle: 'mensal' });
    });

    it('a trava sobrevive a cancelar e contratar outro plano — é assim que se muda de plano', async () => {
      await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix' });
      await post('/cobranca/cancelar', comoAdmin);
      // Tabela antiga gravada na loja: é a que tem de continuar valendo.
      await ajustarAssinatura(f.a.id, { priceTable: TABELA_VIGENTE });

      expect((await post('/cobranca/contratar', comoAdmin, { plano: 'crescimento', meio: 'pix' })).status).toBe(201);
      // O plano novo fica **pendente** até a primeira fatura dele ser paga; o
      // que este teste fixa é a tabela, que sobrevive ao cancelamento.
      expect(await assinaturaDe(f.a.id)).toMatchObject({
        plan: 'trial', pendingPlan: 'crescimento', priceTable: TABELA_VIGENTE,
      });
    });

    it('contratar no anual cobra 10 meses de uma vez', async () => {
      const res = await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix', ciclo: 'anual' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ ciclo: 'anual' });
      expect(res.body.fatura.valor).toBe('1970.00');
      expect((await assinaturaDe(f.a.id))!.billingCycle).toBe('anual');
    });

    it('o pagamento do anual libera 365 dias, não 30', async () => {
      await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix', ciclo: 'anual' });
      const vencimento = (await dono.tenantInvoice.findFirstOrThrow({ where: { tenantId: f.a.id } })).dueDate;
      await pagar();

      const sub = await assinaturaDe(f.a.id);
      expect(sub!.status).toBe('active');
      const dias = (sub!.currentPeriodEnd!.getTime() - vencimento.getTime()) / 86_400_000;
      expect(Math.round(dias)).toBe(DIAS_DO_CICLO.anual);
    });

    it('ciclo que não existe é 400', async () => {
      const res = await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', ciclo: 'semanal' });
      expect(res.status).toBe(400);
    });
  });

  /* ── E-mails de cobrança ────────────────────────────────── */

  describe('e-mails de cobrança', () => {
    let email: EmailService;
    const espioes = () => ({
      contratada: jest.spyOn(email, 'sendAssinaturaContratada').mockResolvedValue(),
      pago: jest.spyOn(email, 'sendPagamentoConfirmado').mockResolvedValue(),
      cancelada: jest.spyOn(email, 'sendAssinaturaCancelada').mockResolvedValue(),
      cortesia: jest.spyOn(email, 'sendCortesiaConcedida').mockResolvedValue(),
      fimDaCortesia: jest.spyOn(email, 'sendCortesiaRevogada').mockResolvedValue(),
    });
    let e: ReturnType<typeof espioes>;

    /** O e-mail sai depois da resposta, sem `await`: espera ele ser chamado. */
    const chamado = async (espiao: jest.SpyInstance, vezes = 1) => {
      for (let i = 0; i < 40 && espiao.mock.calls.length < vezes; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      // Um respiro a mais para um segundo e-mail indevido ter tempo de aparecer.
      await new Promise((r) => setTimeout(r, 100));
      return espiao.mock.calls;
    };

    const entregar = async (acao: 'pagar' | 'vencer' | 'estornar' | 'cancelar') => {
      const sub = await assinaturaDe(f.a.id);
      for (const ev of provedor.simular(sub!.externalId!, acao)) {
        await webhook(ev.corpo, String(ev.cabecalhos[CABECALHO_TOKEN_ASAAS]));
      }
    };

    beforeAll(() => { email = app.get(EmailService, { strict: false }); });
    beforeEach(() => { e = espioes(); });
    afterEach(() => jest.restoreAllMocks());

    it('contratar avisa a loja com plano, ciclo, valor e link de pagamento', async () => {
      await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix' });
      const chamadas = await chamado(e.contratada);
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]![0]).toMatchObject({
        to: `${f.a.slug}@exemplo.test`, plano: 'Essencial', ciclo: 'mensal', valor: PRECO_ESSENCIAL,
      });
      expect(chamadas[0]![0].urlPagamento).toMatch(/^https:\/\//);
    });

    it('pagamento confirmado manda UM e-mail, mesmo com o gateway entregando mais de um evento', async () => {
      await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix' });
      await entregar('pagar');
      const chamadas = await chamado(e.pago);
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]![0]).toMatchObject({ plano: 'Essencial', valor: PRECO_ESSENCIAL });
    });

    it('cancelar pela tela avisa uma vez — o aviso do gateway que chega depois não repete', async () => {
      await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix' });
      await post('/cobranca/cancelar', comoAdmin);
      await entregar('cancelar');
      const chamadas = await chamado(e.cancelada);
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]![0]).toMatchObject({ origem: 'loja', plano: 'Essencial' });
    });

    it('estorno encerra a assinatura e o e-mail diz que foi estorno', async () => {
      await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix' });
      await entregar('pagar');
      await entregar('estornar');
      const chamadas = await chamado(e.cancelada);
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]![0]).toMatchObject({ origem: 'estorno' });
    });

    it('conceder e revogar a cortesia avisam a loja', async () => {
      await patch(`/admin/tenants/${f.a.id}/cortesia`, comoSuperAdmin, { motivo: 'fundadora' });
      expect((await chamado(e.cortesia))[0]![0]).toMatchObject({ motivo: 'Loja fundadora', plano: 'Crescimento' });

      await http().delete(`/api/v1/admin/tenants/${f.a.id}/cortesia`).set('Authorization', `Bearer ${comoSuperAdmin}`);
      expect(await chamado(e.fimDaCortesia)).toHaveLength(1);
    });

    it('e-mail que falha não derruba a contratação', async () => {
      e.contratada.mockRejectedValue(new Error('provedor de e-mail fora do ar'));
      const res = await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix' });
      expect(res.status).toBe(201);
      await chamado(e.contratada);
      expect((await assinaturaDe(f.a.id))!.externalId).not.toBeNull();
    });
  });

  /* ── Filiais ────────────────────────────────────────────── */

  describe('limite de filiais do plano', () => {
    const novaFilial = (t = comoAdmin, nome = `Filial ${Date.now()}`) =>
      post('/tenant/branch', t, { name: nome, city: 'Valinhos', state: 'SP' });

    const filiaisExtras = async () => {
      // A fixture cria uma filial por loja; tudo além dela é deste bloco.
      await dono.dealershipBranch.deleteMany({ where: { tenantId: f.a.id, id: { not: f.a.filialId } } });
    };
    beforeEach(filiaisExtras);
    afterAll(filiaisExtras);

    it('no trial e no Essencial, a segunda filial é recusada com 422 e o plano que resolve', async () => {
      const res = await novaFilial();
      expect(res.status).toBe(422);
      expect(res.body.message).toContain('Crescimento');
      expect(await dono.dealershipBranch.count({ where: { tenantId: f.a.id } })).toBe(1);
    });

    it('no Crescimento cabe a segunda, e a terceira pede o Profissional', async () => {
      await ajustarAssinatura(f.a.id, { plan: 'crescimento' });
      const criada = await novaFilial();
      expect(criada.status).toBe(201);
      expect(criada.body).toMatchObject({ tenantId: f.a.id, isHeadquarters: false, city: 'Valinhos' });

      const terceira = await novaFilial();
      expect(terceira.status).toBe(422);
      expect(terceira.body.message).toContain('Profissional');
    });

    it('a fundadora em cortesia tem o teto do Crescimento', async () => {
      await patch(`/admin/tenants/${f.a.id}/cortesia`, comoSuperAdmin, { motivo: 'fundadora' });
      expect((await novaFilial()).status).toBe(201);
    });

    it('descer de plano não apaga filial: só a próxima é recusada', async () => {
      await ajustarAssinatura(f.a.id, { plan: 'crescimento' });
      await novaFilial();
      await ajustarAssinatura(f.a.id, { plan: 'essencial' });

      expect(await dono.dealershipBranch.count({ where: { tenantId: f.a.id, isActive: true } })).toBe(2);
      expect((await novaFilial()).status).toBe(422);
    });

    it('filial desativada não conta no teto', async () => {
      await ajustarAssinatura(f.a.id, { plan: 'crescimento' });
      const criada = await novaFilial();
      await dono.dealershipBranch.update({ where: { id: criada.body.id }, data: { isActive: false } });
      expect((await novaFilial()).status).toBe(201);
    });

    it('só o administrador da loja cria filial', async () => {
      await ajustarAssinatura(f.a.id, { plan: 'profissional' });
      expect((await novaFilial(comoVendedor)).status).toBe(403);
    });

    it('a nova filial nunca nasce matriz, e campo desconhecido é recusado', async () => {
      await ajustarAssinatura(f.a.id, { plan: 'profissional' });
      const res = await post('/tenant/branch', comoAdmin, { name: 'Outra', isHeadquarters: true });
      expect(res.status).toBe(400);
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

    it('subir de plano libera a publicação quando o pagamento entra, não ao contratar', async () => {
      // Antes de 27/09/2026 contratar já dava o teto novo — e a loja que nunca
      // pagava ficava com ele. O teto é do plano **efetivo**; o pagamento é que
      // o muda, e por Pix isso leva minutos.
      await encher(LIMITE + 1);
      const id = await publicavel();
      expect((await post(`/vehicles/${id}/publish`, comoAdmin)).status).toBe(422);

      await post('/cobranca/contratar', comoAdmin, { plano: 'crescimento', meio: 'pix' });
      expect((await post(`/vehicles/${id}/publish`, comoAdmin)).status).toBe(422);

      const sub = await assinaturaDe(f.a.id);
      for (const e of provedor.simular(sub!.externalId!, 'pagar')) {
        await webhook(e.corpo, String(e.cabecalhos[CABECALHO_TOKEN_ASAAS]));
      }
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
      expect(loja.cobranca.ultimaFatura).toMatchObject({ status: 'paga', valor: PRECO_ESSENCIAL });
    });

    it('o painel mostra o plano contratado e não pago, separado do plano efetivo', async () => {
      await post('/cobranca/contratar', comoAdmin, { plano: 'profissional', meio: 'pix' });

      const res = await get('/admin/tenants', comoSuperAdmin);
      const loja = (res.body as { id: string; cobranca: Record<string, unknown> }[])
        .find((t) => t.id === f.a.id)!;

      expect(loja.cobranca).toMatchObject({
        plan: 'trial', planoPendente: 'profissional', situacao: 'trial',
      });
      expect(loja.cobranca.pendenteDesde).not.toBeNull();
      expect(loja.cobranca.gateway).toMatchObject({ provedor: 'simulado' });
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

  /* ── Gestão de faturas pelo super admin ─────────────────── */

  describe('faturas e assinatura pelo painel do super admin', () => {
    const detalhe = async () => (await get(`/admin/tenants/${f.a.id}`, comoSuperAdmin)).body as {
      cobranca: Record<string, unknown>;
      faturas: { id: string; status: string; valor: string; urlPagamento: string | null; cancelavel: boolean }[];
      gatewayDeCobranca: { provedor: string; disponivel: boolean };
    };

    const cancelarFatura = (faturaId: string, corpo: object = { motivo: 'cobrança de teste' }, t = comoSuperAdmin) =>
      post(`/admin/tenants/${f.a.id}/faturas/${faturaId}/cancelar`, t, corpo);

    const cancelarAssinatura = (corpo: object, t = comoSuperAdmin) =>
      post(`/admin/tenants/${f.a.id}/assinatura/cancelar`, t, corpo);

    beforeEach(async () => {
      await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix' });
    });

    it('lista as faturas da loja com situação, valor, vencimento e link', async () => {
      const d = await detalhe();
      expect(d.gatewayDeCobranca).toMatchObject({ provedor: 'simulado', disponivel: true });
      expect(d.faturas).toHaveLength(1);
      expect(d.faturas[0]).toMatchObject({
        status: 'pendente', valor: PRECO_ESSENCIAL, cancelavel: true,
      });
      expect(d.faturas[0]!.urlPagamento).toMatch(/^https:\/\//);
    });

    it('cancelar uma fatura em aberto a marca cancelada — no gateway e aqui — sem apagar a linha', async () => {
      const d = await detalhe();
      const fatura = d.faturas[0]!;

      const res = await cancelarFatura(fatura.id);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ cancelada: true, gateway: 'cancelada' });

      // A linha continua lá: histórico de dinheiro não se apaga.
      const linha = await dono.tenantInvoice.findUnique({ where: { id: fatura.id } });
      expect(linha!.status).toBe('cancelada');

      // E a loja vê a fatura como cancelada, não vê a fatura desaparecer.
      const tela = await get('/cobranca', comoAdmin);
      expect(tela.body.faturas[0]).toMatchObject({ status: 'cancelada' });
    });

    it('um PAYMENT_OVERDUE atrasado não ressuscita a fatura cancelada nem reabre a carência', async () => {
      const d = await detalhe();
      await cancelarFatura(d.faturas[0]!.id);

      const sub = await assinaturaDe(f.a.id);
      const antes = sub!.graceUntil;
      const [e] = provedor.simular(sub!.externalId!, 'vencer');
      const res = await webhook(e!.corpo, String(e!.cabecalhos[CABECALHO_TOKEN_ASAAS]));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ aplicado: false, motivo: 'fatura-cancelada' });

      const depois = await assinaturaDe(f.a.id);
      expect(depois!.status).toBe('active');
      expect(depois!.graceUntil!.getTime()).toBe(antes!.getTime());
      // O espelho também não voltou a "vencida".
      const linha = await dono.tenantInvoice.findFirst({ where: { tenantId: f.a.id } });
      expect(linha!.status).toBe('cancelada');
    });

    it('fatura paga não se cancela: o caminho é o estorno no gateway', async () => {
      const sub = await assinaturaDe(f.a.id);
      for (const e of provedor.simular(sub!.externalId!, 'pagar')) {
        await webhook(e.corpo, String(e.cabecalhos[CABECALHO_TOKEN_ASAAS]));
      }
      const paga = (await detalhe()).faturas.find((x) => x.status === 'paga')!;
      expect(paga.cancelavel).toBe(false);

      const res = await cancelarFatura(paga.id);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('estorno');
      expect((await dono.tenantInvoice.findUnique({ where: { id: paga.id } }))!.status).toBe('paga');
    });

    it('cancelar a mesma fatura duas vezes é idempotente, não erro', async () => {
      const id = (await detalhe()).faturas[0]!.id;
      expect((await cancelarFatura(id)).status).toBe(201);
      const segunda = await cancelarFatura(id);
      expect(segunda.status).toBe(201);
      expect(segunda.body).toMatchObject({ jaEstava: true });
    });

    it('o motivo é obrigatório — auditoria sem o porquê só diz que alguém mexeu', async () => {
      const id = (await detalhe()).faturas[0]!.id;
      expect((await cancelarFatura(id, {})).status).toBe(400);
      expect((await cancelarFatura(id, { motivo: 'x' })).status).toBe(400);
      expect((await cancelarAssinatura({})).status).toBe(400);
      // Campo a mais é recusado, não ignorado em silêncio.
      expect((await cancelarAssinatura({ motivo: 'teste', plan: 'profissional' })).status).toBe(400);
      expect((await dono.tenantInvoice.findUnique({ where: { id } }))!.status).toBe('pendente');
    });

    it('cancelar a assinatura limpa o pendente, as faturas em aberto e a assinatura no gateway', async () => {
      const res = await cancelarAssinatura({ motivo: 'contratação por engano' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ cancelada: true, gateway: 'cancelada', faturasCanceladas: 1 });

      const sub = await assinaturaDe(f.a.id);
      expect(sub!.pendingPlan).toBeNull();
      expect(sub!.externalId).toBeNull();
      // O cliente no gateway fica: a loja que voltar não vira um segundo cadastro.
      expect(sub!.externalCustomerId).toMatch(/^cus_sim_/);
      expect(await dono.tenantInvoice.count({ where: { tenantId: f.a.id, status: 'cancelada' } })).toBe(1);
    });

    it('conserta a loja que ficou com plano pago sem nenhum pagamento (o caso real)', async () => {
      // Reproduz exatamente o que o defeito gravava: plano pago, status active,
      // sem período pago nenhum e com fatura pendente.
      await ajustarAssinatura(f.a.id, {
        plan: 'essencial', pendingPlan: null, status: 'active',
        graceUntil: null, currentPeriodEnd: null, trialEndsAt: somarDias(new Date(), -40),
      });
      // O estado ruim: a loja aparece "em dia" sem ter pagado nada.
      expect((await get('/cobranca', comoAdmin)).body.situacao).toBe('ativa');

      const res = await cancelarAssinatura({
        motivo: 'teste em produção: nunca houve pagamento',
        voltarParaTrial: true,
        diasDeTrial: 14,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ plano: 'trial', planoPendente: null, status: 'active' });

      const sub = await assinaturaDe(f.a.id);
      expect(sub!.plan).toBe('trial');
      expect(Math.round((sub!.trialEndsAt!.getTime() - Date.now()) / 86_400_000)).toBe(14);
      expect(sub!.externalId).toBeNull();
      expect(await dono.tenantInvoice.count({ where: { tenantId: f.a.id, status: 'pendente' } })).toBe(0);

      // E a loja não fica trancada por causa do conserto: o trial vale de novo.
      expect((await escreverAlgo(comoAdmin)).status).toBe(200);
      expect((await get('/cobranca', comoAdmin)).body.situacao).toBe('trial');
    });

    it('a ação fica na auditoria, com quem fez e o motivo', async () => {
      await cancelarAssinatura({ motivo: 'cobrança de teste em produção' });

      // A escrita de auditoria é disparada sem await de propósito (nunca
      // bloqueia a operação); aqui a leitura espera a linha aparecer.
      const achar = async () => {
        for (let i = 0; i < 20; i++) {
          const linha = await dono.auditLog.findFirst({
            where: { action: 'subscription_canceled_by_admin', entityId: f.a.id },
            orderBy: { createdAt: 'desc' },
          });
          if (linha) return linha;
          await new Promise((r) => setTimeout(r, 50));
        }
        return null;
      };

      const linha = await achar();
      expect(linha).not.toBeNull();
      expect(linha!.actorUserId).toBe(f.a.usuarioId);
      expect(linha!.diff).toMatchObject({ motivo: 'cobrança de teste em produção' });
    });

    it('só o super admin mexe em fatura e assinatura de loja', async () => {
      const id = (await detalhe()).faturas[0]!.id;

      for (const papel of [comoAdmin, comoVendedor, comoOutraLoja]) {
        expect((await cancelarFatura(id, { motivo: 'quero não pagar' }, papel)).status).toBe(403);
        expect((await cancelarAssinatura({ motivo: 'quero não pagar' }, papel)).status).toBe(403);
      }
      expect((await dono.tenantInvoice.findUnique({ where: { id } }))!.status).toBe('pendente');
    });

    it('a fatura de uma loja não é cancelável pela rota de outra', async () => {
      const id = (await detalhe()).faturas[0]!.id;
      // Mesmo o super admin não alcança a fatura pela loja errada: o `tenantId`
      // entra no WHERE, e não só no caminho da URL.
      const res = await post(`/admin/tenants/${f.b.id}/faturas/${id}/cancelar`, comoSuperAdmin, {
        motivo: 'engano',
      });
      expect(res.status).toBe(404);
      expect((await dono.tenantInvoice.findUnique({ where: { id } }))!.status).toBe('pendente');
    });
  });

  /* ── Cortesia ───────────────────────────────────────────── */

  describe('cortesia (fundadora e loja interna)', () => {
    const del = (rota: string, t: string) =>
      http().delete(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`);

    it('conceder destrava uma loja bloqueada, no plano Crescimento, e registra quem concedeu', async () => {
      await ajustarAssinatura(f.a.id, { trialEndsAt: somarDias(new Date(), -30) });
      expect((await escreverAlgo(comoAdmin)).status).toBe(402);

      const res = await patch(`/admin/tenants/${f.a.id}/cortesia`, comoSuperAdmin, { motivo: 'fundadora' });
      expect(res.status).toBe(200);

      expect((await escreverAlgo(comoAdmin)).status).toBe(200);
      expect(await assinaturaDe(f.a.id)).toMatchObject({
        plan: 'crescimento', status: 'active', courtesyReason: 'fundadora', courtesyGrantedBy: f.a.usuarioId,
      });
    });

    it('só o super admin concede, e só com um motivo conhecido', async () => {
      expect((await patch(`/admin/tenants/${f.a.id}/cortesia`, comoAdmin, { motivo: 'fundadora' })).status).toBe(403);
      expect((await patch(`/admin/tenants/${f.a.id}/cortesia`, comoSuperAdmin, { motivo: 'amigo' })).status).toBe(400);
      expect((await assinaturaDe(f.a.id))!.courtesySince).toBeNull();
    });

    it('nenhum prazo antigo bloqueia a loja em cortesia — nem trial, nem fatura, nem carência', async () => {
      await patch(`/admin/tenants/${f.a.id}/cortesia`, comoSuperAdmin, { motivo: 'interna' });
      await ajustarAssinatura(f.a.id, { status: 'past_due', graceUntil: somarDias(new Date(), -10) });
      expect((await escreverAlgo(comoAdmin)).status).toBe(200);
    });

    it('a tela da loja diz que é cortesia, e a contratação é recusada', async () => {
      await patch(`/admin/tenants/${f.a.id}/cortesia`, comoSuperAdmin, { motivo: 'fundadora' });

      const tela = await get('/cobranca', comoAdmin);
      expect(tela.body).toMatchObject({ situacao: 'cortesia', somenteLeitura: false });
      expect(tela.body.assinatura.cortesia).toMatchObject({ motivo: 'fundadora' });

      const contratar = await post('/cobranca/contratar', comoAdmin, { plano: 'essencial', meio: 'pix' });
      expect(contratar.status).toBe(409);
      expect((await assinaturaDe(f.a.id))!.externalId).toBeNull();
    });

    it('o painel mostra a cortesia e não chama a loja de inadimplente', async () => {
      await patch(`/admin/tenants/${f.a.id}/cortesia`, comoSuperAdmin, { motivo: 'fundadora' });
      await ajustarAssinatura(f.a.id, { status: 'past_due', graceUntil: somarDias(new Date(), -1) });

      const res = await get('/admin/tenants', comoSuperAdmin);
      const loja = (res.body as { id: string; cobranca: Record<string, unknown> }[])
        .find((t) => t.id === f.a.id)!;
      expect(loja.cobranca).toMatchObject({
        situacao: 'cortesia', inadimplente: false, cortesia: expect.objectContaining({ motivo: 'fundadora' }),
      });
    });

    it('a varredura não manda aviso de vencimento para loja em cortesia', async () => {
      await patch(`/admin/tenants/${f.a.id}/cortesia`, comoSuperAdmin, { motivo: 'fundadora' });
      await ajustarAssinatura(f.a.id, { plan: 'trial', trialEndsAt: somarDias(new Date(), 1), lastNoticeAt: null });

      await cron.processar();
      expect((await assinaturaDe(f.a.id))!.lastNoticeAt).toBeNull();
    });

    it('revogar devolve a loja ao trial com prazo para escolher um plano, sem bloqueio imediato', async () => {
      await patch(`/admin/tenants/${f.a.id}/cortesia`, comoSuperAdmin, { motivo: 'fundadora' });

      expect((await del(`/admin/tenants/${f.a.id}/cortesia`, comoSuperAdmin)).status).toBe(200);

      const sub = await assinaturaDe(f.a.id);
      expect(sub).toMatchObject({ plan: 'trial', courtesySince: null, courtesyReason: null });
      const dias = (sub!.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
      expect(Math.round(dias)).toBe(DIAS_PARA_ESCOLHER_PLANO_APOS_CORTESIA);
      expect((await escreverAlgo(comoAdmin)).status).toBe(200);

      // Revogar o que não existe é 404, não um "ok" que esconde o engano.
      expect((await del(`/admin/tenants/${f.a.id}/cortesia`, comoSuperAdmin)).status).toBe(404);
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
