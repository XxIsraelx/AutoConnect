import { createHash } from 'crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { PROVEDOR_DE_ASSINATURA } from '../src/modules/contracts/assinatura/provedor';
import { ProvedorSimulado } from '../src/modules/contracts/assinatura/provedor-simulado';
import { cabecalhoHmac } from '../src/modules/contracts/assinatura/hmac';
import { comoApp, criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Assinatura eletrônica externa, ponta a ponta, com o provedor simulado.
 *
 * O `setup-e2e.ts` liga `ASSINATURA_FORNECEDOR=simulado` e zera o Storage —
 * então este arquivo também prova o caminho "sem armazenamento": a conclusão
 * grava o hash do PDF assinado, sem chave, e o download o busca no provedor.
 */
describe('Assinatura externa (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let prisma: PrismaService;
  let provedor: ProvedorSimulado;
  let f: DoisTenants;
  let jwt: JwtService;
  let comoVendedor: string;
  let comoAdmin: string;
  let daOutraLoja: string;

  const http = () => request(app.getHttpServer());
  const post = (rota: string, t: string, corpo: object = {}) =>
    http().post(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`).send(corpo);
  const get = (rota: string, t: string) =>
    http().get(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`);

  /** Entrega de webhook pela rota HTTP de verdade, com o corpo cru. */
  const webhook = (corpo: Buffer, cabecalhos: Record<string, string>) =>
    http().post('/api/v1/webhooks/assinatura')
      .set({ 'Content-Type': 'application/json', ...cabecalhos })
      .send(corpo.toString('utf8'));

  const entregaHttp = (e: { corpo: Buffer; cabecalhos: Record<string, unknown> }) =>
    webhook(e.corpo, { 'content-hmac': String(e.cabecalhos['content-hmac']) });

  const criarNegocio = async (opcoes: { emailComprador?: string | null } = {}) => {
    const email = opcoes.emailComprador === undefined ? 'maria@exemplo.test' : opcoes.emailComprador;
    const [d] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO deals (tenant_id, vehicle_id, list_price, discount, sale_value, status, updated_at)
      VALUES (${f.a.id}::uuid, ${f.a.veiculoPublicoId}::uuid, 100000, 0, 100000, 'contract_issued', now())
      RETURNING id`;
    await dono.$executeRaw`
      INSERT INTO deal_payments (tenant_id, deal_id, kind, value, updated_at)
      VALUES (${f.a.id}::uuid, ${d.id}::uuid, 'cash', 100000, now())`;
    await dono.$executeRaw`
      INSERT INTO deal_buyers (deal_id, tenant_id, full_name, cpf, email, updated_at)
      VALUES (${d.id}::uuid, ${f.a.id}::uuid, 'Maria Silva', '52998224725', ${email}, now())`;
    return d.id;
  };

  const emitir = async (dealId: string) => {
    const res = await post(`/deals/${dealId}/contract`, comoVendedor);
    expect(res.status).toBe(201);
    return res.body as { id: string; contentHash: string };
  };

  const enviar = (contratoId: string, t = comoVendedor) =>
    post(`/contracts/${contratoId}/assinatura-externa`, t, { prazoDias: 15 });

  const simular = (contratoId: string, acao: string, papel?: string) =>
    post(`/contracts/${contratoId}/assinatura-externa/simular`, comoVendedor, { acao, papel });

  const solicitacaoDe = async (contratoId: string) => {
    const [r] = await dono.$queryRaw<{
      id: string; status: string; external_id: string | null;
      signed_hash: string | null; signed_storage_key: string | null; content_hash: string;
    }[]>`
      SELECT id, status::text, external_id, signed_hash, signed_storage_key, content_hash
        FROM contract_signature_requests WHERE contract_id = ${contratoId}::uuid
       ORDER BY created_at DESC LIMIT 1`;
    return r;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    prisma = app.get(PrismaService, { strict: false });
    provedor = app.get(PROVEDOR_DE_ASSINATURA, { strict: false });
    jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);
    await dono.$executeRaw`
      UPDATE tenants
         SET legal_rep_name = 'Carlos Souza', legal_rep_cpf = '52998224725',
             legal_rep_role = 'sócio-administrador', legal_rep_email = 'carlos@loja.test'
       WHERE id = ${f.a.id}::uuid`;
    comoVendedor = jwt.sign({ sub: f.a.usuarioId, role: 'salesperson', tenantId: f.a.id });
    comoAdmin = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
    daOutraLoja = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });
  }, 90_000);

  afterEach(async () => {
    // Negócio em cascata leva contrato, solicitação, eventos e assinaturas.
    await dono.$executeRaw`DELETE FROM deals WHERE tenant_id = ${f.a.id}::uuid`;
  });

  afterAll(async () => {
    await dono.$executeRaw`DELETE FROM contract_templates WHERE tenant_id = ${f.a.id}::uuid`;
    await f?.limpar();
    await app?.close();
  });

  it('o provedor dos testes é o simulado, e a capacidade diz isso à tela', async () => {
    expect(provedor).toBeInstanceOf(ProvedorSimulado);

    const res = await get('/contracts/assinatura-externa/capacidade', comoVendedor);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ disponivel: true, provedor: 'simulado', simulado: true });
  });

  describe('fluxo completo', () => {
    it('emite → envia → as duas partes assinam → contrato assinado com hash do PDF assinado', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);

      const enviado = await enviar(c.id);
      expect(enviado.status).toBe(201);
      expect(enviado.body.status).toBe('sent');
      expect(enviado.body.signatarios).toEqual([
        expect.objectContaining({ papel: 'dealer', email: 'carlos@loja.test', status: 'enviado', idExterno: expect.any(String) }),
        expect.objectContaining({ papel: 'customer', email: 'maria@exemplo.test', status: 'enviado', idExterno: expect.any(String) }),
      ]);

      // O que foi enviado é o documento da emissão, e nada mais.
      const r0 = await solicitacaoDe(c.id);
      expect(r0.content_hash).toBe(c.contentHash);

      const loja = await simular(c.id, 'assinar', 'dealer');
      expect(loja.status).toBe(201);
      expect(loja.body.solicitacao.status).toBe('sent');
      expect(loja.body.solicitacao.signatarios.map((s: { status: string }) => s.status))
        .toEqual(['assinou', 'enviado']);

      const cliente = await simular(c.id, 'assinar', 'customer');
      expect(cliente.body.solicitacao.status).toBe('completed');

      const [contrato] = await dono.$queryRaw<{ status: string; signed_at: Date | null }[]>`
        SELECT status::text, signed_at FROM deal_contracts WHERE id = ${c.id}::uuid`;
      expect(contrato.status).toBe('signed');
      expect(contrato.signed_at).not.toBeNull();

      // A assinatura fica representada como sempre — uma linha por parte —,
      // com a evidência do provedor no lugar de ip/userAgent.
      const assinaturas = await dono.$queryRaw<{
        role: string; request_id: string | null; external_signer_id: string | null;
        accepted_hash: string; ip: string | null;
      }[]>`
        SELECT role::text, request_id, external_signer_id, accepted_hash, ip
          FROM contract_signatures WHERE contract_id = ${c.id}::uuid ORDER BY role`;
      const r = await solicitacaoDe(c.id);
      expect(assinaturas).toHaveLength(2);
      for (const a of assinaturas) {
        expect(a.request_id).toBe(r.id);
        expect(a.external_signer_id).toMatch(/^sim_/);
        expect(a.accepted_hash).toBe(c.contentHash);
        expect(a.ip).toBeNull();
      }

      // Sem Storage (zerado no setup): hash gravado, chave não.
      expect(r.signed_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.signed_hash).not.toBe(c.contentHash);
      expect(r.signed_storage_key).toBeNull();

      // E o download busca no provedor e confere o hash.
      const pdf = await get(`/contracts/${c.id}/assinatura-externa/pdf`, comoVendedor).buffer();
      expect(pdf.status).toBe(200);
      expect(pdf.headers['cache-control']).toMatch(/no-store/);
      expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(createHash('sha256').update(pdf.body).digest('hex')).toBe(r.signed_hash);

      // A timeline do negócio conta a história.
      const eventos = await dono.$queryRaw<{ reason: string }[]>`
        SELECT reason FROM deal_status_events WHERE deal_id = ${dealId}::uuid ORDER BY occurred_at`;
      expect(eventos.map((e) => e.reason)).toEqual(expect.arrayContaining([
        expect.stringMatching(/enviado para assinatura eletrônica/),
        expect.stringMatching(/assinado eletronicamente/),
      ]));
    }, 60_000);

    it('recusa de um signatário encerra o envio, e o contrato pode ser reenviado', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);
      await enviar(c.id);

      const res = await simular(c.id, 'recusar', 'customer');
      expect(res.body.solicitacao.status).toBe('refused');

      const de_novo = await enviar(c.id);
      expect(de_novo.status).toBe(201);
      expect(de_novo.body.status).toBe('sent');
    }, 45_000);

    it('status mostra a solicitação da loja', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);
      await enviar(c.id);

      const res = await get(`/contracts/${c.id}/assinatura-externa`, comoVendedor);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ disponivel: true, solicitacao: { status: 'sent', provider: 'simulado' } });
    }, 30_000);
  });

  describe('pré-condições', () => {
    it('sem e-mail do comprador (nem cliente vinculado) → 422 nomeando o campo', async () => {
      const dealId = await criarNegocio({ emailComprador: null });
      const c = await emitir(dealId);

      const res = await enviar(c.id);

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/e-mail do comprador/);
      expect(await solicitacaoDe(c.id)).toBeUndefined();
    }, 30_000);

    it('sem e-mail do representante legal → 422 nomeando o campo', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);
      await dono.$executeRaw`UPDATE tenants SET legal_rep_email = NULL WHERE id = ${f.a.id}::uuid`;

      try {
        const res = await enviar(c.id);
        expect(res.status).toBe(422);
        expect(res.body.message).toMatch(/e-mail do representante legal/);
      } finally {
        await dono.$executeRaw`
          UPDATE tenants SET legal_rep_email = 'carlos@loja.test' WHERE id = ${f.a.id}::uuid`;
      }
    }, 30_000);

    it('contrato anulado não é enviado', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);
      await post(`/contracts/${c.id}/void`, comoAdmin, { reason: 'valor incorreto' });

      expect((await enviar(c.id)).status).toBe(409);
    }, 30_000);

    it('segundo envio com um vivo → 409, e só um envelope existe', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);

      const [a, b] = await Promise.all([enviar(c.id), enviar(c.id)]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const [{ n }] = await dono.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM contract_signature_requests
         WHERE contract_id = ${c.id}::uuid AND status IN ('pending', 'sent')`;
      expect(n).toBe(1);
    }, 30_000);
  });

  describe('coexistência com a assinatura interna', () => {
    it('com envio vivo, a assinatura pelo sistema é recusada (409)', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);
      await enviar(c.id);

      const res = await post(`/contracts/${c.id}/sign`, comoVendedor, { role: 'dealer', signerName: 'Vendedor Um' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/assinatura eletrônica/);
    }, 30_000);

    it('com assinatura interna já registrada, o envio externo é recusado (409)', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);
      await post(`/contracts/${c.id}/sign`, comoVendedor, { role: 'dealer', signerName: 'Vendedor Um' });

      const res = await enviar(c.id);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/não se misturam/);
    }, 30_000);

    it('depois de cancelar o envio, a assinatura interna volta a valer', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);
      await enviar(c.id);

      const cancel = await post(`/contracts/${c.id}/assinatura-externa/cancelar`, comoVendedor, { motivo: 'cliente preferiu assinar na loja' });
      expect(cancel.status).toBe(201);
      expect(cancel.body.status).toBe('canceled');

      const res = await post(`/contracts/${c.id}/sign`, comoVendedor, { role: 'dealer', signerName: 'Vendedor Um' });
      expect(res.status).toBe(201);
    }, 30_000);
  });

  describe('cancelamento em cascata', () => {
    it('anular o contrato cancela o envio — e a conclusão atrasada é ignorada', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);
      await enviar(c.id);
      const { external_id: idExterno } = await solicitacaoDe(c.id);

      const anular = await post(`/contracts/${c.id}/void`, comoAdmin, { reason: 'valor incorreto' });
      expect(anular.status).toBe(201);
      expect((await solicitacaoDe(c.id)).status).toBe('canceled');

      // O provedor manda a conclusão mesmo assim (corrida, ou envelope que não
      // cancelou lá): entra, fica registrada e não muda nada.
      const tardia = provedor.entrega({
        event: { name: 'auto_close', occurred_at: new Date().toISOString() },
        document: { key: idExterno! },
      });
      const res = await entregaHttp(tardia);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ aplicado: false, motivo: 'sem-efeito' });

      const [contrato] = await dono.$queryRaw<{ status: string }[]>`
        SELECT status::text FROM deal_contracts WHERE id = ${c.id}::uuid`;
      expect(contrato.status).toBe('voided');
    }, 45_000);

    it('cancelar o negócio cancela o envio', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);
      await enviar(c.id);

      const res = await post(`/deals/${dealId}/transition`, comoVendedor, { to: 'canceled', cancelReasonCode: 'desistencia_do_cliente', reason: 'cliente desistiu' });
      expect(res.status).toBe(201);

      expect((await solicitacaoDe(c.id)).status).toBe('canceled');
    }, 30_000);
  });

  describe('webhook', () => {
    const preparar = async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);
      await enviar(c.id);
      const r = await solicitacaoDe(c.id);
      return { c, idExterno: r.external_id!, requestId: r.id };
    };

    const assinatura = (idExterno: string, papel: 'dealer' | 'customer') =>
      provedor.entrega({
        event: {
          name: 'sign',
          data: { signer: { key: `${idExterno}.${papel}` } },
          occurred_at: '2026-09-22T12:00:00.000Z',
        },
        document: { key: idExterno },
      });

    it('a mesma entrega duas vezes é aplicada uma vez só', async () => {
      const { idExterno, requestId } = await preparar();
      const entrega = assinatura(idExterno, 'customer');

      const primeira = await entregaHttp(entrega);
      const segunda = await entregaHttp(entrega);

      expect(primeira.status).toBe(200);
      expect(primeira.body).toMatchObject({ aplicado: true });
      expect(segunda.status).toBe(200);
      expect(segunda.body).toMatchObject({ aplicado: false, motivo: 'duplicado' });

      const eventos = await dono.$queryRaw<{ kind: string; raw_body: string }[]>`
        SELECT kind, raw_body FROM contract_signature_events WHERE request_id = ${requestId}::uuid`;
      expect(eventos).toHaveLength(1);
      // Guardado byte a byte: o HMAC pode ser reconferido na auditoria.
      expect(eventos[0]!.raw_body).toBe(entrega.corpo.toString('utf8'));
    }, 30_000);

    it('fora de ordem: conclusão antes das assinaturas fecha tudo, e as assinaturas atrasadas não mudam nada', async () => {
      const { c, idExterno } = await preparar();

      const conclusao = provedor.entrega({
        event: { name: 'auto_close', occurred_at: new Date().toISOString() },
        document: { key: idExterno },
      });
      expect((await entregaHttp(conclusao)).body).toMatchObject({ aplicado: true });

      const atrasada = await entregaHttp(assinatura(idExterno, 'dealer'));
      expect(atrasada.body).toMatchObject({ aplicado: false, motivo: 'sem-efeito' });

      const [contrato] = await dono.$queryRaw<{ status: string }[]>`
        SELECT status::text FROM deal_contracts WHERE id = ${c.id}::uuid`;
      expect(contrato.status).toBe('signed');
    }, 30_000);

    it('HMAC que não confere → 401, e nada é gravado', async () => {
      const { idExterno, requestId } = await preparar();
      const e = assinatura(idExterno, 'customer');

      const errado = await webhook(e.corpo, { 'content-hmac': cabecalhoHmac(e.corpo, 'segredo-de-outro') });
      const sem = await webhook(e.corpo, {});
      const adulterado = await webhook(
        Buffer.from(e.corpo.toString().replace('customer', 'dealer')),
        { 'content-hmac': String(e.cabecalhos['content-hmac']) },
      );

      expect([errado.status, sem.status, adulterado.status]).toEqual([401, 401, 401]);
      const [{ n }] = await dono.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM contract_signature_events WHERE request_id = ${requestId}::uuid`;
      expect(n).toBe(0);
    }, 30_000);

    it('corpo reformatado (JSON reserializado) não passa — a rota lê o corpo cru', async () => {
      const { idExterno } = await preparar();
      const e = assinatura(idExterno, 'customer');
      const bonito = Buffer.from(JSON.stringify(JSON.parse(e.corpo.toString()), null, 2));

      const res = await webhook(bonito, { 'content-hmac': String(e.cabecalhos['content-hmac']) });

      expect(res.status).toBe(401);
    }, 30_000);

    it('envelope desconhecido → 200 ignorado (autêntico, mas de outra instalação)', async () => {
      const e = provedor.entrega({
        event: { name: 'auto_close', occurred_at: new Date().toISOString() },
        document: { key: 'sim_nao_existe_aqui' },
      });

      const res = await entregaHttp(e);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ recebido: true, aplicado: false, motivo: 'envelope-desconhecido' });
    });

    it('as outras rotas seguem recebendo JSON normalmente', async () => {
      // Guarda contra o parser cru vazar para fora da rota do webhook.
      const dealId = await criarNegocio();
      const res = await http().put(`/api/v1/deals/${dealId}/buyer`)
        .set('Authorization', `Bearer ${comoVendedor}`)
        .send({ fullName: 'Maria Silva', cpf: '529.982.247-25', email: 'nova@exemplo.test' });

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('nova@exemplo.test');
    }, 30_000);
  });

  describe('isolamento entre concessionárias', () => {
    it('a outra loja não vê, não envia, não cancela e não simula', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);
      await enviar(c.id);

      expect((await get(`/contracts/${c.id}/assinatura-externa`, daOutraLoja)).status).toBe(404);
      expect((await enviar(c.id, daOutraLoja)).status).toBe(404);
      expect((await post(`/contracts/${c.id}/assinatura-externa/cancelar`, daOutraLoja)).status).toBe(404);
      expect((await get(`/contracts/${c.id}/assinatura-externa/pdf`, daOutraLoja)).status).toBe(404);
      const sim = await post(`/contracts/${c.id}/assinatura-externa/simular`, daOutraLoja, { acao: 'assinar', papel: 'customer' });
      expect(sim.status).toBeGreaterThanOrEqual(400);

      // Nada disso mexeu na solicitação da loja A.
      expect((await solicitacaoDe(c.id)).status).toBe('sent');
    }, 45_000);

    it('sob RLS, a solicitação e os eventos só aparecem no contexto da própria loja', async () => {
      const dealId = await criarNegocio();
      const c = await emitir(dealId);
      await enviar(c.id);
      await simular(c.id, 'assinar', 'dealer');

      const contar = (ctx: { tenantId?: string }) =>
        comoApp(prisma, ctx, async (tx) => {
          const [r] = (await tx.$queryRawUnsafe(
            'SELECT (SELECT count(*)::int FROM contract_signature_requests WHERE contract_id = $1::uuid) AS req, ' +
              '(SELECT count(*)::int FROM contract_signature_events e JOIN contract_signature_requests r ' +
              '   ON r.id = e.request_id WHERE r.contract_id = $1::uuid) AS ev',
            c.id,
          )) as { req: number; ev: number }[];
          return r;
        });

      expect(await contar({ tenantId: f.a.id })).toEqual({ req: 1, ev: 1 });
      expect(await contar({ tenantId: f.b.id })).toEqual({ req: 0, ev: 0 });
      // Esquecer o contexto fecha tudo.
      expect(await contar({})).toEqual({ req: 0, ev: 0 });
    }, 45_000);
  });
});
