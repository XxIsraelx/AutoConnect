import {
  elegivelParaDeduplicacao,
  corteDaDeduplicacao,
  LEAD_STATUSES_TERMINAIS,
  JANELA_DEDUPE_DIAS,
} from './lead-duplicado';

const AGORA = new Date('2026-09-23T12:00:00.000Z');

const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 24 * 60 * 60 * 1000);

const lead = (over: Partial<{ status: string; createdAt: Date; lastActivityAt: Date }> = {}) => ({
  status: 'new',
  createdAt: diasAtras(1),
  lastActivityAt: diasAtras(1),
  ...over,
});

describe('elegivelParaDeduplicacao', () => {
  it('o clique repetido de hoje cai no lead de ontem', () => {
    expect(elegivelParaDeduplicacao(lead(), AGORA)).toBe(true);
  });

  it('lead em status terminal nunca recebe o contato novo', () => {
    for (const status of LEAD_STATUSES_TERMINAIS) {
      expect(elegivelParaDeduplicacao(lead({ status }), AGORA)).toBe(false);
    }
  });

  it('lead em negociação recebe — é o mesmo atendimento', () => {
    for (const status of ['new', 'contacted', 'qualified', 'negotiating']) {
      expect(elegivelParaDeduplicacao(lead({ status }), AGORA)).toBe(true);
    }
  });

  it(`fora da janela de ${JANELA_DEDUPE_DIAS} dias vira lead novo`, () => {
    const velho = lead({
      createdAt: diasAtras(JANELA_DEDUPE_DIAS + 1),
      lastActivityAt: diasAtras(JANELA_DEDUPE_DIAS + 1),
    });

    expect(elegivelParaDeduplicacao(velho, AGORA)).toBe(false);
  });

  it('lead antigo mas ainda em atendimento continua elegível', () => {
    // Criado há 40 dias, o vendedor falou com o cliente ontem. Abrir outro
    // lead partiria o histórico do mesmo atendimento em dois.
    const vivo = lead({
      createdAt: diasAtras(40),
      lastActivityAt: diasAtras(1),
    });

    expect(elegivelParaDeduplicacao(vivo, AGORA)).toBe(true);
  });

  it('a borda da janela é inclusiva', () => {
    const naBorda = lead({
      createdAt: corteDaDeduplicacao(AGORA),
      lastActivityAt: corteDaDeduplicacao(AGORA),
    });

    expect(elegivelParaDeduplicacao(naBorda, AGORA)).toBe(true);
  });
});
