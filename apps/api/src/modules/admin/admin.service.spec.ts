import { inicioDoMesEmSaoPaulo } from './admin.service';

/**
 * A API roda em UTC; as lojas, em São Paulo. "Este mês" no painel é o mês de
 * lá — senão, das 21h à meia-noite do último dia, o gasto com consulta e o
 * faturamento do mês apareceriam zerados.
 */
describe('inicioDoMesEmSaoPaulo', () => {
  it('meio do mês: dia 1 às 00h de São Paulo (03h UTC)', () => {
    expect(inicioDoMesEmSaoPaulo(new Date('2026-09-22T15:00:00Z')).toISOString())
      .toBe('2026-09-01T03:00:00.000Z');
  });

  it('já é dia 1 em UTC, mas ainda é o último dia em São Paulo', () => {
    expect(inicioDoMesEmSaoPaulo(new Date('2026-10-01T01:30:00Z')).toISOString())
      .toBe('2026-09-01T03:00:00.000Z');
  });

  it('virada do ano', () => {
    expect(inicioDoMesEmSaoPaulo(new Date('2027-01-01T02:59:59Z')).toISOString())
      .toBe('2026-12-01T03:00:00.000Z');
    expect(inicioDoMesEmSaoPaulo(new Date('2027-01-01T03:00:00Z')).toISOString())
      .toBe('2027-01-01T03:00:00.000Z');
  });
});
