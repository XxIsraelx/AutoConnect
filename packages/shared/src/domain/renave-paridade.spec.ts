import { RenaveOperacao, RenaveOrigem, RenaveStatus } from '@autoconnect/db';
import { RENAVE_OPERACOES, RENAVE_ORIGENS, RENAVE_STATUSES } from './renave';

/**
 * Paridade dos enums do RENAVE com o Prisma.
 *
 * Arquivo próprio, e não mais um bloco em `schemas/paridade-enums.spec.ts`:
 * aquele arquivo é de todas as sessões, e a divisão do plano fiscal combina
 * que cada trilha escreve só nos seus. A regra é a mesma de lá.
 */
const conjunto = (v: readonly string[]) => new Set(v);

describe('paridade dos enums do RENAVE', () => {
  it('RenaveOperacao', () => {
    expect(conjunto(RENAVE_OPERACOES)).toEqual(conjunto(Object.values(RenaveOperacao)));
  });

  it('RenaveStatus', () => {
    expect(conjunto(RENAVE_STATUSES)).toEqual(conjunto(Object.values(RenaveStatus)));
  });

  it('RenaveOrigem', () => {
    expect(conjunto(RENAVE_ORIGENS)).toEqual(conjunto(Object.values(RenaveOrigem)));
  });
});
