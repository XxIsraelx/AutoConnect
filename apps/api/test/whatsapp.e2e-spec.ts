import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import type { EventoDeWhatsApp } from '@autoconnect/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { PROVEDOR_DE_WHATSAPP } from '../src/modules/whatsapp/provedor';
import { ProvedorSimuladoDeWhatsApp } from '../src/modules/whatsapp/provedor-simulado';
import { cabecalhoHmac } from '../src/modules/contracts/assinatura/hmac';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * WhatsApp oficial, ponta a ponta, com o provedor simulado.
 *
 * O simulado não inventa formato: o webhook que ele monta é o da Meta,
 * assinado com o segredo do app, e entra pela rota HTTP de verdade com o corpo
 * cru. O que este arquivo prova vale para a produção, exceto a chamada de rede
 * (que `provedor-meta.spec.ts` cobre com `fetch` de mentira).
 */
describe('WhatsApp oficial (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let provedor: ProvedorSimuladoDeWhatsApp;
  let f: DoisTenants;
  let jwt: JwtService;
  let porta: number;
  let vendedorId: string;
  let comoVendedor: string;
  let comoAdmin: string;
  let comoAdminB: string;
  let contaA: string;
  const abertos: Socket[] = [];

  const http = () => request(app.getHttpServer());
  const post = (rota: string, t: string, corpo: object = {}) =>
    http().post(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`).send(corpo);
  const get = (rota: string, t: string) =>
    http().get(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`);
  const del = (rota: string, t: string) =>
    http().delete(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`);

  /** Entrega pela rota HTTP de verdade, com o corpo cru e a assinatura da Meta. */
  const entregar = (eventos: EventoDeWhatsApp[]) => {
    const { corpo, cabecalhos } = provedor.entrega(eventos);
    return http().post('/api/v1/webhooks/whatsapp')
      .set({ 'Content-Type': 'application/json', ...cabecalhos })
      .send(corpo.toString('utf8'));
  };

  let seq = 0;
  const doCliente = (de: string, texto: string, extra: Partial<EventoDeWhatsApp> = {}): EventoDeWhatsApp => ({
    tipo: 'mensagem',
    idExterno: `wamid.IN.${Date.now()}.${++seq}`,
    conta: contaA,
    de,
    nome: 'Maria Souza',
    formato: 'texto',
    texto,
    recebidaEm: new Date(),
    ...extra,
  } as EventoDeWhatsApp);

  const status = (idExterno: string, s: 'enviada' | 'entregue' | 'lida' | 'falhou'): EventoDeWhatsApp => ({
    tipo: 'status', idExterno, conta: contaA, status: s, em: new Date(), erro: s === 'falhou' ? 'motivo' : null,
  });

  const conectarSocket = (userId: string, role: string, tenantId: string | null) =>
    new Promise<Socket>((resolve, reject) => {
      const s = io(`http://localhost:${porta}/chat`, {
        auth: { token: jwt.sign({ sub: userId, role, tenantId }) },
        transports: ['websocket'],
        forceNew: true,
      });
      abertos.push(s);
      // O timer é limpo ao resolver: pendurado, ele segura o Jest aberto.
      const t = setTimeout(() => reject(new Error('não conectou')), 10_000);
      s.on('connect', () => { clearTimeout(t); resolve(s); });
      s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
    });

  const emitir = <T>(s: Socket, evento: string, dados: unknown) =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`sem ack de ${evento}`)), 10_000);
      s.emit(evento, dados, (r: T) => { clearTimeout(t); resolve(r); });
    });

  const conversaDe = async (telefone: string) => {
    const [c] = await dono.$queryRaw<{
      id: string; lead_id: string | null; channel: string; contact_name: string | null;
      external_contact_id: string | null; customer_last_message_at: Date | null;
      unread_count_salesperson: number;
    }[]>`
      SELECT id, lead_id, channel::text, contact_name, external_contact_id, customer_last_message_at,
             unread_count_salesperson
        FROM conversations
       WHERE tenant_id = ${f.a.id}::uuid AND contact_phone_normalized = ${telefone}
         AND status <> 'closed'`;
    return c;
  };

  const mensagensDe = (conversaId: string) => dono.$queryRaw<{
    id: string; body: string; sender_user_id: string | null; external_id: string | null;
    delivery_status: string | null; failure_reason: string | null; metadata: Record<string, unknown>;
    delivered_at: Date | null; read_at: Date | null;
  }[]>`
    SELECT id, body, sender_user_id, external_id, delivery_status, failure_reason, metadata,
           delivered_at, read_at
      FROM messages WHERE conversation_id = ${conversaId}::uuid ORDER BY created_at, id`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0);
    const addr = app.getHttpServer().address();
    porta = typeof addr === 'object' && addr ? addr.port : 0;

    dono = app.get(PrivilegedPrismaService, { strict: false });
    provedor = app.get(PROVEDOR_DE_WHATSAPP, { strict: false });
    jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);

    const [v] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO users (tenant_id, email, full_name, role, status, email_verified_at, updated_at)
      VALUES (${f.a.id}::uuid, ${`vendedor-wa-${Date.now()}@exemplo.test`}, 'Diego Vendedor',
              'salesperson', 'active', now(), now())
      RETURNING id`;
    vendedorId = v.id;
    comoVendedor = jwt.sign({ sub: vendedorId, role: 'salesperson', tenantId: f.a.id });
    comoAdmin = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
    comoAdminB = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });
  }, 90_000);

  afterAll(async () => {
    for (const s of abertos) s.disconnect();
    for (const t of [f.a, f.b]) {
      await dono.$executeRaw`DELETE FROM messages WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM conversations WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM whatsapp_webhook_events WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM whatsapp_accounts WHERE tenant_id = ${t.id}::uuid`;
      await dono.$executeRaw`DELETE FROM lead_interactions WHERE tenant_id = ${t.id}::uuid`;
    }
    await f?.limpar();
    await app?.close();
  });

  it('o provedor dos testes é o simulado, e a capacidade diz isso à tela', async () => {
    expect(provedor).toBeInstanceOf(ProvedorSimuladoDeWhatsApp);
    const r = await get('/whatsapp/capacidade', comoVendedor);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ disponivel: true, provedor: 'simulado', simulado: true, conta: null });
  });

  describe('o número da loja', () => {
    it('vendedor não conecta: é a voz da loja, decisão do dono', async () => {
      const r = await post('/whatsapp/conta', comoVendedor, { numero: '(11) 98888-0001' });
      expect(r.status).toBe(403);
    });

    it('o dono conecta; a capacidade passa a mostrar o número', async () => {
      const r = await post('/whatsapp/conta', comoAdmin, { numero: '(11) 98888-0001' });
      expect(r.status).toBe(201);
      expect(r.body.numero).toBe('11988880001');

      const [conta] = await dono.$queryRaw<{ external_id: string }[]>`
        SELECT external_id FROM whatsapp_accounts WHERE tenant_id = ${f.a.id}::uuid AND active`;
      contaA = conta.external_id;

      const cap = await get('/whatsapp/capacidade', comoVendedor);
      expect(cap.body.conta).toMatchObject({ numero: '11988880001' });
    });

    it('uma conta ativa por loja', async () => {
      const r = await post('/whatsapp/conta', comoAdmin, { numero: '(11) 98888-0002' });
      expect(r.status).toBe(409);
    });

    it('o mesmo número não fica ativo em duas lojas — o webhook não saberia de quem é', async () => {
      const r = await post('/whatsapp/conta', comoAdminB, { numero: '(11) 98888-0001' });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/outra loja/);
    });

    it('número inválido é recusado pelo schema', async () => {
      const r = await post('/whatsapp/conta', comoAdminB, { numero: '123' });
      expect(r.status).toBe(400);
    });
  });

  describe('o webhook', () => {
    it('responde o desafio do cadastro só com o token combinado', async () => {
      const ok = await http().get('/api/v1/webhooks/whatsapp').query({
        'hub.mode': 'subscribe', 'hub.verify_token': 'token-de-verificacao-de-teste', 'hub.challenge': '8765',
      });
      expect(ok.status).toBe(200);
      expect(ok.text).toBe('8765');

      const errado = await http().get('/api/v1/webhooks/whatsapp').query({
        'hub.mode': 'subscribe', 'hub.verify_token': 'chute', 'hub.challenge': '8765',
      });
      expect(errado.status).toBe(403);
    });

    it('assinatura que não confere é 401, e nada é gravado', async () => {
      const { corpo } = provedor.entrega([doCliente('5511977770000', 'forjado')]);
      const r = await http().post('/api/v1/webhooks/whatsapp')
        .set({ 'Content-Type': 'application/json', 'x-hub-signature-256': cabecalhoHmac(corpo, 'chute') })
        .send(corpo.toString('utf8'));
      expect(r.status).toBe(401);
      expect(await conversaDe('11977770000')).toBeUndefined();
    });

    it('evento de um número que nenhuma loja conectou é aceito e descartado', async () => {
      const r = await entregar([{ ...doCliente('5511977770001', 'oi'), conta: '999999999' }]);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ recebidos: 1, aplicados: 0 });
    });
  });

  describe('o cliente escreve', () => {
    const telefone = '11987650001';

    it('o primeiro contato vira lead de WhatsApp, conversa e mensagem, e abre a janela', async () => {
      const r = await entregar([doCliente(`55${telefone}`, 'Oi, o Onix ainda está disponível?')]);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ recebidos: 1, aplicados: 1 });

      const c = await conversaDe(telefone);
      expect(c).toMatchObject({
        channel: 'whatsapp', contact_name: 'Maria Souza', external_contact_id: `55${telefone}`,
        unread_count_salesperson: 1,
      });
      expect(c.customer_last_message_at).not.toBeNull();

      const [lead] = await dono.$queryRaw<{ source: string; contact_phone_normalized: string; message: string }[]>`
        SELECT source::text, contact_phone_normalized, message FROM leads WHERE id = ${c.lead_id}::uuid`;
      expect(lead).toEqual({
        source: 'whatsapp', contact_phone_normalized: telefone, message: 'Oi, o Onix ainda está disponível?',
      });

      const [m] = await mensagensDe(c.id);
      expect(m).toMatchObject({ body: 'Oi, o Onix ainda está disponível?', sender_user_id: null });
    });

    it('a reentrega da mesma mensagem não duplica nada', async () => {
      const evento = doCliente(`55${telefone}`, 'segunda');
      await entregar([evento]);
      const r = await entregar([evento]);
      expect(r.body).toEqual({ recebidos: 1, aplicados: 0 });

      const c = await conversaDe(telefone);
      expect((await mensagensDe(c.id)).filter((m) => m.body === 'segunda')).toHaveLength(1);
    });

    it('o wa_id sem o nono dígito cai na mesma conversa', async () => {
      // Contas antigas: o WhatsApp devolve 55 11 8765-0001, sem o nove.
      const r = await entregar([doCliente('551187650001', 'sou eu de novo')]);
      expect(r.body.aplicados).toBe(1);

      const [{ total }] = await dono.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM conversations
         WHERE tenant_id = ${f.a.id}::uuid AND contact_phone_normalized = ${telefone}`;
      expect(Number(total)).toBe(1);
    });

    it('quem já é lead (mesmo telefone) não vira lead novo: a conversa vai para o lead existente', async () => {
      await dono.$executeRaw`
        UPDATE leads SET contact_phone = '(21) 99876-0002', contact_phone_normalized = '21998760002',
                         last_activity_at = now()
         WHERE id = ${f.a.leadId}::uuid`;

      await entregar([doCliente('5521998760002', 'Vi o anúncio de novo')]);

      const c = await conversaDe('21998760002');
      expect(c.lead_id).toBe(f.a.leadId);
      const [i] = await dono.$queryRaw<{ kind: string }[]>`
        SELECT kind FROM lead_interactions WHERE lead_id = ${f.a.leadId}::uuid ORDER BY occurred_at DESC LIMIT 1`;
      expect(i.kind).toBe('duplicate');
    });

    it('a outra loja não vê a conversa', async () => {
      const c = await conversaDe(telefone);
      const r = await get(`/conversations/${c.id}/messages`, comoAdminB);
      expect(r.status).toBe(404);
      const lista = await get('/conversations', comoAdminB);
      expect(lista.body.items.map((x: { id: string }) => x.id)).not.toContain(c.id);
    });
  });

  describe('a loja responde', () => {
    const telefone = '11987650003';
    let conversaId: string;
    let socket: Socket;

    beforeAll(async () => {
      await entregar([doCliente(`55${telefone}`, 'Quero saber o preço')]);
      conversaId = (await conversaDe(telefone)).id;
      socket = await conectarSocket(vendedorId, 'salesperson', f.a.id);
    });

    it('dentro da janela, o texto sai pelo número da loja para o wa_id do cliente', async () => {
      const antes = provedor.enviados.length;
      const ack = await emitir<{ ok: boolean; messageId: string; deliveryStatus: string }>(
        socket, 'conversation:send', { conversationId: conversaId, body: 'Olá! O preço é R$ 72.900.' },
      );

      expect(ack).toMatchObject({ ok: true, deliveryStatus: 'enviada' });
      expect(provedor.enviados.slice(antes)).toEqual([
        expect.objectContaining({ tipo: 'texto', conta: contaA, para: `55${telefone}`, texto: 'Olá! O preço é R$ 72.900.' }),
      ]);

      const m = (await mensagensDe(conversaId)).find((x) => x.id === ack.messageId)!;
      expect(m).toMatchObject({ sender_user_id: vendedorId, delivery_status: 'enviada' });
      expect(m.external_id).toMatch(/^wamid\.SIM\./);
    });

    it('a primeira resposta para o prazo do lead e entra na timeline, uma vez só', async () => {
      await emitir(socket, 'conversation:send', { conversationId: conversaId, body: 'Mais alguma dúvida?' });
      const c = await conversaDe(telefone);
      const [lead] = await dono.$queryRaw<{ first_responded_at: Date | null }[]>`
        SELECT first_responded_at FROM leads WHERE id = ${c.lead_id}::uuid`;
      expect(lead.first_responded_at).not.toBeNull();

      const interacoes = await dono.$queryRaw<{ content: string }[]>`
        SELECT content FROM lead_interactions WHERE lead_id = ${c.lead_id}::uuid AND kind = 'whatsapp'`;
      expect(interacoes).toEqual([{ content: 'Conversa pelo WhatsApp oficial' }]);
    });

    it('os avisos de entrega avançam e nunca voltam', async () => {
      const [m] = (await mensagensDe(conversaId)).filter((x) => x.sender_user_id);
      await entregar([status(m.external_id!, 'lida')]);
      await entregar([status(m.external_id!, 'entregue')]);   // atrasado
      await entregar([status(m.external_id!, 'falhou')]);     // tardio

      const depois = (await mensagensDe(conversaId)).find((x) => x.id === m.id)!;
      expect(depois.delivery_status).toBe('lida');
      expect(depois.read_at).not.toBeNull();
      expect(depois.failure_reason).toBeNull();
    });

    it('proposta com botão de aceite não vai pelo WhatsApp', async () => {
      const ack = await emitir<{ ok: boolean; error: string }>(socket, 'conversation:send', {
        conversationId: conversaId, body: 'Proposta', metadata: { proposal: { price: 1 } },
      });
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/proposta/i);
    });

    it('fora da janela de 24 h, o texto livre é recusado e nada sai', async () => {
      await dono.$executeRaw`
        UPDATE conversations SET customer_last_message_at = now() - interval '25 hours'
         WHERE id = ${conversaId}::uuid`;
      const antes = provedor.enviados.length;

      const ack = await emitir<{ ok: boolean; error: string }>(socket, 'conversation:send', {
        conversationId: conversaId, body: 'Ainda está aí?',
      });

      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/janela de 24 horas/);
      expect(provedor.enviados.length).toBe(antes);
      expect((await mensagensDe(conversaId)).some((x) => x.body === 'Ainda está aí?')).toBe(false);
    });

    it('fora da janela, o modelo aprovado sai com o nome do cliente e fica gravado como o cliente leu', async () => {
      const r = await post(`/whatsapp/conversas/${conversaId}/modelo`, comoVendedor, { modelo: 'retomar_conversa' });

      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ deliveryStatus: 'enviada' });
      expect(provedor.enviados.at(-1)).toMatchObject({
        tipo: 'modelo', modelo: 'autoconnect_retomar_conversa', idioma: 'pt_BR',
        parametros: ['Maria', 'concessionaria-a'],
      });
      const m = (await mensagensDe(conversaId)).at(-1)!;
      expect(m.body).toBe(
        'Olá, Maria! Aqui é da concessionaria-a. Nossa conversa ficou parada — posso continuar te ajudando?',
      );
      expect(m.metadata).toMatchObject({ modelo: 'retomar_conversa', categoria: 'utility' });
    });

    it('modelo automático (lembrete) não é escolha da tela', async () => {
      const r = await post(`/whatsapp/conversas/${conversaId}/modelo`, comoVendedor, { modelo: 'lembrete_agendamento' });
      expect(r.status).toBe(400);
    });

    it('recusa do provedor: a mensagem fica "falhou" com o motivo, em vez de sumir', async () => {
      provedor.recusarProximo('131026 — Mensagem não entregue');
      const r = await post(`/whatsapp/conversas/${conversaId}/modelo`, comoVendedor, { modelo: 'retorno_proposta' });

      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ deliveryStatus: 'falhou', failureReason: '131026 — Mensagem não entregue' });
    });

    it('o aviso de entrega que chega antes do envio voltar é reaplicado', async () => {
      provedor.usarIdNoProximoEnvio('wamid.ADIANTADO.1');
      // A Meta avisou antes de o envio ser gravado aqui: fica pendente.
      const antes = await entregar([status('wamid.ADIANTADO.1', 'entregue')]);
      expect(antes.body).toEqual({ recebidos: 1, aplicados: 0 });

      const r = await post(`/whatsapp/conversas/${conversaId}/modelo`, comoVendedor, { modelo: 'retomar_conversa' });
      expect(r.body).toMatchObject({ externalId: 'wamid.ADIANTADO.1', deliveryStatus: 'entregue' });
    });

    it('a outra loja não manda modelo na conversa desta, mesmo com número próprio', async () => {
      expect((await post('/whatsapp/conta', comoAdminB, { numero: '(31) 97777-0001' })).status).toBe(201);
      const r = await post(`/whatsapp/conversas/${conversaId}/modelo`, comoAdminB, { modelo: 'retomar_conversa' });
      expect(r.status).toBe(404);
    });
  });

  describe('conversa aberta pela loja, a partir do lead', () => {
    const inserirLead = async (nome: string, telefone: string, assignedTo: string | null = null) => {
      const [l] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO leads (tenant_id, contact_name, contact_phone, contact_phone_normalized, source,
                           assigned_to, updated_at)
        VALUES (${f.a.id}::uuid, ${nome}, ${telefone}, ${telefone.replace(/\D/g, '')}, 'ad',
                ${assignedTo}::uuid, now())
        RETURNING id`;
      return l.id;
    };
    let leadId: string;

    beforeAll(async () => {
      leadId = await inserirLead('João Pereira', '(11) 98765-0009');
    });

    it('abre a conversa com a janela fechada, e reabrir devolve a mesma', async () => {
      const r = await post('/whatsapp/conversas', comoVendedor, { leadId });
      expect(r.status).toBe(201);
      expect(r.body.criada).toBe(true);
      expect((await conversaDe('11987650009')).customer_last_message_at).toBeNull();

      const r2 = await post('/whatsapp/conversas', comoVendedor, { leadId });
      expect(r2.body).toEqual({ id: r.body.id, criada: false });
    });

    it('o primeiro envio é o modelo de primeiro contato; a resposta do cliente cai na mesma conversa', async () => {
      const { id } = (await post('/whatsapp/conversas', comoVendedor, { leadId })).body;

      const r = await post(`/whatsapp/conversas/${id}/modelo`, comoVendedor, { modelo: 'primeiro_contato' });
      expect(r.status).toBe(201);
      expect(r.body.body).toBe(
        'Olá, João! Aqui é Diego, da concessionaria-a. Recebemos seu interesse em um dos nossos veículos. ' +
          'Posso te ajudar por aqui?',
      );
      // A loja fala primeiro: sem wa_id ainda, vai para o número com DDI.
      expect(provedor.enviados.at(-1)).toMatchObject({ para: '5511987650009' });

      await entregar([doCliente('5511987650009', 'Oi, Diego!')]);
      const c = await conversaDe('11987650009');
      expect(c.id).toBe(id);
      expect(c.customer_last_message_at).not.toBeNull();
    });

    it('lead sem celular não abre conversa de WhatsApp', async () => {
      const fixo = await inserirLead('Oficina Central', '(11) 3333-4444');
      const r = await post('/whatsapp/conversas', comoVendedor, { leadId: fixo });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/celular/);
    });

    it('o vendedor não abre conversa com lead da carteira de outro', async () => {
      const deOutro = await inserirLead('Paulo Lima', '(11) 98765-0011', f.a.usuarioId);
      const r = await post('/whatsapp/conversas', comoVendedor, { leadId: deOutro });
      expect(r.status).toBe(404);
    });
  });

  describe('uso do mês, simulação e desconexão', () => {
    it('o uso conta modelos enviados por categoria — os recusados não', async () => {
      const r = await get('/whatsapp/uso', comoAdmin);
      expect(r.status).toBe(200);
      // retomar (1), retomar (adiantado) e primeiro contato; o retorno de
      // proposta foi recusado e não conta.
      expect(r.body.modelosEnviados).toBe(3);
      expect(r.body.modelosPorCategoria).toEqual({ utility: 3 });
      expect(r.body.mensagensRecebidas).toBeGreaterThan(0);
      expect(r.body.conversas).toBeGreaterThan(0);
    });

    it('a simulação entrega pelo caminho real do webhook', async () => {
      const r = await post('/whatsapp/simular', comoVendedor, {
        acao: 'mensagem', telefone: '(11) 98765-0010', nome: 'Carla', texto: 'Olá',
      });
      expect(r.status).toBe(201);
      expect(r.body).toEqual({ recebidos: 1, aplicados: 1 });
      expect(await conversaDe('11987650010')).toBeDefined();
    });

    it('desconectar não apaga: a conversa fica, o envio pede para reconectar, e o webhook deixa de entrar', async () => {
      const c = await conversaDe('11987650010');
      expect((await del('/whatsapp/conta', comoAdmin)).status).toBe(200);

      const r = await post(`/whatsapp/conversas/${c.id}/modelo`, comoVendedor, { modelo: 'retomar_conversa' });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/desconectado/);

      const w = await entregar([doCliente('5511987650010', 'alguém aí?')]);
      expect(w.body).toEqual({ recebidos: 1, aplicados: 0 });
    });

    it('reconectar o mesmo número reativa a mesma linha, e a conversa volta a funcionar', async () => {
      expect((await post('/whatsapp/conta', comoAdmin, { numero: '(11) 98888-0001' })).status).toBe(201);
      const [{ total }] = await dono.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM whatsapp_accounts WHERE tenant_id = ${f.a.id}::uuid`;
      expect(Number(total)).toBe(1);

      const c = await conversaDe('11987650010');
      const r = await post(`/whatsapp/conversas/${c.id}/modelo`, comoVendedor, { modelo: 'retomar_conversa' });
      expect(r.status).toBe(201);
    });
  });
});
