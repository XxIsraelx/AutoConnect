import { carteiraDe } from './carteira';

describe('carteira do vendedor', () => {
  const vendedor = { id: 'v1', role: 'salesperson' };

  it('com o interruptor ligado, ninguém é restringido', () => {
    // Padrão da loja nova e de toda loja que já usava o sistema: nada muda.
    expect(carteiraDe(vendedor, true)).toEqual({});
  });

  it('desligado, o vendedor vê os próprios e os da fila', () => {
    expect(carteiraDe(vendedor, false)).toEqual({
      OR: [{ assignedTo: 'v1' }, { assignedTo: null }],
    });
  });

  it.each(['manager', 'tenant_admin', 'super_admin'])('%s continua vendo tudo', (role) => {
    expect(carteiraDe({ id: 'x', role }, false)).toEqual({});
  });

  it('sem ator identificado não inventa filtro', () => {
    // Rota interna (cron, super admin global) não tem vendedor a restringir.
    expect(carteiraDe(null, false)).toEqual({});
  });
});
