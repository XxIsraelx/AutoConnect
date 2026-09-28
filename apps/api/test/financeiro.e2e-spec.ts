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
    // **Os períodos saem primeiro.** O trigger do mês fechado vale para `DELETE`
    // também — e é para valer: mês conferido não muda, e apagar linha dele
    // mudaria. Descoberto aqui, na limpeza: com os lançamentos primeiro, o
    // `afterAll` estourava, o `app.close()` nunca rodava e o jest ficava preso
    // ("did not exit one second after the test run"), o que parecia lentidão da
    // suíte e era erro de ordem no teste.
    await dono.financialPeriod.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.financialEntry.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.financialCategory.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.financialAccount.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    // Os negócios criados aqui saem antes da fixture: ela apaga veículos, e o
    // `deals_vehicle_id_fkey` é RESTRICT — sem isto, a limpeza da fixture
    // estoura e leva o `app.close()` junto.
    await dono.deal.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await dono.salespersonProfile.deleteMany({ where: { tenantId: f.a.id } });
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

  /**
   * Fase 3: o dinheiro que nasce do que a loja já fez.
   *
   * É a fase que faz valer a pena o financeiro estar aqui e não numa planilha, e
   * o que estes testes fixam é o par: **aparece** (senão a loja digita duas
   * vezes) e **não duplica** (senão o caixa mente para cima).
   */
  describe('lançamento gerado pela operação', () => {
    let veiculoId: string;

    beforeAll(async () => {
      veiculoId = f.a.veiculoPrivadoId;
    });

    it('a compra do veículo vira conta a pagar ao fornecedor', async () => {
      const res = await http()
        .post(`/api/v1/vehicles/${veiculoId}/acquisition`)
        .set('Authorization', `Bearer ${comoGerente}`)
        .send({
          origin: 'direct_purchase', supplierName: 'João Vendedor',
          purchaseValue: '45000.00', enteredAt: new Date().toISOString(),
        });
      expect(res.status).toBe(201);

      const gerado = await dono.financialEntry.findFirst({
        where: { tenantId: f.a.id, vehicleId: veiculoId, vehicleAcquisitionId: { not: null } },
        include: { category: true },
      });
      expect(gerado).not.toBeNull();
      expect(gerado!.direction).toBe('saida');
      expect(gerado!.value.toFixed(2)).toBe('45000.00');
      expect(gerado!.supplierName).toBe('João Vendedor');
      // A categoria é achada pela **chave**, não pelo nome: a loja renomeia.
      expect(gerado!.category.originKey).toBe('compra_de_veiculo');
    });

    it('corrigir a compra corrige o lançamento ainda previsto — e não cria um segundo', async () => {
      const res = await http()
        .post(`/api/v1/vehicles/${veiculoId}/acquisition`)
        .set('Authorization', `Bearer ${comoGerente}`)
        .send({
          origin: 'direct_purchase', supplierName: 'João Vendedor',
          purchaseValue: '44000.00', enteredAt: new Date().toISOString(),
        });
      expect(res.status).toBe(201);

      const todos = await dono.financialEntry.findMany({
        where: { tenantId: f.a.id, vehicleAcquisitionId: { not: null } },
      });
      // Idempotência por construção: a coluna é única, não há `if` para errar.
      expect(todos).toHaveLength(1);
      expect(todos[0]!.value.toFixed(2)).toBe('44000.00');
    });

    it('cada item de preparação vira uma conta a pagar', async () => {
      for (const [descricao, valor] of [['Funilaria', '1200.00'], ['Pneus', '800.00']] as const) {
        const res = await http()
          .post(`/api/v1/vehicles/${veiculoId}/costs`)
          .set('Authorization', `Bearer ${comoGerente}`)
          .send({
            kind: 'mechanical', value: valor, description: descricao,
            supplierName: 'Oficina Central', incurredAt: new Date().toISOString(),
          });
        expect(res.status).toBe(201);
      }

      const gerados = await dono.financialEntry.findMany({
        where: { tenantId: f.a.id, vehicleCostId: { not: null } },
        include: { category: true },
        orderBy: { value: 'desc' },
      });
      expect(gerados).toHaveLength(2);
      expect(gerados.map((g) => g.value.toFixed(2))).toEqual(['1200.00', '800.00']);
      expect(gerados[0]!.description).toBe('Funilaria');
      expect(gerados[0]!.category.originKey).toBe('preparacao');
    });

    it('a categoria é encontrada pela chave mesmo depois de a loja renomeá-la', async () => {
      // O caso que motivou a chave: buscar por nome pararia de achar em
      // silêncio, e o dinheiro não apareceria no caixa.
      const categoria = await dono.financialCategory.findFirstOrThrow({
        where: { tenantId: f.a.id, originKey: 'preparacao' },
      });
      await dono.financialCategory.update({
        where: { id: categoria.id }, data: { name: 'Oficina e funilaria (nosso nome)' },
      });

      const res = await http()
        .post(`/api/v1/vehicles/${veiculoId}/costs`)
        .set('Authorization', `Bearer ${comoGerente}`)
        .send({
          kind: 'preparation', value: '150.00', description: 'Higienização',
          incurredAt: new Date().toISOString(),
        });
      expect(res.status).toBe(201);

      const gerado = await dono.financialEntry.findFirstOrThrow({
        where: { tenantId: f.a.id, description: 'Higienização' },
        include: { category: true },
      });
      expect(gerado.categoryId).toBe(categoria.id);
      expect(gerado.category.name).toBe('Oficina e funilaria (nosso nome)');
    });

    it('a soma das contas a pagar do veículo bate com o custo que o negócio usa', async () => {
      // Sem dupla contagem: o financeiro aponta para a origem, e o total das
      // contas a pagar geradas é o mesmo custo que a margem do negócio congela.
      const entradas = await dono.financialEntry.findMany({
        where: {
          tenantId: f.a.id, vehicleId: veiculoId, direction: 'saida',
          OR: [{ vehicleCostId: { not: null } }, { vehicleAcquisitionId: { not: null } }],
        },
        select: { value: true },
      });
      const total = entradas.reduce((t, e) => t + Number(e.value), 0);
      // 44.000 de compra + 1.200 + 800 + 150 de preparação.
      expect(total.toFixed(2)).toBe('46150.00');
    });
  });

  /**
   * Fase 4: as duas perguntas que nenhuma outra tela responde.
   *
   * "Em que dia o caixa fica negativo" e "quanto sobrou no mês". A segunda é a
   * mais delicada do módulo: somar o custo do veículo **e** as contas a pagar da
   * compra contaria o carro duas vezes.
   */
  describe('fluxo de caixa e DRE', () => {
    it('o fluxo projeta o saldo dia a dia e aponta o dia em que ele vira', async () => {
      const res = await get('/fluxo?dias=30');

      expect(res.status).toBe(200);
      expect(res.body.serie).toHaveLength(31);
      expect(res.body.serie[0].dia).toBe(new Date().toISOString().slice(0, 10));
      // O saldo de hoje é o mesmo do resumo — uma definição só de saldo.
      const resumo = await get('/resumo');
      expect(res.body.saldoHoje).toBe(resumo.body.saldoTotal);
    });

    it('uma conta a pagar grande no futuro faz o caixa virar, e o fluxo diz quando', async () => {
      const daquiATresDias = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
      const antes = await get('/fluxo?dias=30');
      const res = await post('/lancamentos', {
        categoryId: categoriaSaida, value: '900000.00', dueDate: daquiATresDias,
        description: 'Compra de frota (teste de fluxo)',
      });
      expect(res.status).toBe(201);

      const depois = await get('/fluxo?dias=30');
      const noVencimento = (depois.body.serie as { dia: string; saidas: string }[])
        .find((d) => d.dia === daquiATresDias)!;
      expect(Number(noVencimento.saidas)).toBeGreaterThanOrEqual(900000);
      // O caixa vira em algum dia da janela — qual, depende do que a loja já
      // tinha; o que se fixa aqui é que o fluxo **aponta** um dia.
      expect(depois.body.primeiroDiaNegativo).not.toBeNull();

      const saldoFinal = (serie: { saldo: string }[]) => Number(serie[serie.length - 1]!.saldo);
      expect(saldoFinal(antes.body.serie) - saldoFinal(depois.body.serie)).toBeCloseTo(900000, 2);

      // E volta quando o lançamento sai: o fluxo lê o estado, não guarda nada.
      await post(`/lancamentos/${res.body.lancamentos[0].id}/cancelar`, { motivo: 'teste' });
      const voltou = await get('/fluxo?dias=30');
      expect(saldoFinal(voltou.body.serie)).toBeCloseTo(saldoFinal(antes.body.serie), 2);
    });

    it('janela fora da faixa é 400 — projeção de um ano seria mentira', async () => {
      expect((await get('/fluxo?dias=400')).status).toBe(400);
      expect((await get('/fluxo?dias=1')).status).toBe(400);
    });

    it('o DRE usa o custo que o negócio congelou, e não conta o carro duas vezes', async () => {
      const agora = new Date();
      const ano = agora.getUTCFullYear();
      const mes = agora.getUTCMonth() + 1;

      // Um negócio faturado no mês: 80.000 de venda, 71.000 de custo.
      const carro = await dono.vehicle.findFirstOrThrow({
        where: { tenantId: f.a.id, id: f.a.veiculoPublicoId },
      });
      await dono.deal.create({
        data: {
          tenantId: f.a.id, vehicleId: carro.id, status: 'invoiced',
          listPrice: '85000.00', discount: '5000.00', saleValue: '80000.00',
          vehicleCostSnapshot: '71000.00', grossMargin: '9000.00',
          closedAt: new Date(Date.UTC(ano, mes - 1, 15)),
        },
      });

      const res = await get(`/dre?year=${ano}&month=${mes}`);
      expect(res.status).toBe(200);
      expect(res.body.receitaDeVeiculos).toBe('80000.00');
      expect(res.body.custoDosVeiculosVendidos).toBe('71000.00');
      expect(res.body.margemBruta).toBe('9000.00');

      // As contas a pagar da compra e da preparação **não** entram como despesa:
      // elas são o caixa do mesmo carro que já está no CMV.
      const grupos = (res.body.despesasPorGrupo as { grupo: string }[]).map((g) => g.grupo);
      expect(grupos).not.toContain('veiculos');
    });

    it('despesa de operação paga no mês entra no resultado', async () => {
      const agora = new Date();
      const ano = agora.getUTCFullYear();
      const mes = agora.getUTCMonth() + 1;

      const operacao = (await get('/categorias')).body as { id: string; name: string; direction: string }[];
      const aluguel = operacao.find((c) => c.name === 'Aluguel' && c.direction === 'saida')!;

      const criado = await post('/lancamentos', {
        categoryId: aluguel.id, value: '4000.00',
        dueDate: new Date().toISOString().slice(0, 10), description: 'Aluguel do mês',
        accountId: contaId, paidAt: new Date().toISOString().slice(0, 10),
      });
      expect(criado.status).toBe(201);

      const res = await get(`/dre?year=${ano}&month=${mes}`);
      const operacional = (res.body.despesasPorGrupo as { grupo: string; valor: string }[])
        .find((g) => g.grupo === 'operacao');
      expect(Number(operacional?.valor)).toBeGreaterThanOrEqual(4000);
    });
  });

  describe('fechamento apura a comissão', () => {
    it('fechar o mês gera a conta a pagar da comissão, e refechar não duplica', async () => {
      const agora = new Date();
      // Um mês que nenhum outro teste fecha, e no passado.
      const ano = agora.getUTCFullYear();
      const mes = agora.getUTCMonth() === 0 ? 12 : agora.getUTCMonth();
      const anoDoMes = agora.getUTCMonth() === 0 ? ano - 1 : ano;

      const vendedor = await dono.user.create({
        data: {
          tenantId: f.a.id, email: `comissionado-${Date.now()}@exemplo.test`,
          fullName: 'Vendedor Comissionado', role: 'salesperson', passwordHash: 'x',
        },
      });
      await dono.salespersonProfile.create({
        data: { userId: vendedor.id, tenantId: f.a.id, commissionPct: '2.00' },
      });
      await dono.deal.create({
        data: {
          tenantId: f.a.id, vehicleId: f.a.veiculoPrivadoId, status: 'invoiced',
          salespersonId: vendedor.id,
          listPrice: '50000.00', discount: '0', saleValue: '50000.00',
          vehicleCostSnapshot: '40000.00', grossMargin: '10000.00',
          closedAt: new Date(Date.UTC(anoDoMes, mes - 1, 10)),
        },
      });

      const fechou = await post('/periodos/fechar', { year: anoDoMes, month: mes });
      expect(fechou.status).toBe(201);
      expect(fechou.body.comissoesGeradas).toBe(1);

      // 2% de 50.000 = 1.000 — a mesma conta de /equipe e /relatorios.
      const comissao = await dono.financialEntry.findFirstOrThrow({
        where: { tenantId: f.a.id, documentNumber: { startsWith: 'comissao:' } },
      });
      expect(comissao.value.toFixed(2)).toBe('1000.00');
      // Vence no mês seguinte: nasceria travada se vencesse no mês que fechou.
      expect(comissao.dueDate.getUTCDate()).toBe(5);

      // Reabrir e fechar de novo não cria a segunda.
      await post('/periodos/reabrir', { year: anoDoMes, month: mes, motivo: 'conferência' });
      const segundo = await post('/periodos/fechar', { year: anoDoMes, month: mes });
      expect(segundo.body.comissoesGeradas).toBe(0);
      expect(await dono.financialEntry.count({
        where: { tenantId: f.a.id, documentNumber: { startsWith: 'comissao:' } },
      })).toBe(1);
    });

    it('fechar e reabrir deixam rastro na auditoria', async () => {
      const acoes = await dono.auditLog.findMany({
        where: { tenantId: f.a.id, entityType: 'financial_period' },
        select: { action: true },
      });
      expect(acoes.map((a) => a.action)).toEqual(
        expect.arrayContaining(['financial_period_closed', 'financial_period_reopened']),
      );
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
