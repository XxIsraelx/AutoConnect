import {
  BadRequestException, ConflictException, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import type {
  CabecalhosHttp, EnvelopeCriado, EventoDeAssinatura, NovoEnvelope,
  ProvedorDeAssinatura, SignerRoleValue, TipoEventoAssinatura,
} from '@autoconnect/shared';
import { CABECALHO_HMAC, cabecalhoHmac, hmacConfere, sha256Hex } from './hmac';

/**
 * Formato do webhook simulado. Imita o da Clicksign (evento com `name`,
 * `data.signer`, `occurred_at` e o `document.key`) para que o adaptador real
 * seja uma tradução parecida — mas é só isso: nada fora deste arquivo conhece
 * esse formato.
 */
interface PayloadSimulado {
  event: {
    name: 'sign' | 'refusal' | 'close' | 'auto_close' | 'deadline' | 'cancel' | 'upload';
    data?: { signer?: { key: string; email?: string } };
    occurred_at: string;
  };
  document: { key: string };
}

const TRADUCAO: Record<PayloadSimulado['event']['name'], TipoEventoAssinatura> = {
  sign: 'assinou',
  refusal: 'recusou',
  close: 'concluido',
  auto_close: 'concluido',
  deadline: 'expirou',
  cancel: 'cancelado',
  upload: 'ignorado',
};

interface EnvelopeEmMemoria {
  documento: Buffer;
  signatarios: { papel: SignerRoleValue; key: string; email: string; assinou: boolean }[];
  cancelado: boolean;
}

export type AcaoSimulada = 'assinar' | 'recusar' | 'expirar';

/** Uma entrega de webhook, pronta para passar pelo mesmo caminho da real. */
export interface EntregaSimulada {
  cabecalhos: CabecalhosHttp;
  corpo: Buffer;
}

/**
 * Provedor de desenvolvimento e de teste.
 *
 * Exercita o caminho completo — envelope, webhook assinado por HMAC,
 * idempotência, conclusão, PDF assinado — sem conta em provedor e sem mandar
 * e-mail a ninguém. Os envelopes vivem em memória: reiniciar a API os perde,
 * e a solicitação correspondente precisa ser cancelada e reenviada.
 *
 * Só é montado com `ASSINATURA_FORNECEDOR=simulado` fora de produção.
 */
export class ProvedorSimulado implements ProvedorDeAssinatura {
  readonly nome = 'simulado';
  readonly disponivel = true;

  private readonly envelopes = new Map<string, EnvelopeEmMemoria>();
  private readonly contagemPorHash = new Map<string, number>();

  constructor(private readonly segredo: string) {}

  criarEnvelope(e: NovoEnvelope): Promise<EnvelopeCriado> {
    const documento = Buffer.from(e.documento);
    if (sha256Hex(documento) !== e.hash) {
      // O provedor real não faria esta conferência; o simulado faz porque é
      // a forma barata de o teste provar que o PDF enviado é o da emissão.
      return Promise.reject(new BadRequestException('Documento não confere com o hash informado.'));
    }

    // Determinístico: o mesmo contrato enviado pela n-ésima vez tem sempre o
    // mesmo id, o que torna os testes reprodutíveis.
    const n = (this.contagemPorHash.get(e.hash) ?? 0) + 1;
    this.contagemPorHash.set(e.hash, n);
    const idExterno = `sim_${sha256Hex(Buffer.from(`${e.hash}:${n}`)).slice(0, 24)}`;

    const signatarios = e.signatarios.map((s) => ({
      papel: s.papel,
      key: `${idExterno}.${s.papel}`,
      email: s.email,
      assinou: false,
    }));
    this.envelopes.set(idExterno, { documento, signatarios, cancelado: false });

    return Promise.resolve({
      idExterno,
      signatarios: signatarios.map((s) => ({
        papel: s.papel,
        idExterno: s.key,
        // `.invalid` é reservado (RFC 2606): não resolve em lugar nenhum.
        urlAssinatura: `https://assinatura.simulada.invalid/${s.key}`,
      })),
    });
  }

  cancelar(idExterno: string): Promise<void> {
    const env = this.envelopes.get(idExterno);
    if (env) env.cancelado = true;
    return Promise.resolve();
  }

  /**
   * O "PDF assinado" é o original com um comentário PDF acrescentado ao fim —
   * leitores ignoram bytes depois do `%%EOF`, e o hash muda, como mudaria o
   * do documento que a Clicksign devolve com as páginas de assinatura.
   */
  baixarAssinado(idExterno: string): Promise<Uint8Array> {
    const env = this.envelopes.get(idExterno);
    if (!env) {
      return Promise.reject(new NotFoundException(
        'Envelope simulado não encontrado (a API reiniciou?). Cancele e reenvie.',
      ));
    }
    const marca = Buffer.from(`\n% AutoConnect: assinatura SIMULADA - envelope ${idExterno}\n`);
    return Promise.resolve(Buffer.concat([env.documento, marca]));
  }

  interpretarWebhook(cabecalhos: CabecalhosHttp, corpoCru: Uint8Array): EventoDeAssinatura {
    if (!hmacConfere(corpoCru, cabecalhos[CABECALHO_HMAC], this.segredo)) {
      throw new UnauthorizedException('Assinatura do webhook não confere.');
    }

    let payload: PayloadSimulado;
    try {
      payload = JSON.parse(Buffer.from(corpoCru).toString('utf8')) as PayloadSimulado;
    } catch {
      throw new BadRequestException('Corpo do webhook não é JSON.');
    }

    const nome = payload?.event?.name;
    const idExterno = payload?.document?.key;
    if (!nome || !idExterno) throw new BadRequestException('Webhook sem evento ou documento.');

    const chave = payload.event.data?.signer?.key;
    const papel = chave?.split('.').pop();

    return {
      idExterno,
      // `hasOwn`: um nome como "constructor" não pode cair no protótipo.
      tipo: Object.prototype.hasOwnProperty.call(TRADUCAO, nome) ? TRADUCAO[nome] : 'ignorado',
      idSignatarioExterno: chave,
      papel: papel === 'customer' || papel === 'dealer' ? papel : undefined,
      ocorridoEm: Number.isNaN(Date.parse(payload.event.occurred_at))
        ? new Date()
        : new Date(payload.event.occurred_at),
    };
  }

  /* ── Só do simulado ─────────────────────────────────────── */

  /** Monta uma entrega assinada com o segredo configurado, como o provedor faria. */
  entrega(payload: PayloadSimulado): EntregaSimulada {
    const corpo = Buffer.from(JSON.stringify(payload));
    return {
      corpo,
      cabecalhos: {
        'content-type': 'application/json',
        [CABECALHO_HMAC]: cabecalhoHmac(corpo, this.segredo),
      },
    };
  }

  /**
   * O que o signatário faria no provedor, devolvido como as entregas de
   * webhook que resultariam. Assinar pelo último signatário gera também o
   * `auto_close`, como na Clicksign.
   */
  simular(idExterno: string, acao: AcaoSimulada, papel?: SignerRoleValue): EntregaSimulada[] {
    const env = this.envelopes.get(idExterno);
    if (!env) {
      throw new NotFoundException(
        'Envelope simulado não encontrado (a API reiniciou?). Cancele e reenvie.',
      );
    }
    if (env.cancelado) throw new ConflictException('Envelope cancelado no provedor.');

    const agora = new Date().toISOString();
    const documento = { key: idExterno };

    if (acao === 'expirar') {
      return [this.entrega({ event: { name: 'deadline', occurred_at: agora }, document: documento })];
    }

    const signatario = env.signatarios.find((s) => s.papel === papel);
    if (!signatario) throw new BadRequestException('Informe o papel de quem assina ou recusa.');
    const data = { signer: { key: signatario.key, email: signatario.email } };

    if (acao === 'recusar') {
      return [this.entrega({ event: { name: 'refusal', data, occurred_at: agora }, document: documento })];
    }

    signatario.assinou = true;
    const entregas = [
      this.entrega({ event: { name: 'sign', data, occurred_at: agora }, document: documento }),
    ];
    if (env.signatarios.every((s) => s.assinou)) {
      entregas.push(
        this.entrega({ event: { name: 'auto_close', occurred_at: agora }, document: documento }),
      );
    }
    return entregas;
  }
}
