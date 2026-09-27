import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Portabilidade: a loja leva os dados dela.
 *
 * A LGPD dá esse direito ao titular e o termo do programa de fundadores promete
 * o mesmo à loja. Até 27/09/2026 saíam leads, desempenho, negócios e estoque —
 * **agendamento, conversa e mensagem não tinham como sair**, e é neles que mora
 * o histórico de atendimento.
 *
 * O que este arquivo fixa não é o formato do CSV: é que **nada da loja B
 * aparece na exportação da A**, em nenhuma das três rotas novas, e que o
 * vendedor leva a carteira dele e não a da loja.
 */
describe('Portabilidade dos dados da loja (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let jwt: JwtService;
  let comoAdmin: string;
  let comoVendedor: string;
  let vendedorId: string;

  /** Texto plantado em cada loja: é o que se procura (ou não) no arquivo. */
  const MARCA_A = 'MENSAGEM-DA-LOJA-A';
  const MARCA_B = 'MENSAGEM-DA-LOJA-B';
  const MARCA_OUTRO_VENDEDOR = 'MENSAGEM-DO-COLEGA';

  const baixar = (caminho: string, token: string) =>
    request(app.getHttpServer()).get(`/api/v1${caminho}`).set('Authorization', `Bearer ${token}`);

  async function semear(tenantId: string, texto: string, salespersonId: string | null) {
    // `conversations_tem_quem_responde`: ou tem conta, ou tem nome **e** token
    // de convidado. É o chat do lead anônimo, e é o caso que mais interessa
    // aqui — a conversa que existe só no agendamento sem cadastro.
    const conversa = await dono.conversation.create({
      data: {
        tenantId, salespersonId, status: 'open',
        contactName: `Cliente ${texto}`, contactPhone: '11988887777',
        guestTokenHash: `hash-${texto}-${Date.now()}`,
        lastMessageAt: new Date(),
      },
    });
    await dono.message.create({
      data: { tenantId, conversationId: conversa.id, kind: 'text', body: texto },
    });
    return conversa.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);

    // Um vendedor de verdade na loja A: é por ele que se confere o recorte de
    // carteira, que é a mesma regra do CSV de negócios.
    const vendedor = await dono.user.create({
      data: {
        tenantId: f.a.id, email: `vendedor-${Date.now()}@exemplo.test`,
        fullName: 'Vendedor da Carteira', role: 'salesperson', passwordHash: 'x',
        emailVerifiedAt: new Date(),
      },
    });
    vendedorId = vendedor.id;

    comoAdmin = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
    comoVendedor = jwt.sign({ sub: vendedorId, role: 'salesperson', tenantId: f.a.id });

    await semear(f.a.id, MARCA_A, vendedorId);
    await semear(f.a.id, MARCA_OUTRO_VENDEDOR, f.a.usuarioId);
    await semear(f.b.id, MARCA_B, null);
  }, 90_000);

  afterAll(async () => {
    await dono.message.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.conversation.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.user.deleteMany({ where: { id: vendedorId } });
    await f?.limpar();
    await app?.close();
  });

  const ROTAS = ['appointments.csv', 'conversations.csv', 'messages.csv'] as const;

  it.each(ROTAS)('%s: a loja A baixa o arquivo, com BOM e cabeçalho', async (rota) => {
    const res = await baixar(`/tenant/reports/${rota}`, comoAdmin);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    // Sem o BOM o Excel em português lê o arquivo como Latin-1.
    expect(res.text.startsWith('﻿')).toBe(true);
    expect(res.text.split('\n')[0]).toContain('"ID"');
  });

  it.each(ROTAS)('%s: nada da outra loja entra no arquivo', async (rota) => {
    const res = await baixar(`/tenant/reports/${rota}`, comoAdmin);
    expect(res.text).not.toContain(MARCA_B);
  });

  it('a conversa e a mensagem da loja A aparecem para o administrador dela', async () => {
    const conversas = await baixar('/tenant/reports/conversations.csv', comoAdmin);
    expect(conversas.text).toContain(`Cliente ${MARCA_A}`);
    expect(conversas.text).toContain(`Cliente ${MARCA_OUTRO_VENDEDOR}`);

    const mensagens = await baixar('/tenant/reports/messages.csv', comoAdmin);
    expect(mensagens.text).toContain(MARCA_A);
    expect(mensagens.text).toContain(MARCA_OUTRO_VENDEDOR);
  });

  it('o vendedor leva a carteira dele, não a da loja', async () => {
    // Mesma regra do CSV de negócios: carteira fechada vale também na saída.
    const conversas = await baixar('/tenant/reports/conversations.csv', comoVendedor);
    expect(conversas.status).toBe(200);
    expect(conversas.text).toContain(`Cliente ${MARCA_A}`);
    expect(conversas.text).not.toContain(`Cliente ${MARCA_OUTRO_VENDEDOR}`);

    const mensagens = await baixar('/tenant/reports/messages.csv', comoVendedor);
    expect(mensagens.text).toContain(MARCA_A);
    expect(mensagens.text).not.toContain(MARCA_OUTRO_VENDEDOR);
  });

  it('o agendamento que a fixture criou sai no CSV de agendamentos', async () => {
    const res = await baixar('/tenant/reports/appointments.csv?days=3660', comoAdmin);
    expect(res.text).toContain(f.a.agendamentoId);
    expect(res.text).not.toContain(f.b.agendamentoId);
  });

  it('período fora da faixa é 400, não uma varredura da base', async () => {
    expect((await baixar('/tenant/reports/messages.csv?days=99999', comoAdmin)).status).toBe(400);
    expect((await baixar('/tenant/reports/messages.csv?days=0', comoAdmin)).status).toBe(400);
  });

  it('cliente final não exporta nada', async () => {
    const comoCliente = jwt.sign({ sub: f.a.usuarioId, role: 'customer', tenantId: null });
    for (const rota of ROTAS) {
      expect((await baixar(`/tenant/reports/${rota}`, comoCliente)).status).toBe(403);
    }
  });
});
