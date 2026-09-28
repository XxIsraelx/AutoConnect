import { campoCsv, montarCsv, montarCsvComTeto, TETO_DE_LINHAS_CSV } from './csv';

describe('campoCsv', () => {
  it('escapa aspas como manda o RFC 4180 — era o que deslocava as colunas', () => {
    expect(campoCsv('Onix "Turbo"')).toBe('"Onix ""Turbo"""');
  });

  it('quebra de linha vira espaço: campo multilinha atravessava registros', () => {
    expect(campoCsv('linha 1\nlinha 2')).toBe('"linha 1 linha 2"');
  });

  it('nulo e indefinido saem como campo vazio, não como "null"', () => {
    expect(campoCsv(null)).toBe('""');
    expect(campoCsv(undefined)).toBe('""');
  });
});

describe('montarCsvComTeto', () => {
  const linhas = (n: number) => Array.from({ length: n }, (_, i) => [i]);

  it('abaixo do teto não avisa nada', () => {
    const csv = montarCsvComTeto(['N'], linhas(3));
    expect(csv.split('\n')).toHaveLength(4);
    expect(csv).not.toContain('cortada');
  });

  it('exatamente no teto também não avisa — não cortou nada', () => {
    const csv = montarCsvComTeto(['N'], linhas(TETO_DE_LINHAS_CSV));
    expect(csv.split('\n')).toHaveLength(TETO_DE_LINHAS_CSV + 1);
    expect(csv).not.toContain('cortada');
  });

  it('uma linha além do teto: corta no teto e avisa na última linha', () => {
    // Quem chama consulta com `take: TETO + 1` justamente para que a linha
    // extra revele que havia mais — sem ela, o corte seria silencioso.
    const csv = montarCsvComTeto(['N'], linhas(TETO_DE_LINHAS_CSV + 1));
    const l = csv.split('\n');

    expect(l).toHaveLength(TETO_DE_LINHAS_CSV + 2);
    expect(l[TETO_DE_LINHAS_CSV]).toBe(`"${TETO_DE_LINHAS_CSV - 1}"`);
    expect(l[TETO_DE_LINHAS_CSV + 1]).toContain('cortada');
    expect(l[TETO_DE_LINHAS_CSV + 1]).toContain('5.000');
  });

  it('o aviso é uma linha de uma coluna só, para não bagunçar as colunas', () => {
    const csv = montarCsvComTeto(['A', 'B'], linhas(TETO_DE_LINHAS_CSV + 1));
    expect(csv.split('\n').at(-1)!.split('","')).toHaveLength(1);
  });

  it('sem teto envolvido, é o mesmo CSV de sempre', () => {
    expect(montarCsvComTeto(['A'], [[1]])).toBe(montarCsv(['A'], [[1]]));
  });
});
