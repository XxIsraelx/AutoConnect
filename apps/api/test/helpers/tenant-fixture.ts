import type { PrismaService } from '../../src/common/prisma/prisma.service';

/**
 * Cliente que semeia os dados. Precisa ser a conexão **dona das tabelas**: ela
 * cria linhas de duas concessionárias diferentes, o que nenhum contexto de
 * tenant permitiria. Passe o `PrivilegedPrismaService`.
 */
type Semeador = Pick<PrismaService, '$queryRaw' | '$executeRaw'>;

/**
 * Duas concessionárias completas e independentes — a base de todo teste de
 * vazamento. Se um recurso da B aparecer para a A, o isolamento falhou.
 *
 * A escrita é feita pela conexão dona das tabelas (que ignora RLS) de
 * propósito: a fixture precisa conseguir criar dados dos dois tenants. Quem é
 * verificado sob RLS é a leitura, com `comoApp()`.
 */

export interface TenantFixture {
  id: string;
  slug: string;
  usuarioId: string;
  /** status = 'available' — aparece no catálogo público */
  veiculoPublicoId: string;
  /** status = 'archived' — só a própria concessionária pode ver */
  veiculoPrivadoId: string;
  leadId: string;
  agendamentoId: string;
  filialId: string;
}

export interface DoisTenants {
  a: TenantFixture;
  b: TenantFixture;
  marcaId: string;
  modeloId: string;
  limpar: () => Promise<void>;
}

/** Sufixo por execução: os testes rodam contra um banco que pode ter resíduo. */
function sufixo(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function criarTenant(
  prisma: Semeador,
  nome: string,
  marcaId: string,
  modeloId: string,
  marca: string,
): Promise<TenantFixture> {
  const s = sufixo();
  const slug = `${nome}-${s}`;

  const [{ id: tenantId }] = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO tenants (slug, legal_name, trade_name, primary_email, is_active, updated_at)
    VALUES (${slug}, ${`${nome} LTDA`}, ${nome}, ${`${slug}@exemplo.test`}, true, now())
    RETURNING id`;

  const [{ id: usuarioId }] = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO users (tenant_id, email, full_name, role, updated_at)
    VALUES (${tenantId}::uuid, ${`cliente-${s}@exemplo.test`}, 'Cliente Teste', 'customer', now())
    RETURNING id`;

  const [{ id: filialId }] = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO dealership_branches (tenant_id, name, is_active, updated_at)
    VALUES (${tenantId}::uuid, ${`Matriz ${nome}`}, true, now())
    RETURNING id`;

  const veiculo = async (status: string) => {
    const [{ id }] = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO vehicles (tenant_id, brand_id, model_id, year_model, year_make, price, status, updated_at)
      VALUES (${tenantId}::uuid, ${marcaId}::uuid, ${modeloId}::uuid, 2020, 2020, 50000,
              ${status}::"VehicleStatus", now())
      RETURNING id`;
    return id;
  };
  const veiculoPublicoId = await veiculo('available');
  const veiculoPrivadoId = await veiculo('archived');

  const [{ id: leadId }] = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO leads (tenant_id, contact_name, contact_email, updated_at)
    VALUES (${tenantId}::uuid, ${`Lead de ${nome}`}, ${`lead-${s}@exemplo.test`}, now())
    RETURNING id`;

  const [{ id: agendamentoId }] = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO appointments (tenant_id, customer_user_id, type, scheduled_start, scheduled_end, updated_at)
    VALUES (${tenantId}::uuid, ${usuarioId}::uuid, 'test_drive',
            now() + interval '1 day', now() + interval '1 day 1 hour', now())
    RETURNING id`;

  void marca;
  return { id: tenantId, slug, usuarioId, veiculoPublicoId, veiculoPrivadoId, leadId, agendamentoId, filialId };
}

export async function criarDoisTenants(prisma: Semeador): Promise<DoisTenants> {
  const s = sufixo();

  const [{ id: marcaId }] = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO vehicle_brands (name) VALUES (${`Marca ${s}`}) RETURNING id`;
  const [{ id: modeloId }] = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO vehicle_models (brand_id, name) VALUES (${marcaId}::uuid, ${`Modelo ${s}`}) RETURNING id`;

  const a = await criarTenant(prisma, 'concessionaria-a', marcaId, modeloId, marcaId);
  const b = await criarTenant(prisma, 'concessionaria-b', marcaId, modeloId, marcaId);

  const limpar = async () => {
    for (const t of [a, b]) {
      await prisma.$executeRaw`DELETE FROM appointments WHERE tenant_id = ${t.id}::uuid`;
      await prisma.$executeRaw`DELETE FROM leads WHERE tenant_id = ${t.id}::uuid`;
      await prisma.$executeRaw`DELETE FROM vehicles WHERE tenant_id = ${t.id}::uuid`;
      await prisma.$executeRaw`DELETE FROM dealership_branches WHERE tenant_id = ${t.id}::uuid`;
      await prisma.$executeRaw`DELETE FROM users WHERE tenant_id = ${t.id}::uuid`;
      await prisma.$executeRaw`DELETE FROM tenants WHERE id = ${t.id}::uuid`;
    }
    await prisma.$executeRaw`DELETE FROM vehicle_models WHERE id = ${modeloId}::uuid`;
    await prisma.$executeRaw`DELETE FROM vehicle_brands WHERE id = ${marcaId}::uuid`;
  };

  return { a, b, marcaId, modeloId, limpar };
}

/**
 * Roda uma consulta como o papel `autoconnect_app`, que é quem o RLS filtra —
 * a conexão dona das tabelas o ignora e não provaria nada.
 *
 * `SET LOCAL ROLE` troca o papel só até o fim da transação. `tenantId` e
 * `userId` alimentam exatamente as variáveis que as policies leem; omiti-los
 * é o teste do caso "esqueci de setar o contexto", que deve fechar tudo.
 */
export async function comoApp<T>(
  prisma: PrismaService,
  ctx: { tenantId?: string; userId?: string },
  consulta: (tx: { $queryRawUnsafe: (sql: string, ...p: unknown[]) => Promise<unknown> }) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SET LOCAL ROLE autoconnect_app');
    if (ctx.tenantId) {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;
    }
    if (ctx.userId) {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
    }
    return consulta(tx as never);
  });
}
