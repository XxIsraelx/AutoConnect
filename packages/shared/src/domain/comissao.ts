/**
 * Comissão do vendedor — **uma** definição, para todas as telas.
 *
 * Até 25/09/2026 havia duas: `/equipe` aplicava o percentual sobre o
 * faturamento e `/relatorios` sobre a margem bruta. A mesma pessoa, no mesmo
 * mês, aparecia com R$ 1.950,00 numa tela e R$ 147,50 na outra — e o CSV que o
 * gerente leva para a reunião de pagamento carregava a segunda. Duas respostas
 * para "quanto eu ganhei" não é um arredondamento divergente: é o número que
 * encerra um piloto, porque depois dele o lojista deixa de acreditar também na
 * margem, que está certa.
 *
 * ## A definição escolhida
 *
 * **percentual do perfil × valor de venda dos negócios faturados no período,
 * pela data de fechamento (`closedAt`).**
 *
 * Por que **valor de venda** e não margem:
 *
 *  1. **A margem é informação de gerência** (`VE_CUSTO`: manager, tenant_admin,
 *     super_admin). Comissão sobre margem não pode ser mostrada a quem a
 *     recebe: `margem = comissão ÷ percentual` e `custo = venda − margem`, e o
 *     vendedor deduziria o custo do carro com uma divisão. O produto precisa
 *     mostrar a comissão **no negócio**, que é onde o vendedor pergunta — e
 *     com esta base isso não vaza nada.
 *  2. **A comissão é um custo do veículo** (`VEHICLE_COST_KINDS.commission`) e
 *     entra na margem. Calcular comissão como percentual de um número que a
 *     própria comissão reduz é circular: lançar a comissão como custo mudaria
 *     a comissão.
 *  3. **A margem só existe congelada depois do faturamento** e pode ser
 *     negativa. Percentual sobre margem negativa produziria comissão negativa,
 *     que ninguém sabe pagar; o valor de venda é positivo, conhecido e
 *     acordado com o cliente.
 *
 * Por que **negócio faturado** e não assinado: faturar é o que congela custo e
 * margem e marca o veículo como vendido — é a definição que o relatório de
 * margem e o funil por valor já usavam (`DEAL_FATURADO_STATUSES`). Assinado
 * ainda admite distrato.
 *
 * O **recorte de data** é sempre `closedAt`; a janela varia por tela de
 * propósito (`/equipe` mostra o mês corrente, `/relatorios` os últimos N
 * dias), e é a tela que diz qual janela está exibindo.
 *
 * > Loja que remunere sobre a margem muda **esta** função e as duas telas
 * > acompanham. Era exatamente isso que não acontecia com duas cópias.
 */

import { deCentavos, emCentavos } from './dinheiro';

/** Rótulo curto da base, exibido junto de todo valor de comissão. */
export const BASE_DA_COMISSAO = 'valor de venda dos negócios faturados';

/** Frase completa, para `title` e legenda de tabela. */
export const EXPLICACAO_DA_COMISSAO =
  'Percentual do perfil aplicado sobre o valor de venda dos negócios ' +
  'faturados no período (pela data de fechamento).';

/**
 * `valor × percentual ÷ 100`, exato, com arredondamento meio-para-cima.
 *
 * Tudo em centavos inteiros: `Number('78000.00') * 2.5 / 100` passa por ponto
 * flutuante, e um centavo de diferença numa comissão vira ligação do vendedor.
 *
 * Devolve `null` quando não há percentual configurado — e **não** `"0.00"`:
 * zero diz "não ganhou nada", quando o que houve foi "ninguém informou quanto
 * ela ganha". A tela distingue as duas coisas.
 */
export function calcularComissao(
  valorBase: string | number,
  percentual: string | number | null | undefined,
): string | null {
  if (percentual === null || percentual === undefined || percentual === '') return null;

  // O percentual também é decimal com 2 casas (`Decimal(5,2)` no banco):
  // `emCentavos('2.50')` devolve 250, isto é, o percentual em centésimos.
  const centesimosDePct = emCentavos(percentual);
  const base = emCentavos(valorBase);

  const produto = base * centesimosDePct; // centavos × centésimos de %
  const divisor = 10_000n; // ÷100 (percentual) ÷100 (centésimos)

  const negativo = produto < 0n;
  const abs = negativo ? -produto : produto;
  // Meio-para-cima sobre o valor absoluto, para que -0,005 e 0,005 arredondem
  // simetricamente em vez de o sinal decidir o centavo.
  const arredondado = (abs + divisor / 2n) / divisor;

  return deCentavos(negativo ? -arredondado : arredondado);
}
