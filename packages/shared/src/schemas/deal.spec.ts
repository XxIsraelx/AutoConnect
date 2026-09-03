import { createAcquisitionSchema, createVehicleCostSchema } from './deal';

const DIA = 24 * 60 * 60 * 1000;

/**
 * A regra que faltava: aquisição e custo são fatos consumados.
 *
 * Sem ela dava para registrar que o carro entrou no estoque daqui a três dias,
 * e a tela exibia "0 dias em estoque" para um veículo que nem foi comprado.
 */
describe('datas de aquisição e custo', () => {
  const base = {
    origin: 'direct_purchase' as const,
    purchaseValue: '70000.00',
  };

  it('aceita data de hoje', () => {
    expect(() =>
      createAcquisitionSchema.parse({ ...base, enteredAt: new Date().toISOString() }),
    ).not.toThrow();
  });

  it('aceita data passada', () => {
    expect(() =>
      createAcquisitionSchema.parse({
        ...base, enteredAt: new Date(Date.now() - 90 * DIA).toISOString(),
      }),
    ).not.toThrow();
  });

  it('recusa entrada no estoque no futuro', () => {
    expect(() =>
      createAcquisitionSchema.parse({
        ...base, enteredAt: new Date(Date.now() + 3 * DIA).toISOString(),
      }),
    ).toThrow(/não pode estar no futuro/);
  });

  it('tolera até 24h à frente — o navegador manda a data no fuso local', () => {
    // Fuso pode estar até 14h adiante do relógio do servidor; recusar isso
    // faria a loja não conseguir registrar a compra de hoje.
    expect(() =>
      createAcquisitionSchema.parse({
        ...base, enteredAt: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
      }),
    ).not.toThrow();
  });

  it('a mesma regra vale para o custo', () => {
    expect(() =>
      createVehicleCostSchema.parse({
        kind: 'preparation', value: '100.00',
        incurredAt: new Date(Date.now() + 3 * DIA).toISOString(),
      }),
    ).toThrow(/não pode estar no futuro/);
  });

  it('a mensagem diz qual data está errada', () => {
    try {
      createAcquisitionSchema.parse({ ...base, enteredAt: new Date(Date.now() + 5 * DIA).toISOString() });
      throw new Error('deveria ter recusado');
    } catch (e) {
      expect(String(e)).toMatch(/data de entrada no estoque/i);
    }
  });
});
