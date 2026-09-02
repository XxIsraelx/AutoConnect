import { ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma, type Deal } from '@autoconnect/db';
import { DealStateService } from './deal-state.service';
import { MarginService } from './margin.service';
import { DEAL_STATUSES, DEAL_TRANSITIONS, type DealStatusValue } from '@autoconnect/shared';

/**
 * A máquina de estados no servidor, sem banco.
 *
 * O `canTransition` do shared já é testado lá; o que se verifica aqui é que o
 * service **usa** a regra e recusa com 409 — o front decide a mensagem por esse
 * status, e um 400 no lugar mudaria o comportamento da tela.
 */
describe('DealStateService', () => {
  let servico: DealStateService;

  const negocio = (status: DealStatusValue, saleValue = '1000.00'): Deal =>
    ({
      id: 'd1',
      tenantId: 't1',
      vehicleId: 'v1',
      status,
      saleValue: new Prisma.Decimal(saleValue),
    }) as Deal;

  /** Transação falsa: registra o que foi chamado, sem tocar em banco. */
  const criarTx = (pagamentos: string[] = []) => {
    const chamadas: Record<string, unknown[]> = {
      dealUpdate: [], vehicleUpdate: [], eventCreate: [],
    };
    const tx = {
      deal: {
        update: (a: unknown) => { chamadas.dealUpdate.push(a); return Promise.resolve(negocio('draft')); },
      },
      vehicle: {
        update: (a: unknown) => { chamadas.vehicleUpdate.push(a); return Promise.resolve({}); },
      },
      dealStatusEvent: {
        create: (a: unknown) => { chamadas.eventCreate.push(a); return Promise.resolve({}); },
      },
      dealPayment: {
        findMany: () => Promise.resolve(pagamentos.map((v) => ({ value: new Prisma.Decimal(v) }))),
      },
      vehicleAcquisition: { findFirst: () => Promise.resolve({ purchaseValue: new Prisma.Decimal('700.00'), enteredAt: new Date() }) },
      vehicleCost: { findMany: () => Promise.resolve([{ value: new Prisma.Decimal('50.00') }]) },
    };
    return { tx: tx as never, chamadas };
  };

  beforeEach(() => {
    servico = new DealStateService(new MarginService());
  });

  it('recusa toda aresta que não existe na máquina de estados', async () => {
    const proibidas: [DealStatusValue, DealStatusValue][] = [];
    for (const de of DEAL_STATUSES) {
      for (const para of DEAL_STATUSES) {
        if (de !== para && !DEAL_TRANSITIONS[de].includes(para)) proibidas.push([de, para]);
      }
    }
    // Não é uma amostra: são todas as arestas proibidas do grafo.
    expect(proibidas.length).toBeGreaterThan(70);

    for (const [de, para] of proibidas) {
      const { tx } = criarTx();
      await expect(servico.transicionar(tx, negocio(de), para, 'u1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    }
  });

  it('aceita toda aresta válida', async () => {
    for (const de of DEAL_STATUSES) {
      for (const para of DEAL_TRANSITIONS[de]) {
        // `signed` exige pagamento fechado; dá-se o valor exato.
        const { tx } = criarTx(para === 'signed' ? ['1000.00'] : []);
        await expect(servico.transicionar(tx, negocio(de), para, 'u1')).resolves.toBeDefined();
      }
    }
  });

  it('transição para o mesmo status é pedido malformado, não conflito', async () => {
    const { tx } = criarTx();
    await expect(servico.transicionar(tx, negocio('draft'), 'draft', 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('grava o evento com origem, destino e ator', async () => {
    const { tx, chamadas } = criarTx();
    await servico.transicionar(tx, negocio('draft'), 'proposal', 'u42', 'cliente pediu');

    expect(chamadas.eventCreate).toHaveLength(1);
    expect((chamadas.eventCreate[0] as { data: unknown }).data).toMatchObject({
      fromStatus: 'draft', toStatus: 'proposal', actorUserId: 'u42', reason: 'cliente pediu',
    });
  });

  describe('assinatura exige a composição do pagamento fechada', () => {
    it('recusa quando falta valor', async () => {
      const { tx } = criarTx(['600.00']);
      await expect(
        servico.transicionar(tx, negocio('contract_issued'), 'signed', 'u1'),
      ).rejects.toThrow(/Faltam 400\.00/);
    });

    it('recusa quando sobra valor', async () => {
      const { tx } = criarTx(['600.00', '600.00']);
      await expect(
        servico.transicionar(tx, negocio('contract_issued'), 'signed', 'u1'),
      ).rejects.toThrow(/200\.00 a mais/);
    });

    it('aceita pagamento composto que soma exatamente, com centavos', async () => {
      const { tx } = criarTx(['333.33', '333.33', '333.34']);
      await expect(
        servico.transicionar(tx, negocio('contract_issued'), 'signed', 'u1'),
      ).resolves.toBeDefined();
    });
  });

  it('faturar congela custo e margem e marca o veículo como vendido', async () => {
    const { tx, chamadas } = criarTx();
    await servico.transicionar(tx, negocio('signed', '1000.00'), 'invoiced', 'u1');

    // custo = aquisição 700 + preparação 50
    expect((chamadas.dealUpdate[0] as { data: Record<string, Prisma.Decimal> }).data)
      .toMatchObject({
        vehicleCostSnapshot: expect.objectContaining({}),
      });
    const data = (chamadas.dealUpdate[0] as { data: Record<string, Prisma.Decimal> }).data;
    expect(data.vehicleCostSnapshot.toFixed(2)).toBe('750.00');
    expect(data.grossMargin.toFixed(2)).toBe('250.00');

    expect((chamadas.vehicleUpdate[0] as { data: unknown }).data).toMatchObject({ status: 'sold' });
  });

  it('cancelar devolve o veículo ao estoque', async () => {
    const { tx, chamadas } = criarTx();
    await servico.transicionar(tx, negocio('draft'), 'canceled', 'u1', 'desistiu');

    expect((chamadas.vehicleUpdate[0] as { data: unknown }).data).toMatchObject({
      status: 'available', soldAt: null,
    });
  });

  it('distratar também devolve o veículo — o carro volta a ser vendável', async () => {
    const { tx, chamadas } = criarTx();
    await servico.transicionar(tx, negocio('delivered'), 'rescinded', 'u1');

    expect((chamadas.vehicleUpdate[0] as { data: unknown }).data).toMatchObject({
      status: 'available',
    });
  });
});
