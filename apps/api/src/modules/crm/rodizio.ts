/**
 * A ordem do rodízio de leads.
 *
 * Isolada em função pura para poder ser testada sem banco — a disputa entre
 * duas requisições simultâneas é resolvida no Postgres (ver
 * `RodizioService.proximoVendedor`), mas *qual* é o próximo da fila é decisão
 * de ordenação, e ordenação se testa com uma lista.
 */

export interface CandidatoDoRodizio {
  userId: string;
  /**
   * Posição fixa no anel. Usamos a entrada do membro na equipe (`createdAt`),
   * que não muda: ordenar por nome faria o anel inteiro girar quando alguém
   * casasse e trocasse de sobrenome.
   */
  entrouEm: Date;
  /** Leads em status não terminal hoje na mão deste vendedor. */
  leadsAbertos: number;
}

/** Ordem do anel: estável, e independente de quem recebeu o último lead. */
function anel(candidatos: readonly CandidatoDoRodizio[]): CandidatoDoRodizio[] {
  return [...candidatos].sort((a, b) => {
    const t = a.entrouEm.getTime() - b.entrouEm.getTime();
    // Dois cadastros no mesmo milissegundo (importação em lote, seed) ficariam
    // com ordem dependente do plano de execução do Postgres. O id desempata.
    return t !== 0 ? t : a.userId.localeCompare(b.userId);
  });
}

/**
 * Quem recebe o próximo lead.
 *
 * **A regra é o anel:** o próximo é quem vem logo depois do último atribuído,
 * dando a volta no fim. É o que faz a distribuição ser previsível — o vendedor
 * consegue prever se o próximo é dele, e é isso que uma loja compara numa
 * reunião com o concorrente.
 *
 * **O desempate é o menor número de leads abertos**, e vale quando não há de
 * onde andar no anel: o primeiro lead da loja, ou o caso em que o último
 * atribuído saiu da empresa, virou gerente ou entrou de férias. Aí "o próximo
 * depois dele" não existe, e escolher pela menor carga é melhor do que
 * escolher pelo primeiro da lista — que receberia tudo enquanto o ponteiro
 * estivesse fora do ar.
 *
 * Devolve `null` quando ninguém está elegível. O chamador deixa o lead **sem
 * responsável**, de propósito: inventar um dono fora do plantão é como um lead
 * dorme no fim de semana na caixa de quem não está trabalhando.
 */
export function escolherProximoDoRodizio(
  candidatos: readonly CandidatoDoRodizio[],
  ultimoUsuarioId: string | null,
): string | null {
  const fila = anel(candidatos);
  if (fila.length === 0) return null;

  const posicao = ultimoUsuarioId
    ? fila.findIndex((c) => c.userId === ultimoUsuarioId)
    : -1;

  if (posicao >= 0) return fila[(posicao + 1) % fila.length].userId;

  // Sem ponteiro utilizável: menor carga primeiro, anel como desempate da
  // própria carga (a `fila` já está ordenada, e `reduce` mantém o primeiro).
  return fila.reduce((melhor, atual) =>
    atual.leadsAbertos < melhor.leadsAbertos ? atual : melhor,
  ).userId;
}
