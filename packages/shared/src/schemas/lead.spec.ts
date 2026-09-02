import { createLeadSchema, updateLeadStatusSchema } from './lead';

const TENANT = '11111111-1111-4111-8111-111111111111';

describe('createLeadSchema', () => {
  it('assume origem "website" quando a fonte não vem', () => {
    const lead = createLeadSchema.parse({ tenantId: TENANT, contactName: 'Maria' });

    expect(lead.source).toBe('website');
  });

  it('aceita lead de troca — a origem que a validação recusava', () => {
    // `trade_in` existia no enum do Prisma e faltava aqui, então a rota pública
    // de troca criava um lead que ela mesma rejeitava.
    const r = createLeadSchema.safeParse({ tenantId: TENANT, source: 'trade_in' });

    expect(r.success).toBe(true);
  });

  describe('tenantId', () => {
    it('é obrigatório — sem ele não se sabe para qual loja é o lead', () => {
      const r = createLeadSchema.safeParse({ contactName: 'Maria' });

      expect(r.success).toBe(false);
      expect(r.success === false && r.error.issues[0]?.path).toEqual(['tenantId']);
    });

    it('precisa ser uuid, não qualquer string', () => {
      const r = createLeadSchema.safeParse({ tenantId: 'a-loja-do-joao' });

      expect(r.success).toBe(false);
      expect(r.success === false && r.error.issues[0]?.path).toEqual(['tenantId']);
    });
  });

  it('recusa id de veículo que não é uuid', () => {
    const r = createLeadSchema.safeParse({ tenantId: TENANT, vehicleId: '123' });

    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0]?.path).toEqual(['vehicleId']);
  });

  it('recusa e-mail malformado', () => {
    const r = createLeadSchema.safeParse({ tenantId: TENANT, contactEmail: 'maria@' });

    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0]?.path).toEqual(['contactEmail']);
  });

  it('aceita um lead vindo da rota pública, só com contato', () => {
    const r = createLeadSchema.safeParse({
      tenantId: TENANT,
      contactName: 'João',
      contactEmail: 'joao@exemplo.com.br',
      contactPhone: '(51) 99999-0000',
      message: 'Tenho interesse neste carro',
    });

    expect(r.success).toBe(true);
  });
});

describe('updateLeadStatusSchema', () => {
  it('aceita as transições que a tela oferece', () => {
    for (const status of ['new', 'contacted', 'qualified', 'negotiating', 'won', 'lost', 'archived']) {
      expect(updateLeadStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('recusa status inventado', () => {
    expect(updateLeadStatusSchema.safeParse({ status: 'fechado' }).success).toBe(false);
  });
});
