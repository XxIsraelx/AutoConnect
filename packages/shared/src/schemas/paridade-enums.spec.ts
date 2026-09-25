import {
  LeadSource,
  LeadStatus,
  VehicleCondition,
  VehicleStatus,
  UserRole,
  DealStatus,
  PaymentKind,
  PaymentStatus,
  AcquisitionOrigin,
  VehicleCostKind,
  ContractStatus,
  SignerRole,
  VehicleQueryKind,
  VehicleQueryStatus,
  SignatureRequestStatus,
  SubscriptionPlan,
  ListingStatus,
  AppointmentType,
  AppointmentStatus,
} from '@autoconnect/db';
import { LEAD_SOURCES, LEAD_STATUSES, LEAD_SOURCES_MANUAIS } from './lead';
import { APPOINTMENT_TYPES, APPOINTMENT_STATUSES } from './appointment';
import { VEHICLE_CONDITIONS, VEHICLE_STATUSES, VEHICLE_STATUSES_MANUAIS } from './vehicle';
import { LISTING_STATUSES } from '../domain/anuncio';
import { INVITABLE_ROLES } from './auth';
import {
  DEAL_STATUSES,
  PAYMENT_KINDS,
  PAYMENT_STATUSES,
  ACQUISITION_ORIGINS,
  VEHICLE_COST_KINDS,
} from '../domain/deal';
import { CONTRACT_STATUSES, SIGNER_ROLES } from '../domain/garantia';
import { TIPOS_CONSULTA, CONSULTA_STATUSES } from '../domain/consulta-veicular';
import { ASSINATURA_EXTERNA_STATUSES } from '../domain/assinatura-externa';
import { SUBSCRIPTION_PLANS } from './tenant';

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

  it('AppointmentType', () => {
    expect(conjunto(APPOINTMENT_TYPES)).toEqual(conjunto(Object.values(AppointmentType)));
  });

  it('AppointmentStatus', () => {
    expect(conjunto(APPOINTMENT_STATUSES)).toEqual(conjunto(Object.values(AppointmentStatus)));
  });

  it('as origens que o vendedor escolhe são um subconjunto de LeadSource', () => {
    // Subconjunto de propósito: `website`, `app` e `trade_in` são escritas pelo
    // próprio sistema. Deixá-las na lista do formulário manual faria o relatório
    // de origem mentir — um lead de balcão marcado como "site" some do custo de
    // aquisição do canal.
    const origens = conjunto(Object.values(LeadSource));
    for (const s of LEAD_SOURCES_MANUAIS) {
      expect(origens.has(s)).toBe(true);
    }
    for (const automatica of ['website', 'app', 'trade_in'] as const) {
      expect(conjunto(LEAD_SOURCES_MANUAIS).has(automatica as never)).toBe(false);
    }
  });

  it('VehicleCondition', () => {
    expect(conjunto(VEHICLE_CONDITIONS)).toEqual(conjunto(Object.values(VehicleCondition)));
  });

  it('VehicleStatus', () => {
    expect(conjunto(VEHICLE_STATUSES)).toEqual(conjunto(Object.values(VehicleStatus)));
  });

  it('os estados que a tela grava são um subconjunto — "vendido" não entra', () => {
    // Subconjunto de propósito: quem marca `sold` é o faturamento do negócio,
    // que grava `soldAt` e congela a margem na mesma transação. Um teste de
    // igualdade aqui abriria a porta no dia em que alguém o "consertasse".
    const todos = conjunto(VEHICLE_STATUSES);
    for (const s of VEHICLE_STATUSES_MANUAIS) expect(todos.has(s)).toBe(true);
    expect(conjunto(VEHICLE_STATUSES_MANUAIS).has('sold' as never)).toBe(false);
  });

  it('ListingStatus', () => {
    expect(conjunto(LISTING_STATUSES)).toEqual(conjunto(Object.values(ListingStatus)));
  });

  it('DealStatus', () => {
    expect(conjunto(DEAL_STATUSES)).toEqual(conjunto(Object.values(DealStatus)));
  });

  it('PaymentKind', () => {
    expect(conjunto(PAYMENT_KINDS)).toEqual(conjunto(Object.values(PaymentKind)));
  });

  it('PaymentStatus', () => {
    expect(conjunto(PAYMENT_STATUSES)).toEqual(conjunto(Object.values(PaymentStatus)));
  });

  it('AcquisitionOrigin', () => {
    expect(conjunto(ACQUISITION_ORIGINS)).toEqual(conjunto(Object.values(AcquisitionOrigin)));
  });

  it('VehicleCostKind', () => {
    expect(conjunto(VEHICLE_COST_KINDS)).toEqual(conjunto(Object.values(VehicleCostKind)));
  });

  it('ContractStatus', () => {
    expect(conjunto(CONTRACT_STATUSES)).toEqual(conjunto(Object.values(ContractStatus)));
  });

  it('SignerRole', () => {
    expect(conjunto(SIGNER_ROLES)).toEqual(conjunto(Object.values(SignerRole)));
  });

  it('VehicleQueryKind', () => {
    expect(conjunto(TIPOS_CONSULTA)).toEqual(conjunto(Object.values(VehicleQueryKind)));
  });

  it('VehicleQueryStatus', () => {
    expect(conjunto(CONSULTA_STATUSES)).toEqual(conjunto(Object.values(VehicleQueryStatus)));
  });

  it('SignatureRequestStatus', () => {
    expect(conjunto(ASSINATURA_EXTERNA_STATUSES)).toEqual(
      conjunto(Object.values(SignatureRequestStatus)),
    );
  });

  it('SubscriptionPlan', () => {
    expect(conjunto(SUBSCRIPTION_PLANS)).toEqual(conjunto(Object.values(SubscriptionPlan)));
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
