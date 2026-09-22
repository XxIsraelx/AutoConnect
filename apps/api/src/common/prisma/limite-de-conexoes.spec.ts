import { comLimiteDeConexoes } from './limite-de-conexoes';

describe('comLimiteDeConexoes', () => {
  it('acrescenta o teto quando a URL não tem parâmetros', () => {
    expect(comLimiteDeConexoes('postgresql://u:p@h:5432/db', 3)).toBe(
      'postgresql://u:p@h:5432/db?connection_limit=3',
    );
  });

  it('acrescenta com & quando já há parâmetros', () => {
    expect(comLimiteDeConexoes('postgresql://u:p@h:6543/db?pgbouncer=true', 6)).toBe(
      'postgresql://u:p@h:6543/db?pgbouncer=true&connection_limit=6',
    );
  });

  it('respeita um connection_limit já definido na URL', () => {
    const url = 'postgresql://u:p@h:5432/db?connection_limit=10';
    expect(comLimiteDeConexoes(url, 3)).toBe(url);
  });

  it('deixa URL ausente como está', () => {
    expect(comLimiteDeConexoes(undefined, 3)).toBeUndefined();
  });
});
