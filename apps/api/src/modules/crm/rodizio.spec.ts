import { escolherProximoDoRodizio, type CandidatoDoRodizio } from './rodizio';

/**
 * A ordem do rodízio. A disputa entre duas requisições simultâneas é do banco
 * e está em `crm-onda1.e2e-spec.ts`; aqui se fixa *quem* é o próximo.
 */

const t = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min));

function candidato(
  userId: string,
  minutos: number,
  leadsAbertos = 0,
): CandidatoDoRodizio {
  return { userId, entrouEm: t(minutos), leadsAbertos };
}

describe('rodízio — ordem', () => {
  // Ana entrou primeiro, depois Bruno, depois Carla.
  const equipe = [
    candidato('ana', 1),
    candidato('bruno', 2),
    candidato('carla', 3),
  ];

  it('anda uma casa a partir do último atribuído', () => {
    expect(escolherProximoDoRodizio(equipe, 'ana')).toBe('bruno');
    expect(escolherProximoDoRodizio(equipe, 'bruno')).toBe('carla');
  });

  it('dá a volta no fim do anel', () => {
    expect(escolherProximoDoRodizio(equipe, 'carla')).toBe('ana');
  });

  it('a ordem não depende da ordem em que o banco devolveu as linhas', () => {
    const embaralhado = [equipe[2], equipe[0], equipe[1]];

    expect(escolherProximoDoRodizio(embaralhado, 'ana')).toBe('bruno');
  });

  it('empate no instante de entrada é desfeito pelo id, não pelo acaso', () => {
    const gemeos = [candidato('zeca', 5), candidato('ada', 5)];

    // `ada` < `zeca`: o anel é ada → zeca → ada.
    expect(escolherProximoDoRodizio(gemeos, 'ada')).toBe('zeca');
    expect(escolherProximoDoRodizio(gemeos, 'zeca')).toBe('ada');
  });

  it('com um único elegível, ele recebe de novo — não fica sem dono', () => {
    expect(escolherProximoDoRodizio([candidato('ana', 1)], 'ana')).toBe('ana');
  });
});

describe('rodízio — desempate por carga', () => {
  it('sem ponteiro, quem tem menos leads abertos recebe', () => {
    const equipe = [
      candidato('ana', 1, 7),
      candidato('bruno', 2, 2),
      candidato('carla', 3, 5),
    ];

    expect(escolherProximoDoRodizio(equipe, null)).toBe('bruno');
  });

  it('empate na carga volta à ordem do anel', () => {
    const equipe = [candidato('ana', 1, 3), candidato('bruno', 2, 3)];

    expect(escolherProximoDoRodizio(equipe, null)).toBe('ana');
  });

  it('ponteiro apontando para quem saiu do plantão também cai na carga', () => {
    // É o caso que mais acontece: o último atribuído entrou de férias, e o
    // anel perdeu a referência. Sem este ramo o primeiro da lista receberia
    // tudo enquanto ele estivesse fora.
    const equipe = [candidato('ana', 1, 9), candidato('bruno', 2, 1)];

    expect(escolherProximoDoRodizio(equipe, 'carla-de-ferias')).toBe('bruno');
  });
});

describe('rodízio — ninguém elegível', () => {
  it('devolve null em vez de escolher qualquer um', () => {
    // O lead fica sem responsável e aparece no filtro "sem responsável". É
    // melhor que dormir na caixa de quem não está trabalhando.
    expect(escolherProximoDoRodizio([], 'ana')).toBeNull();
    expect(escolherProximoDoRodizio([], null)).toBeNull();
  });
});
