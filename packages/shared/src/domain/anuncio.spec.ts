import {
  pendenciasParaPublicar,
  podePublicar,
  listarPendencias,
} from './anuncio';

const completo = {
  price: '54900.00',
  totalDeFotos: 3,
  color: 'Prata',
  fuel: 'flex',
  transmission: 'automatic',
};

describe('mínimo para publicar um anúncio', () => {
  it('anúncio completo não tem pendência', () => {
    expect(pendenciasParaPublicar(completo)).toEqual([]);
    expect(podePublicar(completo)).toBe(true);
  });

  it('sem foto não publica — é o que o comprador olha primeiro', () => {
    expect(pendenciasParaPublicar({ ...completo, totalDeFotos: 0 })).toEqual([
      'pelo menos uma foto',
    ]);
  });

  it('preço zero é ausência de preço, não preço de graça', () => {
    expect(pendenciasParaPublicar({ ...completo, price: '0.00' })).toEqual([
      'preço de venda',
    ]);
    expect(pendenciasParaPublicar({ ...completo, price: null })).toEqual([
      'preço de venda',
    ]);
  });

  it('aceita o preço em número, string ou Decimal serializado', () => {
    for (const price of [54900, '54900', '54900.00']) {
      expect(podePublicar({ ...completo, price })).toBe(true);
    }
  });

  it('cor em branco não conta como preenchida', () => {
    expect(pendenciasParaPublicar({ ...completo, color: '   ' })).toEqual(['cor']);
  });

  it('acumula tudo o que falta, para a tela dizer de uma vez só', () => {
    expect(
      pendenciasParaPublicar({
        price: null,
        totalDeFotos: 0,
        color: null,
        fuel: null,
        transmission: null,
      }),
    ).toEqual(['pelo menos uma foto', 'preço de venda', 'cor', 'combustível', 'câmbio']);
  });

  it('a frase de pendências é legível para o lojista', () => {
    expect(listarPendencias([])).toBe('');
    expect(listarPendencias(['cor'])).toBe('cor');
    expect(listarPendencias(['pelo menos uma foto', 'cor'])).toBe(
      'pelo menos uma foto e cor',
    );
    expect(listarPendencias(['pelo menos uma foto', 'preço de venda', 'cor'])).toBe(
      'pelo menos uma foto, preço de venda e cor',
    );
  });
});
