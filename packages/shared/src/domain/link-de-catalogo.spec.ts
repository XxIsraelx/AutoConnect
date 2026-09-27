import {
  PARAM_VEICULO,
  linkDoVeiculoNoCatalogo,
  veiculoDaBusca,
} from './link-de-catalogo';

/**
 * B14 do piloto do primeiro dia: a vitrine da loja montava `?vehicleId=` e o
 * catálogo lia `?v=`. O carro clicado não abria.
 */
describe('link do veículo no catálogo', () => {
  const loja = '11111111-1111-1111-1111-111111111111';
  const carro = '22222222-2222-2222-2222-222222222222';

  it('monta o link com o parâmetro canônico', () => {
    expect(linkDoVeiculoNoCatalogo(loja, carro)).toBe(`/catalogo/${loja}?v=${carro}`);
  });

  it('o que se monta é o que se lê — ida e volta', () => {
    const url = new URL(`https://exemplo.test${linkDoVeiculoNoCatalogo(loja, carro)}`);
    expect(veiculoDaBusca(url.search)).toBe(carro);
  });

  it('aceita o `?vehicleId=` antigo, porque o link já foi compartilhado', () => {
    expect(veiculoDaBusca(`?vehicleId=${carro}`)).toBe(carro);
  });

  it('o canônico ganha quando os dois vêm juntos', () => {
    expect(veiculoDaBusca(`?vehicleId=antigo&${PARAM_VEICULO}=${carro}`)).toBe(carro);
  });

  it('sem parâmetro, sem veículo — e nada explode com busca vazia', () => {
    expect(veiculoDaBusca('')).toBeNull();
    expect(veiculoDaBusca('?')).toBeNull();
    expect(veiculoDaBusca('?q=onix')).toBeNull();
    // Valor vazio é ausência, não um id em branco que viraria uma consulta.
    expect(veiculoDaBusca('?v=%20')).toBeNull();
  });

  it('aceita URLSearchParams direto, que é o que a tela tem em mãos', () => {
    expect(veiculoDaBusca(new URLSearchParams({ v: carro }))).toBe(carro);
  });
});
