import { inflateRawSync } from 'zlib';
import { crc32, montarZip } from './zip';

/** Leitor mínimo, só para o teste: percorre o diretório central e descomprime. */
function lerZip(zip: Buffer): Map<string, Buffer> {
  const fim = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const saida = new Map<string, Buffer>();
  for (let i = 0; i < total; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(p + 16);
    const tamanho = zip.readUInt32LE(p + 20);
    const nomeLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const nome = zip.subarray(p + 46, p + 46 + nomeLen).toString('utf8');
    const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const conteudo = inflateRawSync(zip.subarray(inicio, inicio + tamanho));
    expect(crc32(conteudo)).toBe(crc);
    saida.set(nome, conteudo);
    p += 46 + nomeLen;
  }
  return saida;
}

describe('montarZip', () => {
  it('CRC-32 bate com o valor de referência', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('o que entra sai igual, com nome acentuado e pasta', () => {
    const xml = Buffer.from('<?xml version="1.0"?><nfeProc>' + 'x'.repeat(5000) + '</nfeProc>');
    const zip = montarZip([
      { nome: 'notas.csv', conteudo: Buffer.from('chave;valor\n1;2\n') },
      { nome: 'xml/saída/NFe352610.xml', conteudo: xml },
      { nome: 'vazio.txt', conteudo: Buffer.alloc(0) },
    ]);
    expect(zip.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');
    const lido = lerZip(zip);
    expect([...lido.keys()]).toEqual(['notas.csv', 'xml/saída/NFe352610.xml', 'vazio.txt']);
    expect(lido.get('xml/saída/NFe352610.xml')!.equals(xml)).toBe(true);
    expect(lido.get('vazio.txt')!.length).toBe(0);
    // XML repetitivo comprime: o ZIP é bem menor que o conteúdo.
    expect(zip.length).toBeLessThan(xml.length / 5);
  });

  it('ZIP sem entradas ainda é um ZIP válido', () => {
    expect(lerZip(montarZip([])).size).toBe(0);
  });

  it.each(['../fora.xml', '/absoluto.xml', 'a/../../b.xml', ''])('recusa nome perigoso %p', (nome) => {
    expect(() => montarZip([{ nome, conteudo: Buffer.from('x') }])).toThrow(/inválido/);
  });

  it('recusa entrada repetida', () => {
    const e = { nome: 'a.xml', conteudo: Buffer.from('x') };
    expect(() => montarZip([e, e])).toThrow(/repetida/);
  });
});
