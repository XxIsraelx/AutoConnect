import { Logger, UnauthorizedException } from '@nestjs/common';
import type {
  CabecalhosDeWhatsApp,
  EnvioDeModelo,
  EnvioDeTexto,
  EventoDeWhatsApp,
  ProvedorDeWhatsApp,
} from '@autoconnect/shared';
import { hmacConfere } from '../contracts/assinatura/hmac';
import {
  CABECALHO_ASSINATURA_META,
  corpoDeModelo,
  corpoDeTexto,
  interpretarEntregaDaMeta,
  responderDesafioDaMeta,
} from './formato-meta';
import { RecusaDoWhatsApp } from './recusa';

export interface ConfigDaMeta {
  /** `https://graph.facebook.com/v21.0` — com a versão, sem barra no fim. */
  graphUrl: string;
  /** Token do usuário de sistema do app, com acesso às contas das lojas. */
  token: string;
  /** Segredo do app: assina cada entrega do webhook. */
  segredoDoApp: string;
  /** O que a Meta manda no desafio de cadastro do webhook. */
  tokenDeVerificacao: string;
  /** Injetável nos testes. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * API de nuvem do WhatsApp (Meta).
 *
 * ⚠ **Ainda não falou com a Meta**: escrito pela documentação e exercitado com
 * `fetch` de mentira (`provedor-meta.spec.ts`). O que conferir com a conta em
 * mãos está no fim da decisão (`docs/decisoes/2026-09-27 whatsapp oficial.md`).
 *
 * Um token só, da plataforma: o app do AutoConnect é o provedor de tecnologia
 * e o número de cada loja é compartilhado com ele (cadastro incorporado). A
 * loja não entrega credencial nenhuma — o vínculo dela é o id do número.
 */
export class ProvedorMetaDeWhatsApp implements ProvedorDeWhatsApp {
  readonly nome = 'meta';
  readonly disponivel = true;
  private readonly log = new Logger('WhatsApp/Meta');
  private readonly buscar: typeof fetch;

  constructor(private readonly cfg: ConfigDaMeta) {
    this.buscar = cfg.fetch ?? fetch;
  }

  enviarTexto(envio: EnvioDeTexto): Promise<{ idExterno: string }> {
    return this.enviar(envio.conta, corpoDeTexto(envio.para, envio.texto));
  }

  enviarModelo(envio: EnvioDeModelo): Promise<{ idExterno: string }> {
    return this.enviar(envio.conta, corpoDeModelo(envio.para, envio.modelo, envio.idioma, envio.parametros));
  }

  private async enviar(conta: string, corpo: object): Promise<{ idExterno: string }> {
    const url = `${this.cfg.graphUrl.replace(/\/+$/, '')}/${encodeURIComponent(conta)}/messages`;

    let resposta: Response;
    try {
      resposta = await this.buscar(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
      });
    } catch (err) {
      this.log.warn(`Sem resposta da Meta ao enviar pela conta ${conta}: ${err}`);
      throw new RecusaDoWhatsApp('Sem resposta do WhatsApp. Tente enviar de novo em instantes.');
    }

    const dados = (await resposta.json().catch(() => null)) as {
      messages?: { id?: string }[];
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    } | null;

    if (!resposta.ok) {
      const erro = dados?.error;
      const motivo = [erro?.code, erro?.error_data?.details ?? erro?.message]
        .filter((p) => p !== undefined && p !== null && p !== '')
        .join(': ');
      // 190 é credencial: problema da plataforma, não do vendedor nem do
      // cliente — vai para o log com destaque, e a tela diz só que falhou.
      if (erro?.code === 190) this.log.error(`Token do WhatsApp recusado pela Meta: ${erro.message}`);
      throw new RecusaDoWhatsApp(motivo || `A Meta recusou a mensagem (HTTP ${resposta.status}).`);
    }

    const id = dados?.messages?.[0]?.id;
    if (!id) throw new RecusaDoWhatsApp('A Meta aceitou a mensagem mas não devolveu o id dela.');
    return { idExterno: id };
  }

  interpretarWebhook(cabecalhos: CabecalhosDeWhatsApp, corpo: Uint8Array): EventoDeWhatsApp[] {
    if (!hmacConfere(corpo, cabecalhos[CABECALHO_ASSINATURA_META], this.cfg.segredoDoApp)) {
      throw new UnauthorizedException('Assinatura do webhook não confere.');
    }
    try {
      return interpretarEntregaDaMeta(JSON.parse(Buffer.from(corpo).toString('utf8')));
    } catch {
      return [];
    }
  }

  responderDesafio(consulta: Record<string, unknown>): string | null {
    return responderDesafioDaMeta(consulta, this.cfg.tokenDeVerificacao);
  }
}
