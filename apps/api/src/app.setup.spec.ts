import { origensPermitidas } from './app.setup';

/**
 * A virada para o domínio próprio (27/09/2026) mostrou o buraco: o CORS aceitava
 * só a `WEB_URL`. O site responde na raiz e no `www`, e quem entrasse pelo outro
 * endereço veria a tela montar sem nenhuma chamada funcionar.
 */
describe('origensPermitidas', () => {
  it('aceita o irmão www quando a WEB_URL é a raiz', () => {
    const o = origensPermitidas('https://autoconnectapp.com.br', '');
    expect(o).toContain('https://autoconnectapp.com.br');
    expect(o).toContain('https://www.autoconnectapp.com.br');
  });

  it('aceita a raiz quando a WEB_URL é o www', () => {
    const o = origensPermitidas('https://www.autoconnectapp.com.br', '');
    expect(o).toContain('https://autoconnectapp.com.br');
  });

  it('aceita os endereços extras da transição, sem barra no fim', () => {
    const o = origensPermitidas('https://autoconnectapp.com.br', 'https://antigo.up.railway.app/, https://outro.app');
    expect(o).toContain('https://antigo.up.railway.app');
    expect(o).toContain('https://outro.app');
  });

  it('não duplica e mantém o localhost do desenvolvimento', () => {
    const o = origensPermitidas('http://localhost:3000', '');
    expect(o.filter((x) => x === 'http://localhost:3000')).toHaveLength(1);
    expect(o).toContain('http://127.0.0.1:3000');
  });

  it('WEB_URL malformada não derruba a lista', () => {
    expect(() => origensPermitidas('nao-e-url', '')).not.toThrow();
  });
});
