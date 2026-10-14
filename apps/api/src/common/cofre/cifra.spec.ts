import { randomBytes } from 'crypto';
import { cifrar, decifrar, lerChavesMestras, ultimos4 } from './cifra';

const chave = randomBytes(32);
const aad = 'loja-a:integrarenave:v1';

describe('cifra do cofre', () => {
  it('abre o que cifrou', () => {
    const c = cifrar('ir_live_segredo_da_loja', chave, aad);
    expect(decifrar(c, chave, aad)).toBe('ir_live_segredo_da_loja');
  });

  it('o texto não aparece na cifra, e a mesma chave cifrada duas vezes dá resultados diferentes', () => {
    const a = cifrar('ir_live_segredo_da_loja', chave, aad);
    const b = cifrar('ir_live_segredo_da_loja', chave, aad);
    expect(a.cifra.toString('utf8')).not.toContain('segredo');
    expect(a.cifra.equals(b.cifra)).toBe(false);
  });

  it('copiada para a linha de outra loja, não abre', () => {
    const c = cifrar('ir_live_segredo_da_loja', chave, aad);
    expect(() => decifrar(c, chave, 'loja-b:integrarenave:v1')).toThrow();
  });

  it('com a chave-mestra errada ou adulterada, falha alto em vez de abrir lixo', () => {
    const c = cifrar('ir_live_segredo_da_loja', chave, aad);
    expect(() => decifrar(c, randomBytes(32), aad)).toThrow();
    const adulterada = { ...c, cifra: Buffer.from(c.cifra.map((b, i) => (i === 0 ? b ^ 1 : b))) };
    expect(() => decifrar(adulterada, chave, aad)).toThrow();
  });

  it('mostra só os 4 últimos caracteres', () => {
    expect(ultimos4('ir_live_abcdwxyz')).toBe('wxyz');
  });
});

describe('lerChavesMestras', () => {
  const b64 = () => randomBytes(32).toString('base64');

  it('cifra com a versão mais alta e abre com todas', () => {
    const r = lerChavesMestras(`1:${b64()}, 2:${b64()}`);
    expect('erro' in r).toBe(false);
    if (!('erro' in r)) {
      expect(r.atual).toBe(2);
      expect([...r.porVersao.keys()]).toEqual([1, 2]);
    }
  });

  it.each([
    [undefined, /ausente/],
    ['', /ausente/],
    ['sem-versao', /formato/],
    [`1:${randomBytes(16).toString('base64')}`, /32 bytes/],
    [`0:${randomBytes(32).toString('base64')}`, /começa em 1/],
  ])('recusa %p', (bruta, motivo) => {
    const r = lerChavesMestras(bruta as string | undefined);
    expect('erro' in r && r.erro).toMatch(motivo);
  });
});
