/**
 * Calculadora de lead perdido da landing: quanto a loja arrisca por mês com
 * os leads respondidos depois de 1 hora.
 *
 *   leads/mês × % respondidos tarde × taxa de fechamento × lucro por carro
 *
 * É um **teto** ("até R$ X em risco"), não uma perda garantida: supõe que todo
 * lead respondido tarde fecharia na taxa normal se respondido a tempo. A
 * página diz "até" por isso.
 *
 * Entradas inteiras (quantidade, pontos percentuais e reais), conta em
 * centavos com `bigint` — dinheiro nunca é `number` de ponto flutuante.
 */
export interface EntradaDaCalculadora {
  leadsPorMes: number;
  /** 0–100 */
  percentualRespondidoTarde: number;
  /** 0–100 */
  taxaDeFechamento: number;
  /** Em reais inteiros. */
  lucroPorCarro: number;
}

export const EXEMPLO_DA_CALCULADORA: EntradaDaCalculadora = {
  leadsPorMes: 100,
  percentualRespondidoTarde: 30,
  taxaDeFechamento: 10,
  lucroPorCarro: 3000,
};

const inteiro = (n: number, max: number) =>
  BigInt(Math.min(Math.max(Math.floor(Number.isFinite(n) ? n : 0), 0), max));

/** Valor em risco por mês, em centavos, arredondado para o centavo mais próximo. */
export function valorEmRiscoEmCentavos(e: EntradaDaCalculadora): bigint {
  const leads = inteiro(e.leadsPorMes, 1_000_000);
  const tarde = inteiro(e.percentualRespondidoTarde, 100);
  const fechamento = inteiro(e.taxaDeFechamento, 100);
  const lucroCentavos = inteiro(e.lucroPorCarro, 100_000_000) * 100n;

  const numerador = leads * tarde * fechamento * lucroCentavos;
  // ÷ 100 de cada percentual; arredonda meio para cima.
  return (numerador + 5_000n) / 10_000n;
}
