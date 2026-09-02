import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Cobertura de RLS, verificada contra o catálogo do Postgres.
 *
 * Este arquivo não testa comportamento: testa que a proteção *existe* em todas
 * as tabelas. É o que faz uma tabela nova sem policy quebrar o CI sozinha, em
 * vez de depender de alguém lembrar na revisão.
 *
 * Roda contra um banco criado do zero por `migrate deploy` — se o isolamento
 * só existisse no painel do Supabase, como antes, este teste ficaria vermelho.
 */

/** Não são da aplicação: controle do Prisma e catálogo do PostGIS. */
const FORA_DA_APLICACAO = ['_prisma_migrations', 'spatial_ref_sys'];

interface LinhaTabela {
  tabela: string;
  rls: boolean;
  tem_tenant: boolean;
  tem_user: boolean;
  policies: string[] | null;
}

describe('RLS — cobertura (e2e)', () => {
  let prisma: PrismaService;
  let tabelas: LinhaTabela[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [PrismaService] }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    tabelas = await prisma.$queryRawUnsafe<LinhaTabela[]>(`
      SELECT c.relname                AS tabela,
             c.relrowsecurity         AS rls,
             bool_or(a.attname = 'tenant_id') AS tem_tenant,
             bool_or(a.attname = 'user_id')   AS tem_user,
             (SELECT array_agg(p.polname ORDER BY p.polname)
                FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind = 'r' AND c.relname <> ALL($1::text[])
      GROUP BY c.oid, c.relname, c.relrowsecurity
      ORDER BY c.relname
    `, FORA_DA_APLICACAO);
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('encontrou as tabelas da aplicação', () => {
    // Guarda contra o pior modo de falha deste arquivo: consultar o catálogo
    // errado, achar zero tabela e passar verde sem verificar nada.
    expect(tabelas.length).toBeGreaterThan(20);
  });

  it('toda tabela da aplicação tem RLS habilitado', () => {
    const semRls = tabelas.filter((t) => !t.rls).map((t) => t.tabela);

    expect(semRls).toEqual([]);
  });

  it('toda tabela com tenant_id tem a policy de isolamento por concessionária', () => {
    const faltando = tabelas
      .filter((t) => t.tem_tenant && !(t.policies ?? []).includes('tenant_isolation'))
      .map((t) => t.tabela);

    expect(faltando).toEqual([]);
  });

  it('toda tabela do consumidor final tem a policy de isolamento por usuário', () => {
    const faltando = tabelas
      .filter((t) => !t.tem_tenant && t.tem_user && !(t.policies ?? []).includes('user_isolation'))
      .map((t) => t.tabela);

    expect(faltando).toEqual([]);
  });

  it('nenhuma tabela ficou com RLS ligado e sem policy nenhuma por descuido', () => {
    // tenant_invites é a única exceção deliberada: é consultada por token antes
    // de existir tenant, então não há critério de isolamento — o acesso é feito
    // pela conexão privilegiada. Qualquer outra tabela nesta situação é
    // provavelmente esquecimento.
    const excecoes = ['tenant_invites'];
    const orfas = tabelas
      .filter((t) => (t.policies ?? []).length === 0 && !excecoes.includes(t.tabela))
      .map((t) => t.tabela);

    expect(orfas).toEqual([]);
  });

  it('o papel da aplicação não pode ignorar RLS', () => {
    // Se alguém der BYPASSRLS ou superuser a este papel, todo o resto vira
    // decoração. Vale um teste.
    return prisma
      .$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'autoconnect_app'`
      .then((papel) => {
        expect(papel).toHaveLength(1);
        expect(papel[0]).toEqual({ rolsuper: false, rolbypassrls: false });
      });
  });
});
