/**
 * Geração de CSV para as exportações do painel.
 *
 * Saiu de `modules/relatorios` para `common` em 28/09/2026: o financeiro passou a
 * exportar para o contador com as mesmas regras (aspas, quebra de linha, BOM e
 * teto), e a alternativa era uma segunda cópia — que divergiria no primeiro
 * ajuste, como toda cópia neste projeto.
 *
 * Mora num lugar só, e não colado em cada relatório, porque o detalhe que quebra a
 * planilha é sempre o mesmo: aspas dentro do campo. `"` vira `""`, que é o
 * escape do RFC 4180 — sem isso uma observação com aspas desloca todas as
 * colunas seguintes e o lojista descobre em cima da reunião.
 *
 * Quebra de linha e ponto e vírgula viram espaço: o Excel em português abre
 * CSV com `;` como separador quando o arquivo tem BOM, e um campo multilinha
 * atravessa registros em leitores mais simples.
 */
export function campoCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return '""';
  const texto = String(valor).replace(/[\r\n]+/g, ' ').replace(/"/g, '""');
  return `"${texto}"`;
}

export function montarCsv(cabecalho: readonly string[], linhas: readonly unknown[][]): string {
  return [cabecalho, ...linhas].map((l) => l.map(campoCsv).join(',')).join('\n');
}

/**
 * Teto de linhas por exportação.
 *
 * Existe para a consulta não varrer a base inteira numa região a ~0,6s de
 * distância. O que faltava era **dizer** que cortou: até 27/09/2026 a loja com
 * mais de 5.000 negócios baixava um recorte e nada no arquivo avisava.
 */
export const TETO_DE_LINHAS_CSV = 5000;

/**
 * Monta o CSV e, se vier linha além do teto, corta e **avisa dentro do próprio
 * arquivo**.
 *
 * O aviso é a última linha, numa coluna só, porque é onde o lojista está
 * olhando: ele abre a planilha, não o cabeçalho HTTP. Quem chama consulta com
 * `take: TETO_DE_LINHAS_CSV + 1` — é a linha extra que revela que havia mais.
 */
export function montarCsvComTeto(
  cabecalho: readonly string[],
  linhas: readonly unknown[][],
): string {
  const cortou = linhas.length > TETO_DE_LINHAS_CSV;
  const corpo = cortou ? linhas.slice(0, TETO_DE_LINHAS_CSV) : linhas;
  const aviso = [[
    `Exportação cortada nas ${TETO_DE_LINHAS_CSV.toLocaleString('pt-BR')} linhas mais recentes. ` +
    'Reduza o período para levar o resto.',
  ]];
  return montarCsv(cabecalho, cortou ? [...corpo, ...aviso] : corpo);
}

/**
 * O BOM não é enfeite: sem ele o Excel lê o arquivo como Latin-1 e "Peugeot
 * 208 Allure" vira "Peugeot 208 Allure" na tela do lojista.
 */
export const BOM = '﻿';
