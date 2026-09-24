/**
 * Geração de CSV para as exportações do painel.
 *
 * Mora aqui, e não colado em cada relatório, porque o detalhe que quebra a
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
 * O BOM não é enfeite: sem ele o Excel lê o arquivo como Latin-1 e "Peugeot
 * 208 Allure" vira "Peugeot 208 Allure" na tela do lojista.
 */
export const BOM = '﻿';
