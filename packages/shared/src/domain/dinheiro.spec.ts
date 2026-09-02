import { emCentavos, deCentavos, somar, subtrair, saoIguais, formatarBRL } from './dinheiro';

describe('aritmética monetária', () => {
  it('o caso que motiva o módulo: 0.1 + 0.2 dá exatamente 0.30', () => {
    // Em ponto flutuante isto é 0.30000000000000004.
    expect(somar(['0.10', '0.20'])).toBe('0.30');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('converte e volta sem perder centavo', () => {
    for (const v of ['0.00', '0.01', '0.99', '1234.56', '99999999999.99']) {
      expect(deCentavos(emCentavos(v))).toBe(v);
    }
  });

  it('aceita valor sem casas ou com uma só', () => {
    expect(emCentavos('100')).toBe(10000n);
    expect(emCentavos('100.5')).toBe(10050n);
    expect(deCentavos(emCentavos('100.5'))).toBe('100.50');
  });

  it('recusa o que não é dinheiro em vez de arredondar calado', () => {
    for (const ruim of ['1.234', 'abc', '', '1,50', '1.2.3', '1e3']) {
      expect(() => emCentavos(ruim)).toThrow(/Valor monetário inválido/);
    }
  });

  it('soma de pagamento composto bate com o valor da venda', () => {
    // Entrada + troca + financiamento é o caso comum, não a exceção.
    const pagamentos = ['15000.00', '23500.50', '46499.50'];
    expect(saoIguais(somar(pagamentos), '85000.00')).toBe(true);
  });

  it('margem com centavo quebrado', () => {
    expect(subtrair('85000.00', '71234.57')).toBe('13765.43');
  });

  it('valores negativos (prejuízo) sobrevivem à ida e volta', () => {
    expect(subtrair('100.00', '150.25')).toBe('-50.25');
    expect(deCentavos(emCentavos('-50.25'))).toBe('-50.25');
  });

  it('"100" e "100.00" são o mesmo dinheiro', () => {
    expect(saoIguais('100', '100.00')).toBe(true);
    expect(saoIguais('100.00', '100.01')).toBe(false);
  });

  it('formata em real sem passar por ponto flutuante', () => {
    expect(formatarBRL('1234.56')).toBe('R$ 1.234,56');
    // Valor que um float não representa exatamente.
    expect(formatarBRL('12345678901.99')).toBe('R$ 12.345.678.901,99');
  });
});
