import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  digitoVerificadorDaChave,
  type CabecalhosDoEmissor, type CertificadoA1, type DadosDoEmitente, type EmitenteRegistrado,
  type NotaMontada, type PedidoDeEmissao, type ProvedorDeNotaFiscal, type RetornoDaCartaDeCorrecao,
  type RetornoDoEmissor, type StatusDaNota,
} from '@autoconnect/shared';
import { tokenConfere } from '../../cobranca/token-webhook';

/** Cabeçalho em que o emissor simulado devolve o token do webhook. */
export const CABECALHO_TOKEN_NFE = 'x-nfe-token';

/**
 * Códigos IBGE por UF — para o simulado montar uma chave de acesso real.
 * Repetidos de `chave-nfe.ts` de propósito: aquele arquivo é o contrato entre
 * as duas trilhas fiscais e ninguém o edita; aqui é só simulação.
 */
const CODIGO_DA_UF: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22',
  CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29', MG: '31', ES: '32',
  RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
};

/** Formato do webhook simulado. Nada fora deste arquivo o conhece. */
interface PayloadSimulado {
  id: string;
  evento: StatusDaNota | 'cancelamento_rejeitado';
  referencia: string;
  chave?: string | null;
  numero?: number | null;
  serie?: number | null;
  protocolo?: string | null;
  motivo?: string | null;
  ocorrido_em: string;
}

interface NotaEmMemoria {
  nota: NotaMontada;
  status: StatusDaNota;
  chave: string | null;
  numero: number | null;
  protocolo: string | null;
  motivo: string | null;
  autorizadaEm: string | null;
  cartas: number;
}

export type AcaoSimuladaDaNota = 'autorizar' | 'rejeitar' | 'denegar';

export interface EntregaSimuladaDaNota {
  cabecalhos: CabecalhosDoEmissor;
  corpo: Buffer;
}

const sha = (texto: string) => createHash('sha256').update(texto).digest('hex');

/**
 * Emissor de desenvolvimento e de teste.
 *
 * Exercita o caminho inteiro — emissão assíncrona, webhook autenticado por
 * token, idempotência, autorização com **chave de acesso válida**, XML, DANFE,
 * cancelamento — sem conta em emissor e sem falar com a SEFAZ. As notas vivem
 * em memória: reiniciar a API as perde, e a consulta passa a dizer 404.
 *
 * É sempre homologação: nada que sai daqui tem valor fiscal.
 */
export class ProvedorDeNotaSimulado implements ProvedorDeNotaFiscal {
  readonly nome = 'simulado';
  readonly disponivel = true;
  readonly homologacao = true;
  /** O simulado emite sem certificado — é o que deixa a trilha testável sem conta. */
  readonly exigeCertificado = false;

  private readonly notas = new Map<string, NotaEmMemoria>();
  private readonly ultimoNumero = new Map<string, number>();
  private entregas = 0;

  constructor(private readonly token: string) {}

  private achar(referencia: string): NotaEmMemoria {
    const n = this.notas.get(referencia);
    if (!n) throw new NotFoundException(`O emissor simulado não conhece a nota ${referencia}.`);
    return n;
  }

  private retornoDe(referencia: string, n: NotaEmMemoria): RetornoDoEmissor {
    return {
      referencia,
      situacao: n.status,
      chave: n.chave,
      numero: n.numero,
      serie: n.nota.serie,
      protocolo: n.protocolo,
      motivo: n.motivo,
      ocorridoEm: n.autorizadaEm ?? new Date().toISOString(),
    };
  }

  /**
   * Aceita qualquer arquivo em base64 com senha: o simulado não abre o PFX. O
   * que ele prova é o caminho — a conta volta, a validade é gravada, o
   * certificado não.
   */
  registrarEmitente(dados: DadosDoEmitente, certificado: CertificadoA1): Promise<EmitenteRegistrado> {
    if (!certificado.senha) return Promise.reject(new UnauthorizedException('Senha do certificado não confere.'));
    const umAno = new Date(Date.now() + 365 * 86_400_000).toISOString();
    return Promise.resolve({
      contaExterna: dados.contaExterna ?? `sim_emp_${dados.cnpj}`,
      certificadoValidoAte: umAno,
      certificadoCnpj: dados.cnpj,
    });
  }

  emitir(_emitente: unknown, { referencia, nota }: PedidoDeEmissao): Promise<RetornoDoEmissor> {
    if (!this.notas.has(referencia)) {
      this.notas.set(referencia, {
        nota, status: 'processando', chave: null, numero: null, protocolo: null, motivo: null,
        autorizadaEm: null, cartas: 0,
      });
    }
    return Promise.resolve(this.retornoDe(referencia, this.achar(referencia)));
  }

  consultar(_emitente: unknown, referencia: string): Promise<RetornoDoEmissor> {
    return Promise.resolve(this.retornoDe(referencia, this.achar(referencia)));
  }

  cancelar(_emitente: unknown, referencia: string): Promise<RetornoDoEmissor> {
    const n = this.achar(referencia);
    if (n.status !== 'autorizada') {
      return Promise.resolve({
        ...this.retornoDe(referencia, n),
        situacao: 'cancelamento_rejeitado',
        motivo: 'Nota não autorizada não pode ser cancelada',
      });
    }
    n.status = 'cancelada';
    return Promise.resolve({ ...this.retornoDe(referencia, n), ocorridoEm: new Date().toISOString() });
  }

