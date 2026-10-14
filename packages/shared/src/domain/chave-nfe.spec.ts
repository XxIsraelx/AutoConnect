import {
  chaveNfeValida,
  digitoVerificadorDaChave,
  formatarChaveNfe,
  lerChaveNfe,
  normalizarChaveNfe,
} from './chave-nfe';

/** Exemplo do Manual de Orientação do Contribuinte: as 43 posições e o dígito 5. */
const CHAVE_DO_MANUAL = '52060433009911002506550120000007800267301615';
/** Venda em SP, outubro de 2026, CNPJ numérico. Dígito calculado à parte. */
const CHAVE_SP = '35261011222333000181550010000012341123456787';
/** A mesma nota emitida por um CNPJ alfanumérico (exemplo da Receita: 12.ABC.345/01DE-35). */
const CHAVE_ALFANUMERICA = '35261012ABC34501DE35550010000012341123456788';

describe('dígito verificador', () => {
  it('bate com o exemplo do manual', () => {
    expect(digitoVerificadorDaChave(CHAVE_DO_MANUAL.slice(0, 43))).toBe(5);
  });

  it('usa ASCII − 48 para letra do CNPJ alfanumérico', () => {
    expect(digitoVerificadorDaChave(CHAVE_ALFANUMERICA.slice(0, 43))).toBe(8);
  });
});

describe('lerChaveNfe', () => {
  it('lê os campos de uma chave válida', () => {
    expect(lerChaveNfe(CHAVE_SP)).toEqual({
      chave: CHAVE_SP,
      uf: 'SP',
      anoMes: '2026-10',
      documentoDoEmitente: '11222333000181',
      modelo: 'nfe',
      serie: 1,
      numero: 1234,
      tipoDeEmissao: 1,
      codigoNumerico: '12345678',
      digitoVerificador: 7,
    });
  });

  it('aceita CNPJ alfanumérico', () => {
    expect(lerChaveNfe(CHAVE_ALFANUMERICA)?.documentoDoEmitente).toBe('12ABC34501DE35');
  });

  it('aceita a chave como o DANFE imprime e como o XML a prefixa', () => {
    expect(chaveNfeValida(formatarChaveNfe(CHAVE_SP))).toBe(true);
    expect(chaveNfeValida(`NFe${CHAVE_SP}`)).toBe(true);
    expect(chaveNfeValida(CHAVE_ALFANUMERICA.toLowerCase())).toBe(true);
  });

  it.each([
    ['dígito verificador trocado', CHAVE_SP.slice(0, 43) + '8'],
    ['algarismo do meio trocado', CHAVE_SP.slice(0, 30) + '9' + CHAVE_SP.slice(31)],
    ['colada pela metade', CHAVE_SP.slice(0, 40)],
    ['com uma posição a mais', CHAVE_SP + '1'],
    ['UF que não existe (99)', '99' + CHAVE_SP.slice(2)],
    ['mês 13', '352613' + CHAVE_SP.slice(6)],
    ['modelo 57 (CT-e)', CHAVE_SP.slice(0, 20) + '57' + CHAVE_SP.slice(22)],
    ['letra no dígito do CNPJ', '35261012ABC34501DEA5550010000012341123456788'],
    ['vazia', ''],
  ])('recusa: %s', (_caso, chave) => {
    expect(lerChaveNfe(chave)).toBeNull();
  });

  it('recusa null e undefined sem lançar', () => {
    expect(chaveNfeValida(null)).toBe(false);
    expect(chaveNfeValida(undefined)).toBe(false);
  });
});

describe('formatação', () => {
  it('normaliza tirando espaço e pontuação', () => {
    expect(normalizarChaveNfe(' 3526 1011.2223-3300 ')).toBe('3526101122233300');
  });

  it('agrupa de 4 em 4 sem espaço no fim', () => {
    expect(formatarChaveNfe(CHAVE_SP)).toBe(
      '3526 1011 2223 3300 0181 5500 1000 0012 3411 2345 6787',
    );
  });
});
