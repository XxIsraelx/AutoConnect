import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { PROVEDOR_DE_PUSH, PushSimulado } from '../src/modules/users/push/provedor';
import { PROVEDOR_DE_WHATSAPP } from '../src/modules/whatsapp/provedor';
import type { ProvedorSimuladoDeWhatsApp } from '../src/modules/whatsapp/provedor-simulado';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Push do vendedor, ponta a ponta, com o provedor simulado: a inscrição do
 * aparelho e os disparos — lead novo (com e sem responsável), mensagem do
 * cliente no WhatsApp e no chat do visitante.
 */
describe('Push do vendedor (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let push: PushSimulado;
  let whatsapp: ProvedorSimuladoDeWhatsApp;
  let f: DoisTenants;
  let jwt: JwtService;
  let vendedorId: string;
  let gerenteId: string;
  let comoVendedor: string;
  let comoGerente: string;
  let comoAdmin: string;
  let comoAdminB: string;

  const http = () => request(app.getHttpServer());
  const post = (rota: string, t: string, corpo: object = {}) =>
    http().post(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`).send(corpo);
  const get = (rota: string, t: string) => http().get(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`);

  const inscricao = (n: string) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/aparelho-${n}`,
    expirationTime: null,
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u', auth: 'tBHItJI5svbpez7KI4CCXg' },
  });

  /** O envio é fire-and-forget: espera o aviso chegar ao simulado. */
  const esperarAviso = async (endpoint: string, titulo: RegExp) => {
    for (let i = 0; i < 50; i++) {
      const achado = push.enviados.find((e) => e.endpoint === endpoint && titulo.test(e.notificacao.titulo));
      if (achado) return achado.notificacao;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`nenhum aviso "${titulo}" para ${endpoint}`);
  };
  const avisosPara = (endpoint: string) => push.enviados.filter((e) => e.endpoint === endpoint);

  const criarUsuario = async (tenantId: string, nome: string, papel: string) => {
    const [u] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO users (tenant_id, email, full_name, role, status, email_verified_at, updated_at)
      VALUES (${tenantId}::uuid, ${`${papel}-${Date.now()}-${Math.random()}@exemplo.test`}, ${nome},
              ${papel}::"UserRole", 'active', now(), now())
      RETURNING id`;
    return u.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    push = app.get(PROVEDOR_DE_PUSH, { strict: false });
    whatsapp = app.get(PROVEDOR_DE_WHATSAPP, { strict: false });
    jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);

    vendedorId = await criarUsuario(f.a.id, 'Diego Vendedor', 'salesperson');
    gerenteId = await criarUsuario(f.a.id, 'Gerusa Gerente', 'manager');
    comoVendedor = jwt.sign({ sub: vendedorId, role: 'salesperson', tenantId: f.a.id });
    comoGerente = jwt.sign({ sub: gerenteId, role: 'manager', tenantId: f.a.id });
    comoAdmin = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
    comoAdminB = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });
  }, 90_000);

  afterAll(async () => {
    for (const t of [f.a, f.b]) {
      await dono.$executeRaw`DELETE FROM push_subscriptions WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM messages WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM conversations WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM whatsapp_webhook_events WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM whatsapp_accounts WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM lead_interactions WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM tenant_crm_settings WHERE tenant_id = ${t.id}::uuid`;
    }
    await f?.limpar();
    await app?.close();
  });

  describe('o aparelho', () => {
    it('a capacidade diz se há push e dá a chave pública para o navegador se inscrever', async () => {
      const r = await get('/push/capacidade', comoVendedor);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ disponivel: true, chavePublica: push.chavePublica, aparelhos: 0 });
    });

    it('inscrever duas vezes o mesmo aparelho não duplica o aviso', async () => {
      expect((await post('/push/inscricoes', comoVendedor, inscricao('vendedor'))).status).toBe(201);
      expect((await post('/push/inscricoes', comoVendedor, inscricao('vendedor'))).status).toBe(201);
      expect((await get('/push/capacidade', comoVendedor)).body.aparelhos).toBe(1);
    });

    it('inscrição com endpoint que não é https é recusada', async () => {
      const r = await post('/push/inscricoes', comoVendedor, { ...inscricao('x'), endpoint: 'http://inseguro.test/a' });
      expect(r.status).toBe(400);
    });

    it('o teste chega no aparelho', async () => {
      const r = await post('/push/teste', comoVendedor);
      expect(r.body).toEqual({ enviados: 1 });
      expect(avisosPara(inscricao('vendedor').endpoint).at(-1)?.notificacao.titulo).toBe('AutoConnect');
    });

    it('o aparelho que passa para alguém de outra loja deixa de receber os avisos desta', async () => {
      await post('/push/inscricoes', comoGerente, inscricao('compartilhado'));
      const r = await post('/push/inscricoes', comoAdminB, inscricao('compartilhado'));
      expect(r.status).toBe(201);
      expect((await get('/push/capacidade', comoGerente)).body.aparelhos).toBe(0);
      expect((await get('/push/capacidade', comoAdminB)).body.aparelhos).toBe(1);
    });
  });

  describe('lead novo', () => {
    beforeAll(async () => {
      await post('/push/inscricoes', comoGerente, inscricao('gerente'));
    });

    it('lead cadastrado para um vendedor avisa o vendedor, com o nome e a origem', async () => {
      const r = await post('/leads/manual', comoGerente, {
        contactName: 'Maria Souza', contactPhone: '(11) 98765-2001', source: 'phone', assignedTo: vendedorId,
      });
      expect(r.status).toBe(201);
      const n = await esperarAviso(inscricao('vendedor').endpoint, /Lead novo/);
      expect(n).toMatchObject({ titulo: 'Lead novo (Telefone)', corpo: 'Maria Souza', url: '/leads' });
    });

    it('quem cadastra para si mesmo não é avisado', async () => {
      const antes = avisosPara(inscricao('vendedor').endpoint).length;
      await post('/leads/manual', comoVendedor, { contactName: 'Balcão', contactPhone: '(11) 98765-2002', source: 'walk_in' });
      await new Promise((r) => setTimeout(r, 300));
      expect(avisosPara(inscricao('vendedor').endpoint).length).toBe(antes);
    });

    const doSite = (nome: string, telefone: string) => http().post('/api/v1/leads/public').send({
      vehicleId: f.a.veiculoPublicoId,
      contactName: nome,
      contactPhone: telefone,
      consentimento: true,
      consentText: 'Autorizo o contato desta concessionária e o tratamento dos meus dados para esse fim.',
    });

    it('lead do site com o rodízio ligado (o padrão) avisa o vendedor da vez', async () => {
      expect((await doSite('Pedro Visitante', '(11) 98765-2003')).status).toBe(201);
      const n = await esperarAviso(inscricao('vendedor').endpoint, /Lead novo \(Site\)/);
      expect(n.corpo).toMatch(/^Pedro Visitante — /);
    });

    it('com o rodízio desligado, o lead fica sem responsável e a gerência é avisada', async () => {
      await dono.$executeRaw`
        INSERT INTO tenant_crm_settings (tenant_id, rodizio_ativo, updated_at)
        VALUES (${f.a.id}::uuid, false, now())
        ON CONFLICT (tenant_id) DO UPDATE SET rodizio_ativo = false`;

      expect((await doSite('Paula Visitante', '(11) 98765-2004')).status).toBe(201);
      const n = await esperarAviso(inscricao('gerente').endpoint, /sem responsável/);
      expect(n.titulo).toBe('Lead sem responsável (Site)');
      expect(n.corpo).toMatch(/^Paula Visitante — /);
    });
  });

  describe('mensagem do cliente', () => {
    let conta: string;

    beforeAll(async () => {
      await post('/whatsapp/conta', comoAdmin, { numero: '(11) 98888-2000' });
      const [c] = await dono.$queryRaw<{ external_id: string }[]>`
        SELECT external_id FROM whatsapp_accounts WHERE tenant_id = ${f.a.id}::uuid AND active`;
      conta = c.external_id;
    });

    const entregar = (de: string, texto: string) => {
      const { corpo, cabecalhos } = whatsapp.entrega([{
        tipo: 'mensagem', idExterno: `wamid.PUSH.${Date.now()}.${Math.random()}`, conta, de,
        nome: 'Carla Cliente', formato: 'texto', texto, recebidaEm: new Date(),
      }]);
      return http().post('/api/v1/webhooks/whatsapp').set({ 'Content-Type': 'application/json', ...cabecalhos })
        .send(corpo.toString('utf8'));
    };

    // O rodízio segue desligado (bloco anterior): o lead novo vai para a gerência.
    it('no WhatsApp, a primeira mensagem de alguém novo é um aviso de lead — não dois', async () => {
      const antes = push.enviados.length;
      await entregar('5511987652010', 'Oi, tem o Onix?');
      const n = await esperarAviso(inscricao('gerente').endpoint, /WhatsApp oficial/);
      expect(n).toMatchObject({ titulo: 'Lead sem responsável (WhatsApp oficial)' });
      await new Promise((r) => setTimeout(r, 200));
      expect(push.enviados.slice(antes).filter((e) => /\(WhatsApp\)$/.test(e.notificacao.titulo))).toHaveLength(0);
    });

    it('a mensagem seguinte avisa quem cuida da conversa, com o texto e o link da conversa', async () => {
      const [c] = await dono.$queryRaw<{ id: string }[]>`
        SELECT id FROM conversations WHERE tenant_id = ${f.a.id}::uuid AND contact_phone_normalized = '11987652010'`;
      await dono.$executeRaw`UPDATE conversations SET salesperson_id = ${vendedorId}::uuid WHERE id = ${c.id}::uuid`;

      await entregar('5511987652010', 'Aceita troca?');
      const n = await esperarAviso(inscricao('vendedor').endpoint, /\(WhatsApp\)$/);
      expect(n).toEqual({
        titulo: 'Carla Cliente (WhatsApp)', corpo: 'Aceita troca?', url: `/chat?c=${c.id}`, etiqueta: `conversa-${c.id}`,
      });
    });

    it('o visitante do link também avisa o vendedor', async () => {
      const [l] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO leads (tenant_id, contact_name, contact_phone, updated_at)
        VALUES (${f.a.id}::uuid, 'Rui Visitante', '(11) 98765-2011', now()) RETURNING id`;
      const conv = await post('/conversations/from-lead', comoVendedor, { leadId: l.id });
      const token = new URL(conv.body.guestUrl).pathname.split('/').pop()!;

      await http().post(`/api/v1/public/conversations/${token}/messages`).send({ body: 'Posso ir amanhã?' });
      const n = await esperarAviso(inscricao('vendedor').endpoint, /Chat do site/);
      expect(n).toMatchObject({ titulo: 'Rui Visitante (Chat do site)', corpo: 'Posso ir amanhã?' });
    });
  });

  describe('aparelho que o navegador desinscreveu', () => {
    it('a inscrição expirada sai do banco no primeiro envio', async () => {
      push.expirar(inscricao('vendedor').endpoint);
      const r = await post('/push/teste', comoVendedor);
      expect(r.body).toEqual({ enviados: 0 });
      expect((await get('/push/capacidade', comoVendedor)).body.aparelhos).toBe(0);
    });

    it('desativar remove só o aparelho de quem pediu', async () => {
      await post('/push/inscricoes/remover', comoGerente, { endpoint: inscricao('gerente').endpoint });
      expect((await get('/push/capacidade', comoGerente)).body.aparelhos).toBe(0);
    });
  });
});
