import { deflateRawSync } from 'zlib';

/**
 * Um ZIP mínimo, só de escrita, com o `zlib` do Node — para o pacote de XMLs
 * que vai ao contador (trilha fiscal, N4).
 *
 * Existe em vez de uma dependência porque o formato que precisamos é pequeno e
 * estável (PKWARE APPNOTE 6.3): entradas com deflate, nomes em UTF-8, um
 * diretório central e o registro de fim. Sem ZIP64 — o teto de entradas e de
 * tamanho abaixo fica muito longe dos 4 GiB / 65 535 entradas que exigiriam ele.
 */

export interface EntradaDoZip {
  /** Caminho dentro do ZIP, com `/`. Sem `..` nem barra inicial. */
  nome: string;
  conteudo: Buffer;
}

/** Bem abaixo do limite de 65 535 do ZIP sem ZIP64. */
export const TETO_DE_ENTRADAS_DO_ZIP = 5000;

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(dados: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Data e hora no formato do DOS, que é o que o cabeçalho do ZIP guarda. */
function dataDos(d: Date): { hora: number; data: number } {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    data: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function nomeSeguro(nome: string): string {
  const limpo = nome.replace(/\\/g, '/');
  if (!limpo || limpo.startsWith('/') || limpo.split('/').includes('..')) {
    throw new Error(`Nome de entrada inválido no ZIP: ${JSON.stringify(nome)}`);
  }
  return limpo;
}

export function montarZip(entradas: readonly EntradaDoZip[], quando = new Date()): Buffer {
  if (entradas.length > TETO_DE_ENTRADAS_DO_ZIP) {
    throw new Error(`ZIP com ${entradas.length} entradas passa do teto de ${TETO_DE_ENTRADAS_DO_ZIP}.`);
  }
  const { hora, data } = dataDos(quando);
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  const vistos = new Set<string>();
  let deslocamento = 0;

  for (const e of entradas) {
    const nome = Buffer.from(nomeSeguro(e.nome), 'utf8');
    if (vistos.has(nome.toString())) throw new Error(`Entrada repetida no ZIP: ${e.nome}`);
    vistos.add(nome.toString());

    const comprimido = deflateRawSync(e.conteudo);
    const crc = crc32(e.conteudo);
    // Bit 11: nome em UTF-8 — acento no nome do arquivo não vira lixo no Windows.
    const flags = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão para extrair: 2.0 (deflate)
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(e.conteudo.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // feito por: 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(data, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(e.conteudo.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(deslocamento, 42);

    locais.push(local, nome, comprimido);
    centrais.push(central, nome);
    deslocamento += local.length + nome.length + comprimido.length;
  }

  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);

  return Buffer.concat([...locais, diretorio, fim]);
}
