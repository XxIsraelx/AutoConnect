import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, comoApp, type DoisTenants } from './helpers/tenant-fixture';

/**
 * As garantias do negócio que precisam morar no banco, não no service.
 *
 * A regra "um veículo não pode ter dois negócios vivos" é o caso clássico em
 * que a checagem na aplicação não basta: entre o SELECT que confere e o INSERT
 * que grava cabe outra transação, e o resultado é o mesmo carro vendido duas
 * vezes — descoberto só na entrega. Por isso é índice único parcial, e por
 * isso este teste exercita o banco de verdade.
 */
describe('Deal — invariantes garantidas pelo banco (e2e)', () => {
  let prisma: PrismaService;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;

  const criarNegocio = (tenantId: string, veiculoId: string, valor = 95000) =>
    dono.$executeRaw`
      INSERT INTO deals (tenant_id, vehicle_id, list_price, sale_value, updated_at)
      VALUES (${tenantId}::uuid, ${veiculoId}::uuid, 100000, ${valor}, now())`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, PrivilegedPrismaService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    dono = moduleRef.get(PrivilegedPrismaService);
    await Promise.all([prisma.$connect(), dono.$connect()]);
    f = await criarDoisTenants(dono);
  }, 60_000);

  afterEach(async () => {
    // Os negócios referenciam os veículos da fixture; sair sem limpá-los faria
    // o `limpar()` falhar por chave estrangeira e mascarar o resultado.
    await dono.$executeRaw`
      DELETE FROM deals WHERE tenant_id IN (${f.a.id}::uuid, ${f.b.id}::uuid)`;
  });

  afterAll(async () => {
    await f?.limpar();
    await Promise.all([prisma?.$disconnect(), dono?.$disconnect()]);
  });

  describe('um veículo, um negócio vivo', () => {
    it('o primeiro negócio entra', async () => {
      await expect(criarNegocio(f.a.id, f.a.veiculoPublicoId)).resolves.toBe(1);
    });

    it('o segundo negócio no mesmo veículo é recusado pelo banco', async () => {
      await criarNegocio(f.a.id, f.a.veiculoPublicoId);

      // 23505 = unique_violation. Assertar sobre o código e a coluna prova que
      // a recusa veio da unicidade do veículo, e não de outra restrição.
      await expect(criarNegocio(f.a.id, f.a.veiculoPublicoId, 93000)).rejects.toThrow(
        /23505[\s\S]*vehicle_id/,
      );
    });

    it('cancelar libera o veículo para um negócio novo', async () => {
      await criarNegocio(f.a.id, f.a.veiculoPublicoId);
      await dono.$executeRaw`UPDATE deals SET status = 'canceled' WHERE tenant_id = ${f.a.id}::uuid`;

      await expect(criarNegocio(f.a.id, f.a.veiculoPublicoId, 93000)).resolves.toBe(1);
    });

    it('distratar também libera — o carro volta ao estoque', async () => {
      await criarNegocio(f.a.id, f.a.veiculoPublicoId);
      await dono.$executeRaw`UPDATE deals SET status = 'rescinded' WHERE tenant_id = ${f.a.id}::uuid`;

      await expect(criarNegocio(f.a.id, f.a.veiculoPublicoId, 93000)).resolves.toBe(1);
    });

    it('entregue NÃO libera: o carro já saiu, vendê-lo de novo é o bug', async () => {
      await criarNegocio(f.a.id, f.a.veiculoPublicoId);
      await dono.$executeRaw`UPDATE deals SET status = 'delivered' WHERE tenant_id = ${f.a.id}::uuid`;

      // 23505 = unique_violation. Assertar sobre o código e a coluna prova que
      // a recusa veio da unicidade do veículo, e não de outra restrição.
      await expect(criarNegocio(f.a.id, f.a.veiculoPublicoId, 93000)).rejects.toThrow(
        /23505[\s\S]*vehicle_id/,
      );
    });

    it('veículos diferentes convivem', async () => {
      await criarNegocio(f.a.id, f.a.veiculoPublicoId);

      await expect(criarNegocio(f.a.id, f.a.veiculoPrivadoId)).resolves.toBe(1);
    });
  });

  describe('isolamento entre concessionárias', () => {
    it('o negócio da B é invisível para a A', async () => {
      await criarNegocio(f.b.id, f.b.veiculoPublicoId);

      const linhas = (await comoApp(prisma, { tenantId: f.a.id }, (tx) =>
        tx.$queryRawUnsafe('SELECT count(*)::int AS total FROM deals'),
      )) as { total: number }[];

      expect(linhas[0].total).toBe(0);
    });

    it('sem contexto de tenant não se enxerga negócio nenhum', async () => {
      await criarNegocio(f.a.id, f.a.veiculoPublicoId);
      await criarNegocio(f.b.id, f.b.veiculoPublicoId);

      const linhas = (await comoApp(prisma, {}, (tx) =>
        tx.$queryRawUnsafe('SELECT count(*)::int AS total FROM deals'),
      )) as { total: number }[];

      // Esquecer o contexto fecha tudo, não abre tudo.
      expect(linhas[0].total).toBe(0);
    });

    it('a A enxerga o próprio negócio', async () => {
      await criarNegocio(f.a.id, f.a.veiculoPublicoId);

      const linhas = (await comoApp(prisma, { tenantId: f.a.id }, (tx) =>
        tx.$queryRawUnsafe('SELECT count(*)::int AS total FROM deals'),
      )) as { total: number }[];

      expect(linhas[0].total).toBe(1);
    });
  });

  describe('dinheiro sobrevive à ida e volta como Decimal', () => {
    it('centavo não some no armazenamento', async () => {
      await dono.$executeRaw`
        INSERT INTO deals (tenant_id, vehicle_id, list_price, discount, sale_value, updated_at)
        VALUES (${f.a.id}::uuid, ${f.a.veiculoPublicoId}::uuid, 85000.01, 0.02, 84999.99, now())`;

      const linhas = (await dono.$queryRaw`
        SELECT list_price::text AS lista, discount::text AS desconto, sale_value::text AS venda
        FROM deals WHERE tenant_id = ${f.a.id}::uuid`) as {
        lista: string; desconto: string; venda: string;
      }[];

      expect(linhas[0]).toEqual({
        lista: '85000.01',
        desconto: '0.02',
        venda: '84999.99',
      });
    });
  });
});
