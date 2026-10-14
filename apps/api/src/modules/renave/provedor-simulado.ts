import {
  BadRequestException, ConflictException, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import type {
  EventoDoRenave, PedidoDeEntradaRenave, PedidoDeSaidaRenave, ProvedorDeRenave,
  RespostaDoRenave, TipoDeEventoRenave,
} from '@autoconnect/shared';
import { CABECALHO_HMAC, cabecalhoHmac, hmacConfere, sha256Hex } from '../contracts/assinatura/hmac';

/**
 * Código de segurança que o simulado recusa na hora — o caso do veículo
 * "inapto" (roubo, restrição judicial) que o RENAVE devolve sem passar pelo
 * Detran. Só existe para os testes e para a demonstração.
 */
export const CODIGO_RECUSADO_NO_SIMULADO = '00000000000';

/** A chave de API que a integradora simulada aceita: `sim_` e ao menos 12 caracteres. */
export function chaveSimuladaValida(credencial: string | null | undefined): boolean {
  return typeof credencial === 'string' && credencial.startsWith('sim_') && credencial.length >= 12;
}

/**
 * Formato do webhook simulado. Não é o de integradora nenhuma — nada fora deste
 * arquivo o conhece, e o adaptador real (R3) traduz o dele.
 */
interface PayloadSimulado {
  id: string;
  evento: 'estoque.confirmado' | 'estoque.recusado' | 'estoque.cancelado' | 'atpv.disponivel' | 'outro';
  operacao: string;
  protocolo?: string;
  motivo?: string;
  em: string;
}

const TRADUCAO: Record<PayloadSimulado['evento'], TipoDeEventoRenave> = {
  'estoque.confirmado': 'confirmado',
  'estoque.recusado': 'recusado',
  'estoque.cancelado': 'cancelado',
  'atpv.disponivel': 'atpv_disponivel',
  outro: 'ignorado',
};

interface OperacaoEmMemoria {
  idExterno: string;
  saida: boolean;
  status: RespostaDoRenave['status'];
  protocolo: string | null;
  motivo: string | null;
  chaveNfe?: string;
}

export interface EntregaSimulada {
  cabecalhos: Record<string, string>;
  corpo: Buffer;
}

/**
 * Integradora de desenvolvimento e de teste.
 *
 * Imita o que o manual do RENAVE descreve: o pedido é aceito na hora e fica
 * **pendente** até o Detran consentir; a confirmação chega depois, por webhook
 * (assinado por HMAC) ou por consulta. O veículo inapto é recusado na hora.
 * Idempotente pela chave do pedido: reenviar devolve a mesma operação.
 *
 * Vive em memória — reiniciar a API perde as operações, e a consulta passa a
 * responder 404, como responderia uma integradora que não conhece o id.
 */
export class ProvedorRenaveSimulado implements ProvedorDeRenave {
  readonly nome = 'simulado';
  readonly disponivel = true;
  readonly sandbox = true;
  /**
   * Exige, como a integradora real que a loja paga: é o que faz a suíte passar
   * pelo cofre em todo envio, em vez de testar um caminho que a produção não usa.
   */
  readonly exigeCredencialDaLoja = true;

  private readonly operacoes = new Map<string, OperacaoEmMemoria>();
  private readonly porChave = new Map<string, string>();
  private eventos = 0;

  constructor(private readonly segredo: string) {}

  /** Aceita chave que começa com `sim_` e tem ao menos 12 caracteres. */
  verificarCredencial(credencial: string): Promise<boolean> {
    return Promise.resolve(chaveSimuladaValida(credencial));
  }

  /** A integradora recusa a chamada sem chave válida — 401, como uma real. */
  private exigirChave(credencial: string | null): void {
    if (!chaveSimuladaValida(credencial)) {
      throw new UnauthorizedException('Chave da integradora recusada (simulação).');
    }
  }

  private registrar(chave: string, codigo: string, saida: boolean): Promise<RespostaDoRenave> {
    const existente = this.porChave.get(chave);
    if (existente) return Promise.resolve(this.resposta(this.operacoes.get(existente)!));

    const idExterno = `sim_${sha256Hex(Buffer.from(chave)).slice(0, 20)}`;
    const recusado = codigo === CODIGO_RECUSADO_NO_SIMULADO;
    const op: OperacaoEmMemoria = {
      idExterno,
      saida,
      status: recusado ? 'recusado' : 'pendente',
      protocolo: null,
      motivo: recusado ? 'Veículo não está apto (simulação: código de segurança recusado).' : null,
    };
    this.operacoes.set(idExterno, op);
    this.porChave.set(chave, idExterno);
    return Promise.resolve(this.resposta(op));
  }

  private resposta(op: OperacaoEmMemoria): RespostaDoRenave {
    return { idExterno: op.idExterno, status: op.status, protocolo: op.protocolo, motivo: op.motivo };
  }

  private exigir(idExterno: string): OperacaoEmMemoria {
    const op = this.operacoes.get(idExterno);
    if (!op) throw new NotFoundException('Operação simulada não encontrada (a API reiniciou?).');
    return op;
  }

  registrarEntrada(p: PedidoDeEntradaRenave, credencial: string | null): Promise<RespostaDoRenave> {
    try { this.exigirChave(credencial); } catch (e) { return Promise.reject(e); }
    return this.registrar(p.chaveDeIdempotencia, p.veiculo.codigoSegurancaCrv, false);
  }

  registrarSaida(p: PedidoDeSaidaRenave, credencial: string | null): Promise<RespostaDoRenave> {
    try { this.exigirChave(credencial); } catch (e) { return Promise.reject(e); }
    return this.registrar(p.chaveDeIdempotencia, p.veiculo.codigoSegurancaCrv, true);
  }

  cancelar(idExterno: string, _motivo: string, credencial: string | null): Promise<RespostaDoRenave> {
    try {
      this.exigirChave(credencial);
      const op = this.exigir(idExterno);
      op.status = 'cancelado';
      return Promise.resolve(this.resposta(op));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  consultar(idExterno: string, credencial: string | null): Promise<RespostaDoRenave> {
    try {
      this.exigirChave(credencial);
      return Promise.resolve(this.resposta(this.exigir(idExterno)));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /** O manual só aceita a NF-e de operação que existe e não foi cancelada. */
  informarNotaFiscal(idExterno: string, chaveNfe: string, credencial: string | null): Promise<void> {
    try {
      this.exigirChave(credencial);
      const op = this.exigir(idExterno);
      if (op.status === 'cancelado' || op.status === 'recusado') {
        throw new ConflictException(`Operação simulada está ${op.status}: não recebe NF-e.`);
      }
      op.chaveNfe = chaveNfe;
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /** Um "PDF" mínimo, marcado como simulado — só existe para a saída confirmada. */
  baixarAtpv(idExterno: string, credencial: string | null): Promise<Uint8Array | null> {
    if (!chaveSimuladaValida(credencial)) {
      return Promise.reject(new UnauthorizedException('Chave da integradora recusada (simulação).'));
    }
    const op = this.operacoes.get(idExterno);
    if (!op || !op.saida || op.status !== 'confirmado') return Promise.resolve(null);
    return Promise.resolve(Buffer.from(
      `%PDF-1.4\n% ATPV-e SIMULADO - sem valor - operacao ${idExterno}\n%%EOF\n`,
    ));
  }

  interpretarWebhook(
    cabecalhos: Record<string, string | string[] | undefined>,
    corpoCru: Uint8Array,
  ): EventoDoRenave {
    if (!hmacConfere(corpoCru, cabecalhos[CABECALHO_HMAC], this.segredo)) {
      throw new UnauthorizedException('Assinatura do webhook não confere.');
    }

    let p: PayloadSimulado;
    try {
      p = JSON.parse(Buffer.from(corpoCru).toString('utf8')) as PayloadSimulado;
    } catch {
      throw new BadRequestException('Corpo do webhook não é JSON.');
    }
    if (!p?.operacao || !p?.evento) throw new BadRequestException('Webhook sem operação ou evento.');

    return {
      idExterno: p.operacao,
      idEvento: p.id ?? null,
      // `hasOwn`: um nome como "constructor" não pode cair no protótipo.
      tipo: Object.prototype.hasOwnProperty.call(TRADUCAO, p.evento) ? TRADUCAO[p.evento] : 'ignorado',
      protocolo: p.protocolo ?? null,
      motivo: p.motivo ?? null,
      ocorridoEm: Number.isNaN(Date.parse(p.em)) ? new Date() : new Date(p.em),
    };
  }

  /* ── Só do simulado ─────────────────────────────────────── */

  /** Monta uma entrega assinada com o segredo configurado, como a integradora faria. */
  entrega(payload: Omit<PayloadSimulado, 'id' | 'em'> & { id?: string }): EntregaSimulada {
    const corpo = Buffer.from(JSON.stringify({
      id: payload.id ?? `evt_${++this.eventos}`,
      em: new Date().toISOString(),
      ...payload,
    }));
    return {
      corpo,
      cabecalhos: { 'content-type': 'application/json', [CABECALHO_HMAC]: cabecalhoHmac(corpo, this.segredo) },
    };
  }

  /**
   * O que o Detran faria: consentir ou recusar a operação pendente. Muda o
   * estado em memória (a consulta passa a ver) e devolve as entregas de webhook
   * que a integradora mandaria — a confirmação de saída traz junto o ATPV-e.
   */
  simular(idExterno: string, acao: 'confirmar' | 'recusar'): EntregaSimulada[] {
    const op = this.exigir(idExterno);
    if (op.status !== 'pendente') throw new ConflictException(`Operação simulada já está ${op.status}.`);

    if (acao === 'recusar') {
      op.status = 'recusado';
      op.motivo = 'Detran não consentiu (simulação).';
      return [this.entrega({ evento: 'estoque.recusado', operacao: idExterno, motivo: op.motivo })];
    }

    op.status = 'confirmado';
    op.protocolo = `SIM-${idExterno.slice(4, 14).toUpperCase()}`;
    const entregas = [this.entrega({ evento: 'estoque.confirmado', operacao: idExterno, protocolo: op.protocolo })];
    if (op.saida) entregas.push(this.entrega({ evento: 'atpv.disponivel', operacao: idExterno }));
    return entregas;
  }
}
