import {
  LeadSource,
  LeadStatus,
  VehicleCondition,
  UserRole,
} from '@autoconnect/db';
import { LEAD_SOURCES, LEAD_STATUSES } from './lead';
import { VEHICLE_CONDITIONS } from './vehicle';
import { INVITABLE_ROLES } from './auth';

/**
 * Os schemas Zod repetem listas que também existem como enum no Prisma. A
 * repetição é deliberada — `@autoconnect/shared` é dependência do `apps/web`, e
 * importar `@autoconnect/db` (que é `export * from '@prisma/client'`) arrastaria
 * o Prisma e seus binários nativos para o bundle do navegador.
 *
 * O preço dessa escolha é a possibilidade de divergência. Estes testes são o
 * que a torna impossível de passar despercebida: quem adicionar um valor no
 * `schema.prisma` e esquecer do Zod quebra o CI aqui.
 *
 * Não é hipótese: `LeadSource.trade_in` existia no Prisma e faltava no Zod, e o
 * efeito era a rota pública de troca recusar o lead que ela mesma criava.
 */

const conjunto = (v: readonly string[]) => new Set(v);

describe('paridade entre os enums do Prisma e os schemas Zod', () => {
  it('LeadSource', () => {
    expect(conjunto(LEAD_SOURCES)).toEqual(conjunto(Object.values(LeadSource)));
  });

  it('LeadStatus', () => {
    expect(conjunto(LEAD_STATUSES)).toEqual(conjunto(Object.values(LeadStatus)));
  });

  it('VehicleCondition', () => {
    expect(conjunto(VEHICLE_CONDITIONS)).toEqual(conjunto(Object.values(VehicleCondition)));
  });

  it('os papéis conviáveis são um subconjunto de UserRole, não a lista inteira', () => {
    // Aqui a asserção é de subconjunto de propósito: convidar `super_admin` ou
    // `customer` pela tela da equipe seria escalada de privilégio. Um teste de
    // igualdade estaria errado e abriria a porta no dia em que alguém o
    // "consertasse".
    const papeis = conjunto(Object.values(UserRole));
    for (const r of INVITABLE_ROLES) {
      expect(papeis.has(r)).toBe(true);
    }
    expect(conjunto(INVITABLE_ROLES).has('super_admin' as never)).toBe(false);
    expect(conjunto(INVITABLE_ROLES).has('customer' as never)).toBe(false);
  });
});