  /** Autoriza, como a SEFAZ faria com um texto bem formado. A sequência é por nota. */
  cartaDeCorrecao(_emitente: unknown, referencia: string): Promise<RetornoDaCartaDeCorrecao> {
    const n = this.achar(referencia);
    if (n.status !== 'autorizada') {
      return Promise.resolve({
        situacao: 'rejeitada', sequencia: null, motivo: 'Nota não autorizada não recebe carta de correção',
        ocorridoEm: new Date().toISOString(),
      });
    }
    n.cartas += 1;
    return Promise.resolve({
      situacao: 'autorizada', sequencia: n.cartas, protocolo: `cce-${n.protocolo}-${n.cartas}`,
      ocorridoEm: new Date().toISOString(),
    });
  }

  baixarXml(_emitente: unknown, referencia: string): Promise<Uint8Array> {
    const n = this.achar(referencia);
    if (!n.chave) return Promise.reject(new NotFoundException('Nota sem XML: ainda não foi autorizada.'));
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<nfeProc simulado="true" versao="4.00"><NFe><infNFe Id="NFe${n.chave}">` +
      `<ide><natOp>${n.nota.natureza}</natOp><serie>${n.nota.serie}</serie><nNF>${n.numero}</nNF>` +
      `<tpAmb>2</tpAmb></ide><total><vNF>${n.nota.valorTotal}</vNF></total></infNFe></NFe>` +
      `<protNFe><infProt><chNFe>${n.chave}</chNFe><nProt>${n.protocolo}</nProt></infProt></protNFe></nfeProc>\n`;
    return Promise.resolve(Buffer.from(xml, 'utf8'));
  }

  baixarDanfe(_emitente: unknown, referencia: string): Promise<Uint8Array> {
    const n = this.achar(referencia);
    if (!n.chave) return Promise.reject(new NotFoundException('Nota sem DANFE: ainda não foi autorizada.'));
    // Um PDF mínimo e válido. O DANFE de verdade vem do emissor (N3).
    const texto = `DANFE SIMULADO - SEM VALOR FISCAL - ${n.chave}`;
    const conteudo = `BT /F1 10 Tf 40 780 Td (${texto}) Tj ET`;
    const pdf =
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R' +
      '/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
      `4 0 obj<</Length ${conteudo.length}>>stream\n${conteudo}\nendstream endobj\n` +
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
    return Promise.resolve(Buffer.from(pdf, 'latin1'));
  }

  interpretarWebhook(cabecalhos: CabecalhosDoEmissor, corpoCru: Uint8Array) {
    if (!tokenConfere(cabecalhos, CABECALHO_TOKEN_NFE, this.token)) {
      throw new UnauthorizedException('Token do webhook de nota fiscal não confere.');
    }
    const p = JSON.parse(Buffer.from(corpoCru).toString('utf8')) as PayloadSimulado;
    return {
      idDaEntrega: p.id,
      retorno: {
        referencia: p.referencia,
        situacao: p.evento,
        chave: p.chave ?? null,
        numero: p.numero ?? null,
        serie: p.serie ?? null,
        protocolo: p.protocolo ?? null,
        motivo: p.motivo ?? null,
        ocorridoEm: p.ocorrido_em,
      },
    };
  }

  /**
   * O que a SEFAZ responderia, como o emissor entregaria: muda o estado em
   * memória e devolve o webhook para passar pelo caminho real.
   */
  simular(referencia: string, acao: AcaoSimuladaDaNota): EntregaSimuladaDaNota {
    const n = this.achar(referencia);
    const agora = new Date();

    if (acao === 'autorizar') {
      const e = n.nota.emitente;
      const serieChave = `${e.cnpj}:${n.nota.serie}`;
      const numero = (this.ultimoNumero.get(serieChave) ?? 0) + 1;
      this.ultimoNumero.set(serieChave, numero);
      const aamm = `${String(agora.getUTCFullYear()).slice(2)}${String(agora.getUTCMonth() + 1).padStart(2, '0')}`;
      const codigo = String(parseInt(sha(referencia).slice(0, 8), 16) % 100_000_000).padStart(8, '0');
      const base =
        (CODIGO_DA_UF[(e.endereco.uf ?? '').toUpperCase()] ?? '35') + aamm + e.cnpj.padStart(14, '0') +
        '55' + String(n.nota.serie).padStart(3, '0') + String(numero).padStart(9, '0') + '1' + codigo;
      n.status = 'autorizada';
      n.numero = numero;
      n.chave = base + digitoVerificadorDaChave(base);
      n.protocolo = `1${aamm}${String(numero).padStart(10, '0')}`;
      n.autorizadaEm = agora.toISOString();
    } else {
      n.status = acao === 'rejeitar' ? 'rejeitada' : 'denegada';
      n.motivo = acao === 'rejeitar'
        ? '539 Rejeição simulada: duplicidade de NF-e com diferença na chave de acesso'
        : '301 Uso denegado (simulado): irregularidade fiscal do emitente';
    }

    this.entregas += 1;
    const payload: PayloadSimulado = {
      id: `sim_evt_${sha(`${referencia}:${this.entregas}`).slice(0, 20)}`,
      evento: n.status,
      referencia,
      chave: n.chave,
      numero: n.numero,
      serie: n.nota.serie,
      protocolo: n.protocolo,
      motivo: n.motivo,
      ocorrido_em: n.autorizadaEm ?? agora.toISOString(),
    };
    return {
      cabecalhos: { [CABECALHO_TOKEN_NFE]: this.token, 'content-type': 'application/json' },
      corpo: Buffer.from(JSON.stringify(payload), 'utf8'),
    };
  }
}
