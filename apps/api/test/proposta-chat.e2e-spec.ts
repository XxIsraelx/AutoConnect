import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { PropostaChatService } from '../src/modules/deals/proposta-chat.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * A proposta do chat virando negócio, contra o banco de verdade.
 *
 * Este caminho merece teste próprio porque **falha em silêncio por desenho**:
 * o vínculo nunca derruba o envio da mensagem, então um defeito aqui não
 * aparece como erro — aparece como uma proposta que simplesmente não chegou ao
 * funil. Só olhando o banco depois é que se pega.
 */
describe('Proposta do chat → negócio (e2e)', () => {
  let prisma: PrismaService;
  let dono: PrivilegedPrismaService;
  let servico: PropostaChatService;
  let f: DoisTenants;
  let clienteId: string;

  const PROPOSTA = {
    price: 88000,
    downPayment: 20000,
    installments: 48,
    installmentValue: 1899.9,
  };

  const negocios = (vehicleId: string) =>
    dono.$queryRaw<{ id: string; status: string; list_price: string; discount: string; sale_value: string }[]>`
      SELECT id, status::text, list_price::text, discount::text, sale_value::text
        FROM deals WHERE vehicle_id = ${vehicleId}::uuid`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, PrivilegedPrismaService, PropostaChatService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    dono = moduleRef.get(PrivilegedPrismaService);
    servico = moduleRef.get(PropostaChatService);
    await Promise.all([prisma.$connect(), dono.$connect()]);
    f = await criarDoisTenants(dono);

    const [c] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO users (email, password_hash, full_name, role, status, updated_at)
      VALUES (${`cliente-${Date.now()}@teste.com`}, 'x', 'Cliente', 'customer', 'active', now())
      RETURNING id`;
    clienteId = c.id;
  }, 60_000);

  afterEach(async () => {
    await dono.$executeRaw`DELETE FROM deals WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`
      UPDATE vehicles SET status = 'available' WHERE tenant_id = ${f.a.id}::uuid`;
  });

  afterAll(async () => {
    await dono.$executeRaw`DELETE FROM users WHERE id = ${clienteId}::uuid`;
    await f?.limpar();
    await Promise.all([prisma?.$disconnect(), dono?.$disconnect()]);
  });

  const conversa = (vehicleId: string | null) => ({ vehicleId, customerUserId: clienteId });

  describe('abertura', () => {
    it('abre o negócio em "proposal" com o valor da proposta', async () => {
      const id = await servico.abrirNegocio(
        f.a.id, f.a.usuarioId, conversa(f.a.veiculoPublicoId), PROPOSTA,
      );

      expect(id).toBeTruthy();
      const [n] = await negocios(f.a.veiculoPublicoId);
      expect(n).toMatchObject({ status: 'proposal', sale_value: '88000.00' });
    });

    it('a composição do pagamento vem montada: entrada e financiado', async () => {
      await servico.abrirNegocio(f.a.id, f.a.usuarioId, conversa(f.a.veiculoPublicoId), PROPOSTA);

      const pagamentos = await dono.$queryRaw<{ kind: string; value: string; installments: number | null }[]>`
        SELECT kind::text, value::text, installments FROM deal_payments
         WHERE tenant_id = ${f.a.id}::uuid ORDER BY kind`;

      // 88.000 = 20.000 de entrada + 68.000 financiados
      expect(pagamentos).toEqual([
        { kind: 'down_payment', value: '20000.00', installments: null },
        { kind: 'financing', value: '68000.00', installments: 48 },
      ]);
    });

    it('o desconto fecha a conta: tabela − desconto = venda', async () => {
      await servico.abrirNegocio(f.a.id, f.a.usuarioId, conversa(f.a.veiculoPublicoId), PROPOSTA);

      const [n] = await negocios(f.a.veiculoPublicoId);
      const conta = Number(n.list_price) - Number(n.discount);
      expect(conta.toFixed(2)).toBe(Number(n.sale_value).toFixed(2));
    });

    it('proposta acima da tabela não gera desconto negativo', async () => {
      // A tabela da fixture é menor que isto; sem tratamento, o desconto
      // ficaria negativo e a conferência do negócio quebraria.
      await servico.abrirNegocio(
        f.a.id, f.a.usuarioId, conversa(f.a.veiculoPublicoId), { ...PROPOSTA, price: 999999 },
      );

      const [n] = await negocios(f.a.veiculoPublicoId);
      expect(Number(n.discount)).toBeGreaterThanOrEqual(0);
      expect(n.sale_value).toBe('999999.00');
    });

    it('o veículo sai da vitrine', async () => {
      await servico.abrirNegocio(f.a.id, f.a.usuarioId, conversa(f.a.veiculoPublicoId), PROPOSTA);

      const [v] = await dono.$queryRaw<{ status: string }[]>`
        SELECT status::text FROM vehicles WHERE id = ${f.a.veiculoPublicoId}::uuid`;
      expect(v.status).toBe('reserved');
    });

    it('grava o evento de abertura na timeline', async () => {
      await servico.abrirNegocio(f.a.id, f.a.usuarioId, conversa(f.a.veiculoPublicoId), PROPOSTA);

      const [e] = await dono.$queryRaw<{ to_status: string; reason: string }[]>`
        SELECT to_status::text, reason FROM deal_status_events WHERE tenant_id = ${f.a.id}::uuid`;
      expect(e).toMatchObject({ to_status: 'proposal', reason: 'Proposta enviada pelo chat' });
    });
  });

  describe('o vínculo nunca impede a proposta', () => {
    it('conversa sem veículo: devolve null, sem abrir negócio', async () => {
      const id = await servico.abrirNegocio(f.a.id, f.a.usuarioId, conversa(null), PROPOSTA);

      expect(id).toBeNull();
      const [{ total }] = await dono.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM deals WHERE tenant_id = ${f.a.id}::uuid`;
      expect(Number(total)).toBe(0);
    });

    it('preço ausente ou zerado: devolve null', async () => {
      for (const preco of [undefined, 0, -1, 'abc']) {
        const id = await servico.abrirNegocio(
          f.a.id, f.a.usuarioId, conversa(f.a.veiculoPublicoId), { ...PROPOSTA, price: preco },
        );
        expect(id).toBeNull();
      }
    });

    it('carro já em negócio: reaproveita o existente em vez de abrir um segundo', async () => {
      const primeiro = await servico.abrirNegocio(
        f.a.id, f.a.usuarioId, conversa(f.a.veiculoPublicoId), PROPOSTA,
      );

      const segundo = await servico.abrirNegocio(
        f.a.id, f.a.usuarioId, conversa(f.a.veiculoPublicoId), { ...PROPOSTA, price: 85000 },
      );

      // Sem isto o índice único parcial recusaria e a proposta perderia o
      // vínculo — a segunda rodada de negociação sumiria do funil.
      expect(segundo).toBe(primeiro);
      expect(await negocios(f.a.veiculoPublicoId)).toHaveLength(1);
    });

    it('veículo de outra concessionária: devolve null, sem vazar', async () => {
      const id = await servico.abrirNegocio(
        f.a.id, f.a.usuarioId, conversa(f.b.veiculoPublicoId), PROPOSTA,
      );

      expect(id).toBeNull();
    });
  });

  describe('resposta do cliente', () => {
    it('aceitar move o negócio para "negotiating"', async () => {
      const id = await servico.abrirNegocio(
        f.a.id, f.a.usuarioId, conversa(f.a.veiculoPublicoId), PROPOSTA,
      );

      await expect(servico.aceitar(f.a.id, id!, clienteId)).resolves.toBe(true);

      const [n] = await negocios(f.a.veiculoPublicoId);
      expect(n.status).toBe('negotiating');
    });

    it('aceitar duas vezes não move de novo', async () => {
      const id = await servico.abrirNegocio(
        f.a.id, f.a.usuarioId, conversa(f.a.veiculoPublicoId), PROPOSTA,
      );
      await servico.aceitar(f.a.id, id!, clienteId);

      await expect(servico.aceitar(f.a.id, id!, clienteId)).resolves.toBe(false);
      const [n] = await negocios(f.a.veiculoPublicoId);
      expect(n.status).toBe('negotiating');
    });

    it('negócio de outra concessionária não se move', async () => {
      const id = await servico.abrirNegocio(
        f.a.id, f.a.usuarioId, conversa(f.a.veiculoPublicoId), PROPOSTA,
      );

      await expect(servico.aceitar(f.b.id, id!, clienteId)).resolves.toBe(false);
      const [n] = await negocios(f.a.veiculoPublicoId);
      expect(n.status).toBe('proposal');
    });
  });
});
