import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, comoApp, type DoisTenants } from './helpers/tenant-fixture';

/**
 * As garantias do contrato que precisam morar no banco.
 *
 * "Contrato emitido não muda" também é regra do service — mas ali é uma linha
 * que alguém remove sem perceber, e o efeito de removê-la só aparece no dia em
 * que um cliente contesta a assinatura. Por isso há trigger, e por isso ela é
 * exercida aqui.
 */
describe('Contrato — imutabilidade e isolamento (e2e)', () => {
  let prisma: PrismaService;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let templateId: string;
  let dealId: string;

  const criarContrato = async (status = 'draft') => {
    const [c] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO deal_contracts (tenant_id, deal_id, template_id, status, snapshot, content_hash, updated_at)
      VALUES (${f.a.id}::uuid, ${dealId}::uuid, ${templateId}::uuid, ${status}::"ContractStatus",
              '{"venda":"95000.00"}'::jsonb, 'hash-original', now())
      RETURNING id`;
    return c.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, PrivilegedPrismaService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    dono = moduleRef.get(PrivilegedPrismaService);
    await Promise.all([prisma.$connect(), dono.$connect()]);
    f = await criarDoisTenants(dono);

    const [t] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO contract_templates (tenant_id, name, version, blocks, updated_at)
      VALUES (${f.a.id}::uuid, 'Compra e venda', 1, '{"blocos":[]}'::jsonb, now())
      RETURNING id`;
    templateId = t.id;

    const [d] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO deals (tenant_id, vehicle_id, list_price, sale_value, updated_at)
      VALUES (${f.a.id}::uuid, ${f.a.veiculoPublicoId}::uuid, 100000, 95000, now())
      RETURNING id`;
    dealId = d.id;
  }, 60_000);

  afterEach(async () => {
    await dono.$executeRaw`DELETE FROM deal_contracts WHERE tenant_id = ${f.a.id}::uuid`;
  });

  afterAll(async () => {
    await dono.$executeRaw`DELETE FROM deal_contracts WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM deals WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM contract_templates WHERE tenant_id = ${f.a.id}::uuid`;
    await f?.limpar();
    await Promise.all([prisma?.$disconnect(), dono?.$disconnect()]);
  });

  describe('contrato emitido é imutável', () => {
    it('em rascunho o conteúdo ainda pode mudar', async () => {
      const id = await criarContrato('draft');

      await expect(
        dono.$executeRaw`UPDATE deal_contracts SET content_hash = 'outro' WHERE id = ${id}::uuid`,
      ).resolves.toBe(1);
    });

    it.each([
      ['hash', 'content_hash = \'forjado\''],
      ['snapshot', 'snapshot = \'{"venda":"1.00"}\'::jsonb'],
    ])('depois de emitido, o banco recusa alterar o %s', async (_rotulo, sql) => {
      const id = await criarContrato('issued');

      await expect(
        dono.$executeRawUnsafe(`UPDATE deal_contracts SET ${sql} WHERE id = '${id}'::uuid`),
      ).rejects.toThrow(/já foi emitido/);
    });

    it('o mesmo vale para contrato assinado', async () => {
      const id = await criarContrato('signed');

      await expect(
        dono.$executeRaw`UPDATE deal_contracts SET content_hash = 'x' WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/já foi emitido/);
    });

    it('mas anular continua possível — muda status e motivo, não o conteúdo', async () => {
      const id = await criarContrato('issued');

      await expect(
        dono.$executeRaw`
          UPDATE deal_contracts
             SET status = 'voided', voided_at = now(), void_reason = 'erro de digitação'
           WHERE id = ${id}::uuid`,
      ).resolves.toBe(1);
    });

    it('assinar continua possível', async () => {
      const id = await criarContrato('issued');

      await expect(
        dono.$executeRaw`
          UPDATE deal_contracts SET status = 'signed', signed_at = now() WHERE id = ${id}::uuid`,
      ).resolves.toBe(1);
    });
  });

  describe('isolamento', () => {
    it('o contrato da A é invisível para a B', async () => {
      await criarContrato('issued');

      const linhas = (await comoApp(prisma, { tenantId: f.b.id }, (tx) =>
        tx.$queryRawUnsafe('SELECT count(*)::int AS total FROM deal_contracts'),
      )) as { total: number }[];

      expect(linhas[0].total).toBe(0);
    });

    it('sem contexto de tenant não se enxerga contrato nenhum', async () => {
      await criarContrato('issued');

      const linhas = (await comoApp(prisma, {}, (tx) =>
        tx.$queryRawUnsafe('SELECT count(*)::int AS total FROM deal_contracts'),
      )) as { total: number }[];

      expect(linhas[0].total).toBe(0);
    });

    it('a A enxerga o próprio', async () => {
      await criarContrato('issued');

      const linhas = (await comoApp(prisma, { tenantId: f.a.id }, (tx) =>
        tx.$queryRawUnsafe('SELECT count(*)::int AS total FROM deal_contracts'),
      )) as { total: number }[];

      expect(linhas[0].total).toBe(1);
    });
  });

  it('um contrato tem no máximo uma assinatura por papel', async () => {
    const id = await criarContrato('issued');
    const assinar = () => dono.$executeRaw`
      INSERT INTO contract_signatures (tenant_id, contract_id, role, signer_name, accepted_hash)
      VALUES (${f.a.id}::uuid, ${id}::uuid, 'customer', 'Cliente', 'hash-original')`;

    await expect(assinar()).resolves.toBe(1);
    // Provedor externo reentrega evento; assinar duas vezes é bug visível.
    await expect(assinar()).rejects.toThrow(/23505|unique/i);
  });
});
