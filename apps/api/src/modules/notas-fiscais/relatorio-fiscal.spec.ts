import { periodoEmBrasilia } from './relatorio-fiscal.service';

describe('periodoEmBrasilia', () => {
  it('o mês vai da meia-noite de Brasília do dia 1 à meia-noite do dia seguinte ao último', () => {
    const p = periodoEmBrasilia('2026-10-01', '2026-10-31');
    expect(p.de.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(p.ateExclusivo.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(p.rotulo).toBe('2026-10-01 a 2026-10-31');
  });

  it('nota autorizada às 22h de 31/10 em Brasília é de outubro, embora seja 1º/11 em UTC', () => {
    const p = periodoEmBrasilia('2026-10-01', '2026-10-31');
    const autorizada = new Date('2026-11-01T01:00:00Z');
    expect(autorizada >= p.de && autorizada < p.ateExclusivo).toBe(true);
    expect(new Date('2026-11-01T03:00:00Z') < p.ateExclusivo).toBe(false);
  });

  it('aceita data com hora (ISO) e usa só o dia', () => {
    expect(periodoEmBrasilia('2026-10-05T15:00:00Z', '2026-10-05T15:00:00Z').ateExclusivo.toISOString())
      .toBe('2026-10-06T03:00:00.000Z');
  });
});
