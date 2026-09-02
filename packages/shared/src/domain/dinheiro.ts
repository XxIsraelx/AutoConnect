/**
 * Aritmética monetária exata para os dois lados da fronteira HTTP.
 *
 * O `Decimal` do Prisma serializa como **string** em JSON, e o front não pode
 * importar o Prisma (arrastaria os binários nativos para o bundle). O caminho
 * fácil seria `parseFloat`, e é exatamente o que não se pode fazer: `0.1 + 0.2`
 * não é `0.3` em ponto flutuante, e um centavo de diferença numa comissão vira
 * ligação do vendedor.
 *
 * Como todo valor do sistema é `Decimal(14,2)`, converter para centavos
 * inteiros é exato e cabe folgado em `bigint`. Toda conta acontece em centavos;
 * a volta para string só serve para exibir ou enviar.
 */

const PADRAO = /^-?\d+(\.\d{1,2})?$/;

/**
 * Converte `"12345.67"` em `1234567n`.
 *
 * Aceita string (o que vem da API) ou número inteiro. Recusa `number` com
 * casas decimais de propósito: se o valor já chegou como float, a imprecisão
 * aconteceu antes desta função e mascará-la aqui esconderia o bug.
 */
export function emCentavos(valor: string | number): bigint {
  const texto = typeof valor === 'number' ? String(valor) : valor.trim();

  if (!PADRAO.test(texto)) {
    throw new Error(
      `Valor monetário inválido: ${JSON.stringify(valor)}. ` +
        'Esperado string decimal com até 2 casas, como "1234.56".',
    );
  }

  const negativo = texto.startsWith('-');
  const [inteira, fracao = ''] = texto.replace('-', '').split('.');
  const centavos = BigInt(inteira) * 100n + BigInt(fracao.padEnd(2, '0'));

  return negativo ? -centavos : centavos;
}

/** Volta de `1234567n` para `"12345.67"` — o formato que a API troca. */
export function deCentavos(centavos: bigint): string {
  const negativo = centavos < 0n;
  const abs = negativo ? -centavos : centavos;
  const inteira = abs / 100n;
  const fracao = (abs % 100n).toString().padStart(2, '0');

  return `${negativo ? '-' : ''}${inteira}.${fracao}`;
}

export function somar(valores: readonly (string | number)[]): string {
  return deCentavos(valores.reduce<bigint>((acc, v) => acc + emCentavos(v), 0n));
}

export function subtrair(a: string | number, b: string | number): string {
  return deCentavos(emCentavos(a) - emCentavos(b));
}

/** Comparação exata — `"100.00"` e `"100"` são o mesmo dinheiro. */
export function saoIguais(a: string | number, b: string | number): boolean {
  return emCentavos(a) === emCentavos(b);
}

/**
 * Formata para exibição. Só aqui o valor vira texto de interface.
 *
 * O `Intl` recebe a **string** decimal, não um número: a partir do ES2023 ele
 * formata strings com precisão exata, e assim o valor não passa por ponto
 * flutuante em nenhum momento do caminho.
 */
export function formatarBRL(valor: string | number): string {
  // Normaliza via centavos para recusar entrada malformada antes de exibir.
  const texto = deCentavos(emCentavos(valor));

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(texto as unknown as number);
}
