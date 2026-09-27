import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';
import { saldoDaConta, type LancamentoParaRegra } from '@autoconnect/shared';

/**
 * Financeiro gerencial — Fase 1.
 *
 * O que este arquivo fixa não é a tela: é que **o dinheiro fecha** e que ele não
 * atravessa a parede entre duas lojas. Nesta ordem de importância:
 *
 *  1. o saldo da API é o mesmo que a regra do shared calcula sobre as mesmas
 *     linhas — duas definições de saldo é a forma mais rápida de o lojista
 *     perder a confiança no número;
 *  2. nada da loja B aparece no financeiro da A;
 *  3. o vendedor não vê o caixa;
 *  4. mês fechado é fechado, com mensagem em português e não erro de driver.
 */
describe('Financeiro da loja (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let jwt: JwtService;
  let f: DoisTenants;
  let comoGerente: string;
  let comoVendedor: string;
  let comoOutraLoja: string;
  let contaId: string;
  let categoriaEntrada: string;
  let categoriaSaida: string;

  const http = () => request(app.getHttpServer());
  const rota = (c: string) => `/api/v1/financeiro${c}`;
  const get = (c: string, token = comoGerente) =>
    http().get(rota(c)).set('Authorization', `Bearer ${token}`);
  const post = (c: string, body: object, token = comoGerente) =>
    http().post(rota(c)).set('Authorization', `Bearer ${token}`).send(body);
  const patch = (c: string, body: object, token = comoGerente) =>
    http().patch(rota(c)).set('Authorization', `Bearer ${token}`).send(body);

  /** Data no futuro, em mês que nenhum teste fecha. */
  const emDias = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);

    const vendedor = await dono.user.create({
      data: {
        tenantId: f.a.id, email: `vend-fin-${Date.now()}@exemplo.test`,
        fullName: 'Vendedor sem caixa', role: 'salesperson', passwordHash: 'x',
      },
    });

    comoGerente = jwt.sign({ sub: f.a.usuarioId, role: 'manager', tenantId: f.a.id });
    comoVendedor = jwt.sign({ sub: vendedor.id, role: 'salesperson', tenantId: f.a.id });
    comoOutraLoja = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });
  }, 90_000);

  afterAll(async () => {
    await dono.financialEntry.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.financialPeriod.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.financialCategory.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.financialAccount.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.user.deleteMany({ where: { tenantId: f.a.id, role: 'salesperson' } });
    await f?.limpar();
    await app?.close();
  });

  describe('plano de contas e conta', () => {
    it('a loja começa sem categoria, e o resumo diz isso em vez de abrir vazio', async () => {
      const res = await get('/resumo');
      expect(res.status).toBe(200);
      expect(res.body.temCategorias).toBe(false);
      expect(res.body.saldoTotal).toBe('0.00');
    });

    it('semear o plano de contas é idempotente — o lojista clica duas vezes', async () => {
      const primeira = await post('/categorias/padrao', {});
      expect(primeira.status).toBe(201);
      expect(primeira.body.criadas).toBeGreaterThan(10);

      const segunda = await post('/categorias/padrao', {});
      expect(segunda.body.criadas).toBe(0);

      const lista = await get('/categorias');
      const entradas = (lista.body as { direction: string; id: string; name: string }[])
        .filter((c) => c.direction === 'entrada');
      const saidas = (lista.body as { direction: string; id: string; name: string }[])
        .filter((c) => c.direction === 'saida');
      expect(entradas.length).toBeGreaterThan(2);
      expect(saidas.length).toBeGreaterThan(5);

      categoriaEntrada = entradas.find((c) => c.name === 'Venda de veículo')!.id;
      categoriaSaida = saidas.find((c) => c.name === 'Compra de veículo')!.id;
    });

    it('a conta nasce com o saldo inicial que a loja informou', async () => {
      const res = await post('/contas', {
        kind: 'banco', name: 'Banco do Brasil', bankName: 'BB', openingBalance: '15000.00',
      });
      expect(res.status).toBe(201);
      expect(res.body.openingBalance).toBe('15000.00');
      expect(res.body.saldo).toBe('15000.00');
      contaId = res.body.id;
    });

    it('conta com nome repetido é 409, não uma segunda conta igual', async () => {
      const res = await post('/contas', { kind: 'caixa', name: 'Banco do Brasil' });
      expect(res.status).toBe(409);
    });

    it('dinheiro entra na forma canônica; o resto é 400', async () => {
      const corpo = (value: string) => ({
        categoryId: categoriaSaida, value, dueDate: emDias(5), description: 'Teste de valor',
      });
      expect((await post('/lancamentos', corpo('1234.56'))).status).toBe(201);
      // Formato de tela (milhar e vírgula) não é contrato de API: quem
      // desformata é a tela, como já faz o preço do negócio. Dois formatos na
      // API seria a próxima divergência esperando acontecer.
      expect((await post('/lancamentos', corpo('1.234,56'))).status).toBe(400);
      expect((await post('/lancamentos', corpo('-100.00'))).status).toBe(400);
      expect((await post('/lancamentos', corpo('abc'))).status).toBe(400);
      // Campo a mais no corpo é erro do chamador, não silêncio.
      expect((await post('/lancamentos', { ...corpo('10.00'), status: 'pago' })).status).toBe(400);
    });
  });

  describe('o saldo fecha', () => {
    it('saldo da API é o mesmo que a regra do shared dá sobre as mesmas linhas', async () => {
      // Uma venda recebida e uma compra paga, mais uma promessa que não conta.
      const lancar = async (categoryId: string, value: string, paid: boolean) => {
        const res = await post('/lancamentos', {
          categoryId, value, dueDate: emDias(1), description: 'Conferência de saldo',
          ...(paid ? { accountId: contaId, paidAt: emDias(0) } : {}),
        });
        expect(res.status).toBe(201);
        return res.body.lancamentos[0];
      };

      await lancar(categoriaEntrada, '80000.00', true);
      await lancar(categoriaSaida, '71000.50', true);
      await lancar(categoriaSaida, '5000.00', false);

      const doBanco = await dono.financialEntry.findMany({
        where: { tenantId: f.a.id, accountId: contaId },
        select: { direction: true, status: true, value: true, dueDate: true, paidAt: true },
      });
      const paraRegra: LancamentoParaRegra[] = doBanco.map((e) => ({
        direction: e.direction as 'entrada' | 'saida',
        status: e.status as 'previsto' | 'pago' | 'cancelado',
        value: e.value.toFixed(2),
        dueDate: e.dueDate,
        paidAt: e.paidAt,
      }));

      const contas = await get('/contas');
      const conta = (contas.body as { id: string; saldo: string }[]).find((c) => c.id === contaId)!;

      // 15.000,00 de saldo inicial + 80.000,00 − 71.000,50 = 23.999,50
      expect(conta.saldo).toBe('23999.50');
      expect(conta.saldo).toBe(saldoDaConta('15000.00', paraRegra));
    });

    it('o resumo separa o que é saldo do que é promessa', async () => {
      const res = await get('/resumo');
      expect(res.body.saldoTotal).toBe('23999.50');
      // A promessa de 5.000,00 aparece como a pagar, não como saldo.
      expect(res.body.proximos7Dias.aPagar).not.toBe('0.00');
      expect(res.body.mesCorrente.recebido).toBe('80000.00');
      expect(res.body.mesCorrente.resultado).toBe('8999.50');
    });

    it('a lista soma o filtro inteiro, não a página', async () => {
      const res = await get('/lancamentos?perPage=1');
      expect(res.body.itens).toHaveLength(1);
      expect(res.body.total).toBeGreaterThan(1);
      expect(res.body.somaEntradas).toBe('80000.00');
    });
  });

  describe('baixa e cancelamento', () => {
    let pendente: string;

    beforeAll(async () => {
      const res = await post('/lancamentos', {
        categoryId: categoriaSaida, value: '900.00', dueDate: emDias(3),
        description: 'Preparação do Onix', supplierName: 'Funilaria Silva',
      });
      pendente = res.body.lancamentos[0].id;
    });

    it('baixa é idempotente: dois cliques não viram dois pagamentos', async () => {
      const primeira = await post(`/lancamentos/${pendente}/baixa`, { accountId: contaId });
      expect(primeira.status).toBe(201);
      expect(primeira.body.status).toBe('pago');
      const pagoEm = primeira.body.paidAt;

      const segunda = await post(`/lancamentos/${pendente}/baixa`, { accountId: contaId });
      expect(segunda.body.paidAt).toBe(pagoEm);
    });

    it('cancelado exige motivo, não recebe baixa e não volta atrás', async () => {
      const res = await post('/lancamentos', {
        categoryId: categoriaSaida, value: '50.00', dueDate: emDias(4), description: 'Lançado por engano',
      });
      const id = res.body.lancamentos[0].id;

      expect((await post(`/lancamentos/${id}/cancelar`, {})).status).toBe(400);

      const cancelado = await post(`/lancamentos/${id}/cancelar`, { motivo: 'digitei duas vezes' });
      expect(cancelado.status).toBe(201);
      expect(cancelado.body.status).toBe('cancelado');
      expect(cancelado.body.cancelReason).toBe('digitei duas vezes');

      expect((await post(`/lancamentos/${id}/baixa`, { accountId: contaId })).status).toBe(409);
      expect((await patch(`/lancamentos/${id}`, { value: '10.00' })).status).toBe(409);

      // E não entra no saldo.
      const contas = await get('/contas');
      const conta = (contas.body as { id: string; saldo: string }[]).find((c) => c.id === contaId)!;
      expect(conta.saldo).toBe('23099.50');
    });
  });

  describe('repetição', () => {
    it('12 meses viram 12 lançamentos com a mesma série, e só o primeiro nasce pago', async () => {
      const res = await post('/lancamentos', {
        categoryId: categoriaSaida, value: '3500.00', dueDate: emDias(2),
        description: 'Aluguel', repetirMeses: 12, accountId: contaId, paidAt: emDias(0),
      });

      expect(res.status).toBe(201);
      expect(res.body.criados).toBe(12);
      expect(res.body.recurrenceId).not.toBeNull();

      const pagos = (res.body.lancamentos as { status: string }[]).filter((l) => l.status === 'pago');
      expect(pagos).toHaveLength(1);
    });

    it('repetição fora da faixa é 400 — série infinita não existe', async () => {
      const corpo = { categoryId: categoriaSaida, value: '10.00', dueDate: emDias(2), description: 'x' };
      expect((await post('/lancamentos', { ...corpo, repetirMeses: 500 })).status).toBe(400);
      expect((await post('/lancamentos', { ...corpo, repetirMeses: 1 })).status).toBe(400);
    });
  });

  describe('mês fechado', () => {
    const mesPassado = () => {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() - 1);
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, dia: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15)) };
    };

    it('fechar o mês diz quantos lançamentos ficaram pendentes nele', async () => {
      const { year, month, dia } = mesPassado();
      await post('/lancamentos', {
        categoryId: categoriaSaida, value: '77.00',
        dueDate: dia.toISOString().slice(0, 10), description: 'Do mês passado, sem baixa',
      });

      const res = await post('/periodos/fechar', { year, month });
      expect(res.status).toBe(201);
      expect(res.body.pendentesNoMes).toBeGreaterThanOrEqual(1);
    });

    it('lançamento com vencimento em mês fechado é 409 em português, não erro de driver', async () => {
      const { year, month, dia } = mesPassado();
      const res = await post('/lancamentos', {
        categoryId: categoriaSaida, value: '10.00',
        dueDate: dia.toISOString().slice(0, 10), description: 'Tarde demais',
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain(`${String(month).padStart(2, '0')}/${year}`);
      expect(res.body.message).toContain('Reabra');
    });

    it('fechar duas vezes é 409, e reabrir exige motivo', async () => {
      const { year, month } = mesPassado();
      expect((await post('/periodos/fechar', { year, month })).status).toBe(409);
      expect((await post('/periodos/reabrir', { year, month })).status).toBe(400);

      const reaberto = await post('/periodos/reabrir', { year, month, motivo: 'faltou uma nota' });
      expect(reaberto.status).toBe(201);

      // Reaberto, o lançamento do mês entra.
      const d = new Date(Date.UTC(year, month - 1, 15));
      const res = await post('/lancamentos', {
        categoryId: categoriaSaida, value: '10.00',
        dueDate: d.toISOString().slice(0, 10), description: 'A nota que faltava',
      });
      expect(res.status).toBe(201);
    });
  });

  describe('quem não entra', () => {
    it('o vendedor não vê o caixa da loja', async () => {
      for (const caminho of ['/resumo', '/contas', '/lancamentos', '/categorias']) {
        expect((await get(caminho, comoVendedor)).status).toBe(403);
      }
      expect((await post('/contas', { kind: 'caixa', name: 'x' }, comoVendedor)).status).toBe(403);
    });

    it('a loja vizinha não vê conta, categoria nem lançamento desta', async () => {
      const contas = await get('/contas', comoOutraLoja);
      expect(contas.status).toBe(200);
      expect(contas.body).toHaveLength(0);

      const lancamentos = await get('/lancamentos', comoOutraLoja);
      expect(lancamentos.body.total).toBe(0);

      const resumo = await get('/resumo', comoOutraLoja);
      expect(resumo.body.saldoTotal).toBe('0.00');
      expect(resumo.body.temCategorias).toBe(false);
    });

    it('e não dá baixa no lançamento da outra — 404, nunca 200', async () => {
      const meus = await get('/lancamentos?perPage=1');
      const id = meus.body.itens[0].id;
      expect((await post(`/lancamentos/${id}/baixa`, { accountId: contaId }, comoOutraLoja)).status).toBe(404);
    });
  });
});
