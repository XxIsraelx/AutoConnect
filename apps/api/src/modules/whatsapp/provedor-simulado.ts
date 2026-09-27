import { randomUUID } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import type {
  CabecalhosDeWhatsApp,
  EnvioDeModelo,
  EnvioDeTexto,
  EventoDeWhatsApp,
  ProvedorDeWhatsApp,
} from '@autoconnect/shared';
import { cabecalhoHmac, hmacConfere } from '../contracts/assinatura/hmac';
import {
  CABECALHO_ASSINATURA_META,
  interpretarEntregaDaMeta,
  montarEntregaDaMeta,
  responderDesafioDaMeta,
} from './formato-meta';
import { RecusaDoWhatsApp } from './recusa';

export type EnvioRegistrado =
  | ({ tipo: 'texto'; idExterno: string } & EnvioDeTexto)
  | ({ tipo: 'modelo'; idExterno: string } & EnvioDeModelo);

/**
 * WhatsApp em memória, para desenvolvimento e testes. **Recusado em produção**
 * pela fábrica.
 *
 * Não inventa formato: o webhook que ele gera é o da Meta, assinado com o
 * mesmo segredo, e passa pelo mesmo tradutor (`formato-meta.ts`) e pela mesma
 * conferência de HMAC que o adaptador real. O que o teste com o simulado prova
 * vale para a produção, exceto a chamada de rede.
 */
export class ProvedorSimuladoDeWhatsApp implements ProvedorDeWhatsApp {
  readonly nome = 'simulado';
  readonly disponivel = true;

  /** O que teria saído deste servidor, na ordem. */
  readonly enviados: EnvioRegistrado[] = [];
  private readonly recusas: string[] = [];

  constructor(
    private readonly segredo: string,
    private readonly tokenDeVerificacao: string,
  ) {}

  /** O próximo envio é recusado com este motivo — o caminho da falha. */
  recusarProximo(motivo: string): void {
    this.recusas.push(motivo);
  }

  private idsFixos: string[] = [];

  /**
   * O próximo envio devolve este id. Existe para o caso em que o aviso de
   * entrega chega pelo webhook **antes** de o envio voltar — o teste manda o
   * aviso de um id que ainda não existe e confere que ele é reaplicado.
   */
  usarIdNoProximoEnvio(id: string): void {
    this.idsFixos.push(id);
  }

  enviarTexto(envio: EnvioDeTexto): Promise<{ idExterno: string }> {
    return this.registrar({ tipo: 'texto', ...envio });
  }

  enviarModelo(envio: EnvioDeModelo): Promise<{ idExterno: string }> {
    return this.registrar({ tipo: 'modelo', ...envio });
  }

  private async registrar(
    envio: Omit<Extract<EnvioRegistrado, { tipo: 'texto' }>, 'idExterno'>
      | Omit<Extract<EnvioRegistrado, { tipo: 'modelo' }>, 'idExterno'>,
  ): Promise<{ idExterno: string }> {
    const motivo = this.recusas.shift();
    if (motivo) throw new RecusaDoWhatsApp(motivo);
    const idExterno = this.idsFixos.shift() ?? `wamid.SIM.${randomUUID()}`;
    this.enviados.push({ ...envio, idExterno } as EnvioRegistrado);
    return { idExterno };
  }

  interpretarWebhook(cabecalhos: CabecalhosDeWhatsApp, corpo: Uint8Array): EventoDeWhatsApp[] {
    if (!hmacConfere(corpo, cabecalhos[CABECALHO_ASSINATURA_META], this.segredo)) {
      throw new UnauthorizedException('Assinatura do webhook não confere.');
    }
    try {
      return interpretarEntregaDaMeta(JSON.parse(Buffer.from(corpo).toString('utf8')));
    } catch {
      return [];
    }
  }

  responderDesafio(consulta: Record<string, unknown>): string | null {
    return responderDesafioDaMeta(consulta, this.tokenDeVerificacao);
  }

  /** A entrega que a Meta mandaria para estes eventos, assinada. */
  entrega(eventos: EventoDeWhatsApp[]): { corpo: Buffer; cabecalhos: Record<string, string> } {
    const corpo = Buffer.from(JSON.stringify(montarEntregaDaMeta(eventos)), 'utf8');
    return { corpo, cabecalhos: { [CABECALHO_ASSINATURA_META]: cabecalhoHmac(corpo, this.segredo) } };
  }
}
