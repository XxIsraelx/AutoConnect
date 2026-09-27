import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TEXTO_DE_CONSENTIMENTO_RAIO_X, mensagemDoRaioX } from '@autoconnect/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { LimitePorIp, LIMITE_POR_JANELA } from '../src/modules/leads/limite-por-ip';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Raio-X da landing — o pedido vira lead na loja "AutoConnect" pelo mesmo
 * `POST /leads/public` da vitrine, sem veículo. Aqui a loja A da fixture faz o
 * papel da loja "AutoConnect".
 *
 * O que se fixa é o que a landing depende e que nenhum outro teste cobre com
 * este corpo: o consentimento do Raio-X gravado por cópia, loja/cargo/origem
 * no `message`, e o antiabuso valendo para um formulário sem veículo.
 */
describe('Raio-X da landing (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let limite: LimitePorIp;

  const rota = '/api/v1/leads/public';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    limite = app.get(LimitePorIp, { strict: false });
    f = await criarDoisTenants(dono);
  }, 90_000);

  // Todos os casos saem do mesmo IP e da mesma loja, ou seja, da mesma chave
  // do limite; o teto tem um caso só para ele.
  beforeEach(() => limite.limpar());

  afterAll(async () => {
    await f?.limpar();
    await app?.close();
  });

  /** O corpo que o `RaioXForm` manda, com o contato variável por caso. */
  const pedido = (over: Record<string, unknown> = {}) => ({
    tenantId: f.a.id,
    contactName: 'Joana Dona',
    contactPhone: '(19) 98765-4321',
    message: mensagemDoRaioX({ loja: 'Valinhos Veículos', cargo: 'dono', origem: 'instagram', secao: 'hero' }),
    consentimento: true,
    consentText: TEXTO_DE_CONSENTIMENTO_RAIO_X,
    website: '',
    ...over,
  });

  it('cria o lead com o consentimento do Raio-X e loja, cargo e origem no message', async () => {
    const res = await request(app.getHttpServer()).post(rota).send(pedido());

    expect(res.status).toBe(201);
    const lead = await dono.lead.findUniqueOrThrow({ where: { id: res.body.leadId } });
    expect(lead.tenantId).toBe(f.a.id);
    expect(lead.vehicleId).toBeNull();
    // Por cópia: o texto que a pessoa leu, não uma referência a uma versão.
    expect(lead.consentText).toBe(TEXTO_DE_CONSENTIMENTO_RAIO_X);
    expect(lead.message).toContain('Loja: Valinhos Veículos');
    expect(lead.message).toContain('Cargo: Dono');
    expect(lead.message).toContain('Origem: instagram');
  });

  it('sem aceite é 400 no campo do consentimento — o Raio-X não pula a LGPD', async () => {
    const res = await request(app.getHttpServer())
      .post(rota)
      .send(pedido({ contactPhone: '(19) 98765-0001', consentimento: false }));

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'consentimento' })]),
    );
  });

  it('honeypot preenchido responde sucesso e não grava', async () => {
    const res = await request(app.getHttpServer())
      .post(rota)
      .send(pedido({ contactPhone: '(19) 98765-0002', website: 'http://spam.example' }));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, leadId: null });
    const gravados = await dono.lead.count({ where: { tenantId: f.a.id, contactPhone: '(19) 98765-0002' } });
    expect(gravados).toBe(0);
  });

  it('o envio seguinte ao teto em 10 min é recusado, sem criar lead', async () => {
    // Telefones diferentes: senão quem barraria seria a deduplicação.
    for (let i = 0; i < LIMITE_POR_JANELA; i++) {
      const ok = await request(app.getHttpServer())
        .post(rota)
        .send(pedido({ contactPhone: `(19) 9810${i}-000${i}` }));
      expect(ok.status).toBe(201);
    }

    const barrado = await request(app.getHttpServer())
      .post(rota)
      .send(pedido({ contactPhone: '(19) 98199-9999' }));

    expect(barrado.status).toBe(409);
    const gravados = await dono.lead.count({ where: { tenantId: f.a.id, contactPhone: '(19) 98199-9999' } });
    expect(gravados).toBe(0);
  });

  it('o mesmo telefone pedindo de novo não vira segundo lead', async () => {
    const primeiro = await request(app.getHttpServer())
      .post(rota)
      .send(pedido({ contactPhone: '(19) 98765-0003' }));
    const segundo = await request(app.getHttpServer())
      .post(rota)
      .send(pedido({ contactPhone: '19987650003' }));

    expect(primeiro.status).toBe(201);
    expect(segundo.status).toBe(201);
    expect(segundo.body.deduplicado).toBe(true);
    expect(segundo.body.leadId).toBe(primeiro.body.leadId);
  });
});
