/**
 * O link que abre um veículo no catálogo público.
 *
 * ## Por que isto é um módulo
 *
 * A vitrine da loja (`c/[slug]`) linkava para `/catalogo/<loja>?vehicleId=<id>`
 * e o catálogo lia **`?v=`**. Clicar no carro na vitrine abria a lista, não o
 * carro — e o `/buscar`, que já usava `?v=`, funcionava. Duas telas, dois nomes
 * para a mesma coisa, e nenhum jeito de o compilador notar.
 *
 * Agora quem monta o link e quem o lê são o mesmo arquivo. `PARAM_VEICULO` é o
 * nome canônico; `PARAMS_ACEITOS` existe porque **link compartilhado já está
 * por aí** — o `?vehicleId=` de um WhatsApp de ontem continua abrindo o carro.
 */

/** O nome canônico do parâmetro. Curto porque o link é compartilhado à mão. */
export const PARAM_VEICULO = 'v';

/**
 * Nomes aceitos na leitura, em ordem de prioridade. O segundo é o legado da
 * vitrine — mantido para não quebrar link que já circula, não para ser usado.
 */
export const PARAMS_ACEITOS = [PARAM_VEICULO, 'vehicleId'] as const;

/** `/catalogo/<loja>?v=<veículo>` — o único jeito de montar o link. */
export function linkDoVeiculoNoCatalogo(tenantId: string, vehicleId: string): string {
  return `/catalogo/${tenantId}?${PARAM_VEICULO}=${encodeURIComponent(vehicleId)}`;
}

/**
 * O id do veículo que a URL pede, ou `null`.
 *
 * Aceita a query com ou sem `?`, o que é o que `window.location.search` entrega
 * nos dois casos (vazio ou `?a=b`).
 */
export function veiculoDaBusca(busca: string | URLSearchParams): string | null {
  const params =
    typeof busca === 'string' ? new URLSearchParams(busca.replace(/^\?/, '')) : busca;

  for (const nome of PARAMS_ACEITOS) {
    const valor = params.get(nome)?.trim();
    if (valor) return valor;
  }
  return null;
}
