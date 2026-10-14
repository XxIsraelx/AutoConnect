import {
  FinancialAccountKind, FinancialCategoryGroup, FinancialDirection, FinancialEntryStatus,
} from '@autoconnect/db';
import {
  FINANCIAL_ACCOUNT_KINDS, FINANCIAL_CATEGORY_GROUPS, FINANCIAL_DIRECTIONS, FINANCIAL_ENTRY_STATUSES,
} from './financeiro';

/**
 * Paridade dos enums do financeiro com o Prisma — a mesma regra de
 * `schemas/paridade-enums.spec.ts`, em arquivo próprio. Os quatro entraram em
 * 27/09/2026 sem o teste, e quem mudasse o enum no `schema.prisma` sem mexer na
 * constante do shared só descobriria na tela, com um Zod recusando valor válido.
 */
const conjunto = (v: readonly string[]) => new Set(v);

describe('paridade dos enums do financeiro', () => {
  it('FinancialAccountKind', () => {
    expect(conjunto(FINANCIAL_ACCOUNT_KINDS)).toEqual(conjunto(Object.values(FinancialAccountKind)));
  });
  it('FinancialDirection', () => {
    expect(conjunto(FINANCIAL_DIRECTIONS)).toEqual(conjunto(Object.values(FinancialDirection)));
  });
  it('FinancialEntryStatus', () => {
    expect(conjunto(FINANCIAL_ENTRY_STATUSES)).toEqual(conjunto(Object.values(FinancialEntryStatus)));
  });
  it('FinancialCategoryGroup', () => {
    expect(conjunto(FINANCIAL_CATEGORY_GROUPS)).toEqual(conjunto(Object.values(FinancialCategoryGroup)));
  });
});
