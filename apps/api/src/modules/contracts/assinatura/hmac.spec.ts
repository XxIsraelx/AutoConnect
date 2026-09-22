import { cabecalhoHmac, hmacConfere, hmacSha256Hex } from './hmac';

describe('HMAC do webhook de assinatura', () => {
  const segredo = 'segredo-de-teste';
  const corpo = Buffer.from('{"event":{"name":"sign"},"document":{"key":"abc"}}');

  it('confere o cabeçalho no formato da Clicksign (sha256=<hex>)', () => {
    expect(hmacConfere(corpo, cabecalhoHmac(corpo, segredo), segredo)).toBe(true);
  });

  it('bate com um HMAC-SHA256 calculado fora (openssl dgst -sha256 -hmac chave)', () => {
    // Vetor fixo: se alguém trocar o algoritmo ou a codificação, quebra aqui.
    expect(hmacSha256Hex(Buffer.from('abc'), 'chave')).toBe(
      '6f5d3c9c1276364e381591792d332b65a91697ee699ebc2ae226908a8cc3f232',
    );
  });

  it('aceita o hex em maiúsculas', () => {
    const cab = cabecalhoHmac(corpo, segredo).replace(/[0-9a-f]{64}$/, (h) => h.toUpperCase());
    expect(hmacConfere(corpo, cab, segredo)).toBe(true);
  });

  it('recusa corpo adulterado — um byte basta', () => {
    const cab = cabecalhoHmac(corpo, segredo);
    const adulterado = Buffer.from(corpo);
    adulterado[10] = adulterado[10]! ^ 1;

    expect(hmacConfere(adulterado, cab, segredo)).toBe(false);
  });

  it('recusa corpo reserializado (por isso a rota recebe o corpo cru)', () => {
    const cab = cabecalhoHmac(corpo, segredo);
    const reserializado = Buffer.from(JSON.stringify(JSON.parse(corpo.toString()), null, 2));

    expect(hmacConfere(reserializado, cab, segredo)).toBe(false);
  });

  it('recusa segredo errado', () => {
    expect(hmacConfere(corpo, cabecalhoHmac(corpo, 'outro-segredo'), segredo)).toBe(false);
  });

  it('recusa cabeçalho ausente, repetido ou malformado, sem lançar', () => {
    const ok = cabecalhoHmac(corpo, segredo);
    expect(hmacConfere(corpo, undefined, segredo)).toBe(false);
    expect(hmacConfere(corpo, [ok, ok], segredo)).toBe(false);
    expect(hmacConfere(corpo, ok.replace('sha256=', ''), segredo)).toBe(false);
    expect(hmacConfere(corpo, ok.replace('sha256=', 'sha1='), segredo)).toBe(false);
    expect(hmacConfere(corpo, `${ok}00`, segredo)).toBe(false);
    expect(hmacConfere(corpo, 'sha256=zz', segredo)).toBe(false);
  });

  it('hex sem prefixo só com aceitaHexPuro (x-clicksign-signature)', () => {
    const hex = hmacSha256Hex(corpo, segredo);
    expect(hmacConfere(corpo, hex, segredo)).toBe(false);
    expect(hmacConfere(corpo, hex, segredo, { aceitaHexPuro: true })).toBe(true);
    expect(hmacConfere(corpo, `sha256=${hex}`, segredo, { aceitaHexPuro: true })).toBe(true);
    expect(hmacConfere(corpo, `sha1=${hex}`, segredo, { aceitaHexPuro: true })).toBe(false);
  });

  it('sem segredo configurado, nada confere', () => {
    expect(hmacConfere(corpo, cabecalhoHmac(corpo, ''), '')).toBe(false);
  });
});
