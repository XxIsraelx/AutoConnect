import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, comoApp, type DoisTenants } from './helpers/tenant-fixture';

/**
 * O isolamento em si, exercido como o papel `autoconnect_app` — que é quem o
 * RLS filtra. A conexão dona das tabelas o ignora e passaria verde sem provar
 * nada, então todos os testes daqui passam por `comoApp()`.
 */
describe('RLS — isolamento entre concessionárias (e2e)', () => {
  let prisma: PrismaService;
  /** Dona das tabelas: semeia dados das duas lojas e representa o super admin. */
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;

  const contar = async (ctx: { tenantId?: string }, sql: string, ...p: unknown[]) => {
    const r = (await comoApp(prisma, ctx, (tx) => tx.$queryRawUnsafe(sql, ...p))) as {
      total: bigint;
    }[];
    return Number(r[0]?.total ?? 0);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, PrivilegedPrismaService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    dono = moduleRef.get(PrivilegedPrismaService);
    await Promise.all([prisma.$connect(), dono.$connect()]);
    f = await criarDoisTenants(dono);
  }, 60_000);

  afterAll(async () => {
    await f?.limpar();
    await Promise.all([prisma?.$disconnect(), dono?.$disconnect()]);
  });

  describe('a concessionária A não alcança dados da B', () => {
    it.each([
      ['veículo', 'vehicles', () => f.b.veiculoPrivadoId],
      ['lead', 'leads', () => f.b.leadId],
      ['agendamento', 'appointments', () => f.b.agendamentoId],
    ])('%s da B é invisível para a A', async (_rotulo, tabela, id) => {
      const total = await contar(
        { tenantId: f.a.id },
        `SELECT count(*)::int AS total FROM ${tabela} WHERE id = $1::uuid`,
        id(),
      );

      expect(total).toBe(0);
    });

    it.each([
      ['veículo', 'vehicles', () => f.a.veiculoPrivadoId],
      ['lead', 'leads', () => f.a.leadId],
      ['agendamento', 'appointments', () => f.a.agendamentoId],
    ])('mas a A enxerga o próprio %s', async (_rotulo, tabela, id) => {
      // Sem este par, uma policy que bloqueia tudo passaria no teste acima.
      const total = await contar(
        { tenantId: f.a.id },
        `SELECT count(*)::int AS total FROM ${tabela} WHERE id = $1::uuid`,
        id(),
      );

      expect(total).toBe(1);
    });

    it('uma listagem sem filtro só traz as linhas da própria concessionária', async () => {
      const daB = await contar(
        { tenantId: f.a.id },
        `SELECT count(*)::int AS total FROM leads WHERE tenant_id = $1::uuid`,
        f.b.id,
      );

      expect(daB).toBe(0);
    });
  });

  describe('falha fechando', () => {
    it('sem contexto de tenant, não enxerga lead nenhum', async () => {
      // A propriedade mais importante do desenho: esquecer de setar o tenant
      // fecha tudo em vez de abrir tudo.
      const total = await contar(
        {},
        `SELECT count(*)::int AS total FROM leads WHERE id = $1::uuid`,
        f.a.leadId,
      );

      expect(total).toBe(0);
    });

    it('não consegue gravar lead no tenant de outra concessionária', async () => {
      await expect(
        comoApp(prisma, { tenantId: f.a.id }, (tx) =>
          tx.$queryRawUnsafe(
            `INSERT INTO leads (tenant_id, contact_name, updated_at)
             VALUES ($1::uuid, 'invasor', now())`,
            f.b.id,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe('catálogo público continua aberto', () => {
    it('sem tenant nenhum, enxerga veículos anunciados das duas concessionárias', async () => {
      const total = await contar(
        {},
        `SELECT count(*)::int AS total FROM vehicles WHERE id = ANY($1::uuid[])`,
        [f.a.veiculoPublicoId, f.b.veiculoPublicoId],
      );

      expect(total).toBe(2);
    });

    it('mas não enxerga os que não estão anunciados', async () => {
      const total = await contar(
        {},
        `SELECT count(*)::int AS total FROM vehicles WHERE id = ANY($1::uuid[])`,
        [f.a.veiculoPrivadoId, f.b.veiculoPrivadoId],
      );

      expect(total).toBe(0);
    });

    it('as filiais ativas aparecem no mapa sem autenticação', async () => {
      const total = await contar(
        {},
        `SELECT count(*)::int AS total FROM dealership_branches WHERE id = ANY($1::uuid[])`,
        [f.a.filialId, f.b.filialId],
      );

      expect(total).toBe(2);
    });

    it('a página pública da concessionária encontra o tenant ativo pelo slug', async () => {
      const total = await contar(
        {},
        `SELECT count(*)::int AS total FROM tenants WHERE slug = $1`,
        f.b.slug,
      );

      expect(total).toBe(1);
    });

    it('marcas e modelos são legíveis por todos', async () => {
      const total = await contar(
        {},
        `SELECT count(*)::int AS total FROM vehicle_models WHERE id = $1::uuid`,
        f.modeloId,
      );

      expect(total).toBe(1);
    });
  });

  describe('super admin', () => {
    it('a conexão privilegiada continua enxergando todas as concessionárias', async () => {
      // O painel do super admin consulta todos os tenants por natureza. Ele usa
      // a conexão dona das tabelas, que ignora RLS — é o que este teste fixa.
      const r = await dono.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM tenants WHERE id = ANY(ARRAY[${f.a.id}::uuid, ${f.b.id}::uuid])`;

      expect(r[0]?.total).toBe(2);
    });

    it('e enxerga os convites de abertura de concessionária, que o app não vê', async () => {
      const comoAplicacao = await contar({}, `SELECT count(*)::int AS total FROM tenant_invites`);
      expect(comoAplicacao).toBe(0);

      // A mesma consulta pela conexão privilegiada não é bloqueada por policy.
      await expect(
        dono.$queryRaw`SELECT count(*)::int AS total FROM tenant_invites`,
      ).resolves.toBeDefined();
    });
  });
});
