import { EXEMPLO_DA_CALCULADORA, valorEmRiscoEmCentavos } from './lead-perdido';

describe('valorEmRiscoEmCentavos', () => {
  it('o exemplo da página: 100 × 30% × 10% × R$ 3.000 = R$ 9.000', () => {
    expect(valorEmRiscoEmCentavos(EXEMPLO_DA_CALCULADORA)).toBe(900_000n);
  });

  it('arredonda para o centavo, sem ponto flutuante no caminho', () => {
    // 7 × 33% × 11% × R$ 1.234 = R$ 313,5594 → R$ 313,56
    expect(
      valorEmRiscoEmCentavos({ leadsPorMes: 7, percentualRespondidoTarde: 33, taxaDeFechamento: 11, lucroPorCarro: 1234 }),
    ).toBe(31_356n);
  });

  it('campo vazio ou zero dá zero, não NaN', () => {
    expect(valorEmRiscoEmCentavos({ ...EXEMPLO_DA_CALCULADORA, leadsPorMes: 0 })).toBe(0n);
    expect(valorEmRiscoEmCentavos({ ...EXEMPLO_DA_CALCULADORA, lucroPorCarro: Number.NaN })).toBe(0n);
  });

  it('percentual acima de 100 é tratado como 100, e negativo como zero', () => {
    expect(valorEmRiscoEmCentavos({ ...EXEMPLO_DA_CALCULADORA, percentualRespondidoTarde: 250 }))
      .toBe(valorEmRiscoEmCentavos({ ...EXEMPLO_DA_CALCULADORA, percentualRespondidoTarde: 100 }));
    expect(valorEmRiscoEmCentavos({ ...EXEMPLO_DA_CALCULADORA, taxaDeFechamento: -5 })).toBe(0n);
  });
});
