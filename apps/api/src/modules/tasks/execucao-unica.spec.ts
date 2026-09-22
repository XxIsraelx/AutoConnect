import { executarEmUmaReplica } from './execucao-unica';

/**
 * Unitário: fixa o contrato do helper sem banco. A disputa real entre duas
 * conexões está em `test/cron-uma-replica.e2e-spec.ts`.
 */

function clienteFalso(obtida: boolean) {
  const queryRaw = jest.fn(async () => [{ obtida }]);
  const $transaction = jest.fn(
    async (...args: [fn: (tx: unknown) => unknown, opcoes?: unknown]) =>
      args[0]({ $queryRaw: queryRaw }),
  );
  return { cliente: { $transaction } as never, $transaction, queryRaw };
}

const logger = { log: jest.fn(), warn: jest.fn() };

describe('executarEmUmaReplica', () => {
  it('com a trava obtida, roda o corpo e devolve true', async () => {
    const { cliente } = clienteFalso(true);
    const corpo = jest.fn(async () => undefined);

    expect(await executarEmUmaReplica(cliente, 'x', logger, corpo)).toBe(true);
    expect(corpo).toHaveBeenCalledTimes(1);
  });

  it('com a trava de outra réplica, não roda o corpo e devolve false', async () => {
    const { cliente } = clienteFalso(false);
    const corpo = jest.fn(async () => undefined);

    expect(await executarEmUmaReplica(cliente, 'x', logger, corpo)).toBe(false);
    expect(corpo).not.toHaveBeenCalled();
  });

  it('usa a trava de transação, não a de sessão — o pool trocaria a conexão', async () => {
    const { cliente, queryRaw } = clienteFalso(true);

    await executarEmUmaReplica(cliente, 'x', logger, async () => undefined);

    const [partes] = queryRaw.mock.calls[0] as unknown as [TemplateStringsArray];
    expect(partes.join('?')).toContain('pg_try_advisory_xact_lock');
  });

  it('segura a transação por mais que os 5s padrão do Prisma', async () => {
    const { cliente, $transaction } = clienteFalso(true);

    await executarEmUmaReplica(cliente, 'x', logger, async () => undefined);

    const opcoes = $transaction.mock.calls[0][1] as { timeout: number };
    expect(opcoes.timeout).toBeGreaterThan(5 * 60 * 1000);
    expect(opcoes.timeout).toBeLessThan(60 * 60 * 1000); // menor que o cron horário
  });

  it('erro do corpo propaga', async () => {
    const { cliente } = clienteFalso(true);

    await expect(
      executarEmUmaReplica(cliente, 'x', logger, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
