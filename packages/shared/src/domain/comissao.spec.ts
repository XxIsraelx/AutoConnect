import { calcularComissao } from './comissao';

describe('calcularComissao', () => {
  it('aplica o percentual sobre o valor de venda', () => {
    // O caso do piloto: `/equipe` dizia R$ 1.950,00 e `/relatorios`, R$ 147,50.
    expect(calcularComissao('78000.00', '2.50')).toBe('1950.00');
  });

  it('aceita percentual como número e como string', () => {
    expect(calcularComissao('106900.00', 2)).toBe('2138.00');
    expect(calcularComissao('106900.00', '2.00')).toBe('2138.00');
  });

  it('devolve null sem percentual configurado, e não zero', () => {
    // Zero diria "não ganhou nada"; o que houve foi "ninguém informou quanto
    // ela ganha", e a tela mostra uma coisa diferente para cada caso.
    expect(calcularComissao('78000.00', null)).toBeNull();
    expect(calcularComissao('78000.00', undefined)).toBeNull();
    expect(calcularComissao('78000.00', '')).toBeNull();
  });

  it('zero de venda com percentual configurado é zero, não null', () => {
    expect(calcularComissao('0.00', '2.50')).toBe('0.00');
  });

  it('arredonda meio-para-cima no centavo', () => {
    // 1,00 × 0,50% = 0,005 → 0,01
    expect(calcularComissao('1.00', '0.50')).toBe('0.01');
    // 33.333,33 × 1,5% = 499,99995 → 500,00
    expect(calcularComissao('33333.33', '1.50')).toBe('500.00');
  });

  it('não passa por ponto flutuante', () => {
    // Number('0.1') * 3 / 100 daria 0.003000000000000000...; em centavos é exato.
    expect(calcularComissao('9999999.99', '2.50')).toBe('250000.00');
  });

  it('recusa valor monetário malformado em vez de inventar um número', () => {
    expect(() => calcularComissao('78.000,00', '2.5')).toThrow(/Valor monetário inválido/);
  });
});
