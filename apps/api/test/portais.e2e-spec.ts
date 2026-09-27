import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Leads dos portais, ponta a ponta: o endereço de entrada da loja, o webhook no
 * formato AutoConnect e o e-mail encaminhado (provedor de entrada simulado,
 * com a mesma autenticação do Postmark), pela rota HTTP de verdade.
 */
describe('Leads dos portais (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let jwt: JwtService;
  let comoAdmin: string;
  let comoVendedor: string;
  let comoAdminB: string;
  let token: string;
  let endereco: string;

  const http = () => request(app.getHttpServer());
  const post = (rota: string, t: string, corpo: object = {}) =>
    http().post(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`).send(corpo);
  const get = (rota: string, t: string) => http().get(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`);

  const webhook = (tk: string, corpo: string) =>
    http().post(`/api/v1/webhooks/portais/${tk}`).set('Content-Type', 'application/json').send(corpo);

  const AUTH_DO_PROVEDOR = `Basic ${Buffer.from('entrada:token-de-entrada-de-teste').toString('base64')}`;
  let seq = 0;
  const email = (dados: { para?: string[]; de?: string; assunto?: string; texto?: string }, auth = AUTH_DO_PROVEDOR) =>
    http().post('/api/v1/webhooks/email-de-entrada')
      .set({ 'Content-Type': 'application/json', authorization: auth })
      .send(JSON.stringify({
        idExterno: `msg-${Date.now()}-${++seq}`,
        de: dados.de ?? 'notificacoes@olx.com.br',
        para: dados.para ?? ['vendas@loja.test', endereco],
        assunto: dados.assunto ?? 'Nova mensagem sobre o seu anúncio',
        texto: dados.texto ?? '',
        html: null,
      }));

  const leadPorTelefone = async (telefone: string) => {
    const [l] = await dono.$queryRaw<{ id: string; source: string; message: string | null; metadata: Record<string, unknown> }[]>`
      SELECT id, source::text, message, metadata FROM leads
       WHERE tenant_id = ${f.a.id}::uuid AND contact_phone_normalized = ${telefone}`;
    return l;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);
    comoAdmin = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
    comoVendedor = jwt.sign({ sub: f.a.usuarioId, role: 'salesperson', tenantId: f.a.id });
    comoAdminB = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });
  }, 90_000);

  afterAll(async () => {
    for (const t of [f.a, f.b]) {
      await dono.$executeRaw`DELETE FROM portal_deliveries WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM portal_connections WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM lead_interactions WHERE tenant_id = ${t.id}::uuid`;
    }
    await f?.limpar();
    await app?.close();
  });

  describe('o endereço de entrada', () => {
    it('vendedor não conecta portal', async () => {
      expect((await post('/portais/olx/conectar', comoVendedor)).status).toBe(403);
    });

    it('o dono conecta e recebe o endereço uma vez — URL e e-mail com o mesmo token', async () => {
      const r = await post('/portais/olx/conectar', comoAdmin);
      expect(r.status).toBe(201);
      expect(r.body.token).toMatch(/^[0-9a-f]{40}$/);
      expect(r.body.email).toBe(`leads+${r.body.token}@entrada.teste`);
      token = r.body.token;
      endereco = r.body.email;

      const [c] = await dono.$queryRaw<{ token_hash: string }[]>`
        SELECT token_hash FROM portal_connections WHERE tenant_id = ${f.a.id}::uuid AND portal = 'olx'`;
      // Só o hash fica: o token cru não está no banco.
      expect(c.token_hash).not.toBe(token);
      expect(c.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('uma conexão ativa por portal', async () => {
      expect((await post('/portais/olx/conectar', comoAdmin)).status).toBe(409);
    });

    it('portal desconhecido é 404', async () => {
      expect((await post('/portais/orkut/conectar', comoAdmin)).status).toBe(404);
    });
  });

  describe('webhook no formato AutoConnect', () => {
    const corpo = JSON.stringify({
      id: 'olx-1', nome: 'Maria Souza', telefone: '(11) 98765-1001', mensagem: 'Ainda disponível?',
      anuncio: { titulo: 'Onix 1.0 2019', preco: '55.900', url: 'https://sp.olx.com.br/onix' },
    });

    it('vira lead de portal pelo caminho do formulário, com o anúncio na mensagem', async () => {
      const r = await webhook(token, corpo);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ recebido: true, duplicada: false, situacao: 'aplicado', leads: 1 });

      const l = await leadPorTelefone('11987651001');
      expect(l.source).toBe('portal');
      expect(l.metadata).toMatchObject({ portal: 'olx', idNoPortal: 'olx-1', anuncio: { titulo: 'Onix 1.0 2019' } });
      expect(l.message).toBe('Ainda disponível?\nAnúncio na OLX: Onix 1.0 2019 · R$ 55.900\nhttps://sp.olx.com.br/onix');

      const [i] = await dono.$queryRaw<{ content: string }[]>`
        SELECT content FROM lead_interactions WHERE lead_id = ${l.id}::uuid AND kind = 'created'`;
      expect(i.content).toBe('Lead criado — OLX');
    });

    it('a mesma entrega de novo não duplica nada', async () => {
      const r = await webhook(token, corpo);
      expect(r.body).toEqual({ recebido: true, duplicada: true });
      const [{ total }] = await dono.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM leads WHERE tenant_id = ${f.a.id}::uuid AND contact_phone_normalized = '11987651001'`;
      expect(Number(total)).toBe(1);
    });

    it('o mesmo cliente por outro anúncio cai no lead existente (deduplicação)', async () => {
      const r = await webhook(token, JSON.stringify({ nome: 'Maria Souza', telefone: '11987651001', mensagem: 'E o HB20?' }));
      expect(r.body).toMatchObject({ situacao: 'duplicado', leads: 1 });
      const l = await leadPorTelefone('11987651001');
      const [i] = await dono.$queryRaw<{ kind: string }[]>`
        SELECT kind FROM lead_interactions WHERE lead_id = ${l.id}::uuid ORDER BY occurred_at DESC LIMIT 1`;
      expect(i.kind).toBe('duplicate');
    });

    it('corpo fora do formato fica guardado como "não entendido", sem erro para o portal', async () => {
      const r = await webhook(token, 'nome=Ana&telefone=11987650000');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ situacao: 'nao_entendido', leads: 0 });
      const [e] = await dono.$queryRaw<{ raw_body: string }[]>`
        SELECT raw_body FROM portal_deliveries WHERE tenant_id = ${f.a.id}::uuid AND status = 'nao_entendido'
        ORDER BY received_at DESC LIMIT 1`;
      expect(e.raw_body).toBe('nome=Ana&telefone=11987650000');
    });

    it('token que não existe, ou malformado, é 404', async () => {
      expect((await webhook('f'.repeat(40), corpo)).status).toBe(404);
      expect((await webhook('nao-e-token', corpo)).status).toBe(404);
    });
  });

  describe('e-mail encaminhado', () => {
    it('a notificação com rótulos vira lead', async () => {
      const r = await email({
        texto: 'Nome: João Lima\nTelefone: (21) 99876-1002\nMensagem: Faz financiamento?\nAnúncio: HB20 2020',
      });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ situacao: 'aplicado', leads: 1 });
      const l = await leadPorTelefone('21998761002');
      expect(l.message).toBe('Faz financiamento?\nAnúncio na OLX: HB20 2020');
    });

    it('sem a senha do provedor é 401', async () => {
      const r = await email({ texto: 'Nome: X\nTelefone: 21998761003' }, 'Basic ' + Buffer.from('entrada:chute').toString('base64'));
      expect(r.status).toBe(401);
    });

    it('destinatário que não é de loja nenhuma é aceito e descartado', async () => {
      const r = await email({ para: ['vendas@loja.test'], texto: 'Nome: X\nTelefone: 21998761004' });
      expect(r.body).toEqual({ recebido: true, descartado: 'destinatario-desconhecido' });
    });

    it('a confirmação do Gmail aparece na tela com o código', async () => {
      await email({ de: 'forwarding-noreply@google.com', assunto: '(#987654321) Confirmação de encaminhamento do Gmail' });
      const r = await get('/portais', comoAdmin);
      const olx = r.body.portais.find((p: { chave: string }) => p.chave === 'olx');
      expect(olx.recentes[0]).toMatchObject({
        situacao: 'ignorado',
        resumo: 'O Gmail pediu para confirmar o encaminhamento. Código de confirmação: 987654321',
      });
    });
  });

  describe('reprocessar', () => {
    it('relê a entrega não entendida com o leitor de hoje', async () => {
      // Uma entrega que um leitor antigo não entendeu — o de hoje entende.
      const [c] = await dono.$queryRaw<{ id: string }[]>`
        SELECT id FROM portal_connections WHERE tenant_id = ${f.a.id}::uuid AND portal = 'olx' AND active`;
      const raw = JSON.stringify({
        idExterno: 'antigo-1', de: 'x@olx.com.br', para: [], assunto: 'Lead antigo', html: null,
        texto: 'Nome: Paula\nCelular: 31 99777-1005',
      });
      const [e] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO portal_deliveries (tenant_id, connection_id, portal, transport, event_key, status, summary, raw_body)
        VALUES (${f.a.id}::uuid, ${c.id}::uuid, 'olx', 'email', 'antigo-1', 'nao_entendido', 'Lead antigo', ${raw})
        RETURNING id`;

      const r = await post(`/portais/entregas/${e.id}/reprocessar`, comoAdmin);
      expect(r.status).toBe(201);
      expect(r.body.situacao).toBe('aplicado');
      expect(await leadPorTelefone('31997771005')).toBeDefined();

      // E não se reprocessa o que já foi aplicado.
      expect((await post(`/portais/entregas/${e.id}/reprocessar`, comoAdmin)).status).toBe(409);
    });

    it('a outra loja não reprocessa nem vê as entregas desta', async () => {
      const [e] = await dono.$queryRaw<{ id: string }[]>`
        SELECT id FROM portal_deliveries WHERE tenant_id = ${f.a.id}::uuid AND status = 'nao_entendido' LIMIT 1`;
      expect((await post(`/portais/entregas/${e.id}/reprocessar`, comoAdminB)).status).toBe(404);
      const r = await get('/portais', comoAdminB);
      expect(r.body.portais.every((p: { recentes: unknown[]; conexao: unknown }) => p.recentes.length === 0 && !p.conexao))
        .toBe(true);
    });
  });

  describe('estado, simulação, endereço novo e desconexão', () => {
    it('o estado conta o mês por situação', async () => {
      const r = await get('/portais', comoVendedor);
      const olx = r.body.portais.find((p: { chave: string }) => p.chave === 'olx');
      expect(olx.conexao).not.toBeNull();
      expect(olx.mes).toMatchObject({ aplicado: 3, duplicado: 1, ignorado: 1 });
      expect(r.body).toMatchObject({ emailDisponivel: true, simulavel: true });
    });

    it('a simulação entrega pelo mesmo caminho, por webhook e por e-mail', async () => {
      const w = await post('/portais/olx/simular', comoVendedor, { via: 'webhook', nome: 'Rita', telefone: '(41) 99666-1006' });
      expect(w.body).toMatchObject({ situacao: 'aplicado', leads: 1 });
      const e = await post('/portais/olx/simular', comoVendedor, {
        via: 'email', nome: 'Beto', telefone: '(41) 99666-1007', mensagem: 'Tem laudo?', anuncio: 'Gol 2018',
      });
      expect(e.body).toMatchObject({ situacao: 'aplicado', leads: 1 });
      expect((await leadPorTelefone('41996661007')).message).toBe('Tem laudo?\nAnúncio na OLX: Gol 2018');
    });

    it('endereço novo: o anterior para de valer', async () => {
      const r = await post('/portais/olx/regenerar', comoAdmin);
      expect(r.status).toBe(201);
      expect(r.body.token).not.toBe(token);
      expect((await webhook(token, JSON.stringify({ nome: 'Z', telefone: '11987651999' }))).status).toBe(404);
      expect((await webhook(r.body.token, JSON.stringify({ nome: 'Z', telefone: '11987651999' }))).status).toBe(200);
      token = r.body.token;
    });

    it('desconectar desliga o endereço e preserva as entregas', async () => {
      expect((await http().delete('/api/v1/portais/olx').set('Authorization', `Bearer ${comoAdmin}`)).status).toBe(200);
      expect((await webhook(token, JSON.stringify({ nome: 'Z', telefone: '11987651998' }))).status).toBe(404);
      const r = await get('/portais', comoAdmin);
      const olx = r.body.portais.find((p: { chave: string }) => p.chave === 'olx');
      expect(olx.conexao).toBeNull();
      expect(olx.recentes.length).toBeGreaterThan(0);
    });
  });
});
