import { validarGarantia, textoDaGarantia, GARANTIA_LEGAL_DIAS } from './garantia';

describe('garantia do veículo', () => {
  it('sem garantia contratual, a legal basta', () => {
    expect(validarGarantia({ legalDays: 90 })).toEqual({ ok: true });
  });

  it('recusa reduzir a garantia legal', () => {
    const r = validarGarantia({ legalDays: 30 });

    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/não pode ser reduzida/);
  });

  it('recusa a cláusula clássica: 3 meses só de motor e câmbio', () => {
    // É o caso que motiva o módulo. Prazo abaixo dos 90 dias legais e escopo
    // restrito, apresentado como se fosse a garantia toda.
    const r = validarGarantia({
      legalDays: 90,
      contractualMonths: 2,
      contractualScope: 'motor e câmbio',
    });

    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/CDC art\. 51, I/);
  });

  it('aceita garantia contratual que estende de verdade', () => {
    expect(
      validarGarantia({ legalDays: 90, contractualMonths: 12, contractualScope: 'motor e câmbio' }),
    ).toEqual({ ok: true });
  });

  it('aceita prazo curto sem restrição de escopo — aí não há disfarce', () => {
    expect(validarGarantia({ legalDays: 90, contractualMonths: 1 })).toEqual({ ok: true });
  });

  it('garantia contratual sem prazo é recusada', () => {
    const r = validarGarantia({ legalDays: 90, contractualMonths: 0, contractualScope: 'motor' });

    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/precisa de prazo/);
  });

  describe('texto do contrato', () => {
    it('a garantia legal é sempre declarada', () => {
      // Omiti-la é o que transforma a cláusula em abusiva.
      for (const g of [
        { legalDays: 90 },
        { legalDays: 90, contractualMonths: 12, contractualScope: 'motor' },
      ]) {
        expect(textoDaGarantia(g)[0]).toMatch(/art\. 26, II/);
        expect(textoDaGarantia(g)[0]).toMatch(/totalidade/);
      }
    });

    it('a contratual aparece como adicional, nunca como substituta', () => {
      const linhas = textoDaGarantia({
        legalDays: 90, contractualMonths: 12, contractualScope: 'motor e câmbio',
      });

      expect(linhas).toHaveLength(2);
      expect(linhas[1]).toMatch(/soma-se à legal e não a substitui/);
      expect(linhas[1]).toMatch(/motor e câmbio/);
    });

    it('concorda em número: 1 mês, 12 meses', () => {
      expect(textoDaGarantia({ legalDays: 90, contractualMonths: 1 })[1]).toMatch(/1 mês/);
      expect(textoDaGarantia({ legalDays: 90, contractualMonths: 12 })[1]).toMatch(/12 meses/);
    });
  });

  it('a constante legal é 90 dias', () => {
    expect(GARANTIA_LEGAL_DIAS).toBe(90);
  });
});
