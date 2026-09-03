import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { ConsultasService } from '../src/modules/consultas/consultas.service';
import { FORNECEDOR_DE_CONSULTA, FornecedorSimulado, FornecedorIndisponivel } from '../src/modules/consultas/fornecedor';
import { criarDoisTenants, comoApp, type DoisTenants } from './helpers/tenant-fixture';
import type { EntradaConsulta, FornecedorDeConsulta, ResultadoConsulta, TipoConsulta } from '@autoconnect/shared';

/**
 * Consulta veicular: cache, idempotência e custo.
 *
 * O que se protege aqui é dinheiro. Cada chamada ao fornecedor é cobrada, e um
 * cache que não pega ou uma idempotência frouxa não aparecem como erro —
 * aparecem na fatura no fim do mês.
 */
describe('Consultas veiculares (e2e)', () => {
  let prisma: PrismaService;
  let dono: PrivilegedPrismaService;
  let servico: ConsultasService;
  let f: DoisTenants;

  /** Fornecedor que conta as chamadas: é como se prova que o cache pegou. */
  class Contador implements FornecedorDeConsulta {
    readonly nome = 'contador';
    readonly custoCentavos = 250;
    readonly tiposSuportados: readonly TipoConsulta[] = ['debts', 'theft', 'auction'];
    chamadas = 0;
    falhar = false;

    consultar(entrada: EntradaConsulta, tipo: TipoConsulta) {
      this.chamadas += 1;
      if (this.falhar) return Promise.reject(new Error('fornecedor fora do ar'));
      const resultado: ResultadoConsulta = { tipo, alerta: false, resumo: 'nada encontrado' };
      return Promise.resolve({ cru: { ok: true, entrada }, resultado });
    }
  }

  const fornecedor = new Contador();
  const escopoA = () => ({ tipo: 'tenant' as const, tenantId: f.a.id });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService, PrivilegedPrismaService, ConsultasService,
        { provide: FORNECEDOR_DE_CONSULTA, useValue: fornecedor },
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    dono = moduleRef.get(PrivilegedPrismaService);
    servico = moduleRef.get(ConsultasService);
    await Promise.all([prisma.$connect(), dono.$connect()]);
    f = await criarDoisTenants(dono);
  }, 60_000);

  beforeEach(() => { fornecedor.chamadas = 0; fornecedor.falhar = false; });

  afterEach(async () => {
    await dono.$executeRaw`
      DELETE FROM vehicle_queries WHERE tenant_id IN (${f.a.id}::uuid, ${f.b.id}::uuid)`;
  });

  afterAll(async () => {
    await f?.limpar();
    await Promise.all([prisma?.$disconnect(), dono?.$disconnect()]);
  });

  describe('cache — o que evita pagar duas vezes', () => {
    it('a primeira consulta vai ao fornecedor', async () => {
      const r = await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts');

      expect(fornecedor.chamadas).toBe(1);
      expect(r.status).toBe('success');
      expect(r.doCache).toBe(false);
    });

    it('a segunda, dentro da validade, NÃO vai', async () => {
      await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts');
      const r = await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts');

      expect(fornecedor.chamadas).toBe(1);
      expect(r.doCache).toBe(true);
    });

    it('a placa é normalizada antes de bater no cache', async () => {
      await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts');
      // A loja digita com hífen e minúscula; seria absurdo pagar de novo.
      const r = await servico.consultar(escopoA(), { placa: 'abc-1d23' }, 'debts');

      expect(fornecedor.chamadas).toBe(1);
      expect(r.doCache).toBe(true);
    });

    it('tipo diferente é consulta diferente', async () => {
      await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts');
      await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'theft');

      expect(fornecedor.chamadas).toBe(2);
    });

    it('cache vencido volta a consultar', async () => {
      await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts');
      await dono.$executeRaw`
        UPDATE vehicle_queries SET expires_at = now() - interval '1 hour',
               idempotency_key = idempotency_key || '-antiga'
         WHERE tenant_id = ${f.a.id}::uuid`;

      await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts');

      expect(fornecedor.chamadas).toBe(2);
    });

    it('outra concessionária não aproveita o cache da primeira', async () => {
      // Cache compartilhado seria mais barato e revelaria que a concorrente
      // consultou aquela placa.
      await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts');
      await servico.consultar({ tipo: 'tenant', tenantId: f.b.id }, { placa: 'ABC1D23' }, 'debts');

      expect(fornecedor.chamadas).toBe(2);
    });
  });

  describe('custo', () => {
    it('a chamada registra o custo do fornecedor', async () => {
      const r = await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts');

      expect(r.costCents).toBe(250);
      expect(r.provider).toBe('contador');
    });

    it('a falha também registra custo — o fornecedor cobra a tentativa', async () => {
      fornecedor.falhar = true;

      await expect(
        servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts'),
      ).rejects.toThrow(/fora do ar/);

      const [q] = await dono.$queryRaw<{ status: string; cost_cents: number }[]>`
        SELECT status::text, cost_cents FROM vehicle_queries WHERE tenant_id = ${f.a.id}::uuid`;
      expect(q).toMatchObject({ status: 'failed', cost_cents: 250 });
    });

    it('o relatório soma o gasto por tipo', async () => {
      await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts');
      await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'theft');

      const g = await servico.gastoDoPeriodo(
        escopoA(), new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000),
      );

      expect(g).toMatchObject({ totalCentavos: 500, chamadas: 2, falhas: 0 });
      expect(g.porTipo).toHaveLength(2);
    });
  });

  describe('idempotência', () => {
    it('depois de falhar, o mesmo pedido no mesmo dia não cobra de novo', async () => {
      fornecedor.falhar = true;
      await expect(servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts')).rejects.toThrow();

      fornecedor.falhar = false;
      const r = await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts');

      // Devolve o registro do dia, sem nova chamada: clique duplo em consulta
      // que falhou não pode virar cobrança dobrada.
      expect(fornecedor.chamadas).toBe(1);
      expect(r.doCache).toBe(true);
      expect(r.status).toBe('failed');
    });
  });

  describe('validação da entrada — antes de gastar', () => {
    it.each([
      ['placa curta', { placa: 'ABC12' }],
      ['placa com formato errado', { placa: 'AB1C234' }],
      ['chassi com I proibido', { chassi: '9BWZZZ377VT00425I' }],
      ['sem placa nem chassi', {}],
    ])('recusa %s sem chamar o fornecedor', async (_r, entrada) => {
      await expect(servico.consultar(escopoA(), entrada, 'debts')).rejects.toThrow();
      expect(fornecedor.chamadas).toBe(0);
    });
  });

  describe('isolamento', () => {
    it('a consulta da A é invisível para a B', async () => {
      await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts');

      const linhas = (await comoApp(prisma, { tenantId: f.b.id }, (tx) =>
        tx.$queryRawUnsafe('SELECT count(*)::int AS total FROM vehicle_queries'),
      )) as { total: number }[];

      expect(linhas[0].total).toBe(0);
    });
  });

  describe('selo de procedência', () => {
    it('consulta sem alerta vira selo na vitrine', async () => {
      await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'theft', f.a.veiculoPublicoId);

      const selo = await servico.seloPublico(f.a.veiculoPublicoId);

      expect(selo).toEqual([{ tipo: 'theft', rotulo: 'Registro de roubo ou furto' }]);
    });

    it('consulta que falhou NÃO vira selo', async () => {
      // Afirmar "sem registro de roubo" a partir de consulta que não aconteceu
      // é informação falsa na vitrine.
      fornecedor.falhar = true;
      await expect(
        servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'theft', f.a.veiculoPublicoId),
      ).rejects.toThrow();

      expect(await servico.seloPublico(f.a.veiculoPublicoId)).toEqual([]);
    });

    it('consulta com alerta não vira selo', async () => {
      await servico.consultar(escopoA(), { placa: 'ABC1D23' }, 'debts', f.a.veiculoPublicoId);
      await dono.$executeRaw`
        UPDATE vehicle_queries SET result = '{"tipo":"debts","alerta":true,"resumo":"x"}'::jsonb
         WHERE tenant_id = ${f.a.id}::uuid`;

      expect(await servico.seloPublico(f.a.veiculoPublicoId)).toEqual([]);
    });

    it('veículo fora da vitrine não tem selo', async () => {
      await expect(servico.seloPublico(f.a.veiculoPrivadoId)).rejects.toThrow(/não encontrado/);
    });
  });

  describe('fornecedores', () => {
    it('sem contrato, a consulta falha alto em vez de mentir', async () => {
      // Devolver "nada encontrado" viraria selo afirmando carro limpo com base
      // em consulta que nunca aconteceu.
      await expect(
        new FornecedorIndisponivel().consultar(),
      ).rejects.toThrow(/depende de contrato/);
    });

    it('o simulado é determinístico — a mesma placa dá o mesmo resultado', async () => {
      const s = new FornecedorSimulado();
      const a = await s.consultar({ placa: 'ABC1D23' }, 'debts');
      const b = await s.consultar({ placa: 'ABC1D23' }, 'debts');

      expect(a.resultado).toEqual(b.resultado);
    });
  });
});
