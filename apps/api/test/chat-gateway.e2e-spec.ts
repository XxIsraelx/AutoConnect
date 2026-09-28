import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * O gateway do chat pelo WebSocket de verdade.
 *
 * `proposta-chat.e2e-spec.ts` já cobre a lógica de virar negócio; o que se
 * fixa aqui é a **ligação**: que o evento chega ao handler, que o handler
 * chama o service, e que o id do negócio volta no metadata da mensagem. Era
 * justamente o trecho que ficava verificado só por leitura.
 *
 * O evento é `conversation:send` — o nome vem do decorator, não do método
 * (`onMessageSend`). Um teste emitindo o nome errado conecta, não recebe ack e
 * parece um gateway quebrado; foi o que aconteceu aqui antes.
 */
describe('ChatGateway (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let jwt: JwtService;
  let porta: number;
  let clienteId: string;
  const abertos: Socket[] = [];

  const conectar = (userId: string, role: string, tenantId: string | null) =>
    new Promise<Socket>((resolve, reject) => {
      const s = io(`http://localhost:${porta}/chat`, {
        auth: { token: jwt.sign({ sub: userId, role, tenantId }) },
        transports: ['websocket'],
        forceNew: true,
      });
      abertos.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
      setTimeout(() => reject(new Error('não conectou')), 10_000);
    });

  const emitir = <T>(s: Socket, evento: string, dados: unknown) =>
    new Promise<T>((resolve, reject) => {
      s.emit(evento, dados, resolve);
      setTimeout(() => reject(new Error(`sem ack de ${evento}`)), 10_000);
    });

  const criarConversa = async (vehicleId: string | null) => {
    const [c] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO conversations (tenant_id, customer_user_id, salesperson_id, vehicle_id, updated_at)
      VALUES (${f.a.id}::uuid, ${clienteId}::uuid, ${f.a.usuarioId}::uuid, ${vehicleId}::uuid, now())
      RETURNING id`;
    return c.id;
  };

  const PROPOSTA = { price: 88000, downPayment: 20000, installments: 48, status: 'pending' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0);
    const addr = app.getHttpServer().address();
    porta = typeof addr === 'object' && addr ? addr.port : 0;

    dono = app.get(PrivilegedPrismaService, { strict: false });
    jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);

    const [c] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO users (email, password_hash, full_name, role, status, updated_at)
      VALUES (${`ws-${Date.now()}@teste.com`}, 'x', 'Cliente WS', 'customer', 'active', now())
      RETURNING id`;
    clienteId = c.id;
  }, 90_000);

  afterEach(async () => {
    await dono.$executeRaw`DELETE FROM messages WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM conversations WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM deals WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`UPDATE vehicles SET status='available' WHERE tenant_id = ${f.a.id}::uuid`;
  });

  afterAll(async () => {
    for (const s of abertos) s.close();
    await dono.$executeRaw`DELETE FROM users WHERE id = ${clienteId}::uuid`;
    await f?.limpar();
    await app?.close();
  });

  it('mensagem simples é gravada e devolve ack', async () => {
    const conversaId = await criarConversa(null);
    const vendedor = await conectar(f.a.usuarioId, 'salesperson', f.a.id);

    const ack = await emitir<{ ok: boolean; messageId: string }>(vendedor, 'conversation:send', {
      conversationId: conversaId, body: 'olá',
    });

    expect(ack.ok).toBe(true);
    const [{ total }] = await dono.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM messages WHERE id = ${ack.messageId}::uuid`;
    expect(Number(total)).toBe(1);
  });

  it('a proposta abre o negócio e o id volta no metadata', async () => {
    const conversaId = await criarConversa(f.a.veiculoPublicoId);
    const vendedor = await conectar(f.a.usuarioId, 'salesperson', f.a.id);

    const ack = await emitir<{ ok: boolean; messageId: string }>(vendedor, 'conversation:send', {
      conversationId: conversaId, body: 'proposta', metadata: { proposal: PROPOSTA },
    });
    expect(ack.ok).toBe(true);

    const [msg] = await dono.$queryRaw<{ metadata: { proposal: { dealId?: string } } }[]>`
      SELECT metadata FROM messages WHERE id = ${ack.messageId}::uuid`;
    const dealId = msg.metadata.proposal.dealId;

    // É este vínculo que ficava sem prova: sem ele a proposta some do funil.
    expect(dealId).toBeTruthy();
    const [negocio] = await dono.$queryRaw<{ status: string; sale_value: string }[]>`
      SELECT status::text, sale_value::text FROM deals WHERE id = ${dealId}::uuid`;
    expect(negocio).toMatchObject({ status: 'proposal', sale_value: '88000.00' });
  });

  it('o aceite do cliente move o negócio', async () => {
    const conversaId = await criarConversa(f.a.veiculoPublicoId);
    const vendedor = await conectar(f.a.usuarioId, 'salesperson', f.a.id);
    const cliente = await conectar(clienteId, 'customer', null);

    const enviado = await emitir<{ messageId: string }>(vendedor, 'conversation:send', {
      conversationId: conversaId, body: 'p', metadata: { proposal: PROPOSTA },
    });
    const resposta = await emitir<{ ok: boolean }>(cliente, 'proposal:respond', {
      messageId: enviado.messageId, accept: true,
    });

    expect(resposta.ok).toBe(true);
    const [n] = await dono.$queryRaw<{ status: string }[]>`
      SELECT status::text FROM deals WHERE tenant_id = ${f.a.id}::uuid`;
    expect(n.status).toBe('negotiating');
  });

  it('o cliente não envia proposta, e nenhum negócio nasce disso', async () => {
    const conversaId = await criarConversa(f.a.veiculoPublicoId);
    const cliente = await conectar(clienteId, 'customer', null);

    const ack = await emitir<{ ok: boolean; error?: string }>(cliente, 'conversation:send', {
      conversationId: conversaId, body: 'p', metadata: { proposal: PROPOSTA },
    });

    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/Apenas a concessionária/);
    const [{ total }] = await dono.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM deals WHERE tenant_id = ${f.a.id}::uuid`;
    expect(Number(total)).toBe(0);
  });

  describe('prazo de primeiro contato', () => {
    const conversaDoLead = async () => {
      await dono.$executeRaw`
        UPDATE leads SET first_response_due_at = now() + interval '15 minutes', first_responded_at = NULL
        WHERE id = ${f.a.leadId}::uuid`;
      const [c] = await dono.$queryRaw<{ id: string }[]>`
        INSERT INTO conversations (tenant_id, customer_user_id, salesperson_id, lead_id, updated_at)
        VALUES (${f.a.id}::uuid, ${clienteId}::uuid, ${f.a.usuarioId}::uuid, ${f.a.leadId}::uuid, now())
        RETURNING id`;
      return c.id;
    };
    const situacaoDoLead = async () => {
      const [lead] = await dono.$queryRaw<{ first_responded_at: Date | null }[]>`
        SELECT first_responded_at FROM leads WHERE id = ${f.a.leadId}::uuid`;
      const interacoes = await dono.$queryRaw<{ actor_user_id: string | null; content: string | null }[]>`
        SELECT actor_user_id::text, content FROM lead_interactions
        WHERE lead_id = ${f.a.leadId}::uuid AND kind = 'chat'`;
      return { respondidoEm: lead.first_responded_at, interacoes };
    };

    afterEach(async () => {
      await dono.$executeRaw`DELETE FROM lead_interactions WHERE lead_id = ${f.a.leadId}::uuid`;
    });

    it('a mensagem do vendedor para o prazo e entra na linha do tempo uma vez', async () => {
      const conversaId = await conversaDoLead();
      const vendedor = await conectar(f.a.usuarioId, 'salesperson', f.a.id);

      await emitir(vendedor, 'conversation:send', { conversationId: conversaId, body: 'Oi! Sou o vendedor.' });
      const depoisDaPrimeira = await situacaoDoLead();
      expect(depoisDaPrimeira.respondidoEm).not.toBeNull();
      expect(depoisDaPrimeira.interacoes).toEqual([
        { actor_user_id: f.a.usuarioId, content: 'Conversa pelo chat do sistema' },
      ]);

      // A segunda mensagem não reescreve o prazo nem vira outra linha.
      await emitir(vendedor, 'conversation:send', { conversationId: conversaId, body: 'Ainda por aí?' });
      const depoisDaSegunda = await situacaoDoLead();
      expect(depoisDaSegunda.respondidoEm).toEqual(depoisDaPrimeira.respondidoEm);
      expect(depoisDaSegunda.interacoes).toHaveLength(1);
    });

    it('a mensagem do cliente não conta como resposta', async () => {
      const conversaId = await conversaDoLead();
      const cliente = await conectar(clienteId, 'customer', null);

      const ack = await emitir<{ ok: boolean }>(cliente, 'conversation:send', {
        conversationId: conversaId, body: 'Ainda está disponível?',
      });

      expect(ack.ok).toBe(true);
      expect(await situacaoDoLead()).toEqual({ respondidoEm: null, interacoes: [] });
    });

    it('o vendedor que responde depois do cliente ainda é a primeira resposta', async () => {
      const conversaId = await conversaDoLead();
      const cliente = await conectar(clienteId, 'customer', null);
      const vendedor = await conectar(f.a.usuarioId, 'salesperson', f.a.id);

      await emitir(cliente, 'conversation:send', { conversationId: conversaId, body: 'Oi?' });
      await emitir(vendedor, 'conversation:send', { conversationId: conversaId, body: 'Oi, tudo bem?' });

      const { respondidoEm, interacoes } = await situacaoDoLead();
      expect(respondidoEm).not.toBeNull();
      expect(interacoes).toHaveLength(1);
    });
  });

  it('conversa de outra concessionária é recusada', async () => {
    const conversaId = await criarConversa(f.a.veiculoPublicoId);
    const deOutraLoja = await conectar(f.b.usuarioId, 'salesperson', f.b.id);

    const ack = await emitir<{ ok: boolean; error?: string }>(deOutraLoja, 'conversation:send', {
      conversationId: conversaId, body: 'intruso',
    });

    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/Sem acesso/);
  });
});
