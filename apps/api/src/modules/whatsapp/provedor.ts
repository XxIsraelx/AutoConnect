import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EventoDeWhatsApp, ProvedorDeWhatsApp } from '@autoconnect/shared';
import { ProvedorSimuladoDeWhatsApp } from './provedor-simulado';
import { ProvedorMetaDeWhatsApp } from './provedor-meta';

export { RecusaDoWhatsApp } from './recusa';

export const PROVEDOR_DE_WHATSAPP = Symbol('ProvedorDeWhatsApp');

const INDISPONIVEL =
  'O WhatsApp oficial não está configurado neste servidor. ' +
  'Continue pelo chat do sistema ou pelo botão do WhatsApp do lead.';

/**
 * Provedor ausente — a chave de liga/desliga da funcionalidade, sem feature
 * flag: a API recusa com 503 e a tela esconde a opção.
 *
 * O webhook também recusa: sem provedor não há segredo para conferir a
 * assinatura, e aceitar evento sem conferir deixaria qualquer um escrever na
 * caixa de entrada de qualquer loja.
 */
export class ProvedorIndisponivelDeWhatsApp implements ProvedorDeWhatsApp {
  readonly nome = 'nenhum';
  readonly disponivel = false;

  enviarTexto(): Promise<{ idExterno: string }> {
    return Promise.reject(new ServiceUnavailableException(INDISPONIVEL));
  }

  enviarModelo(): Promise<{ idExterno: string }> {
    return Promise.reject(new ServiceUnavailableException(INDISPONIVEL));
  }

  interpretarWebhook(): EventoDeWhatsApp[] {
    throw new ServiceUnavailableException(INDISPONIVEL);
  }

  responderDesafio(): string | null {
    return null;
  }
}

/**
 * Escolhe o provedor pela configuração. Nunca derruba o boot: faltando algo,
 * fica indisponível com erro no log — a mesma regra da cobrança e da
 * assinatura externa.
 *
 * `WHATSAPP_FORNECEDOR`:
 *  - ausente → indisponível (a opção some da tela);
 *  - `simulado` → em memória, **recusado em produção**: uma conversa "enviada"
 *    que não saiu é pior que conversa nenhuma;
 *  - `meta` → API de nuvem da Meta; exige também `WHATSAPP_ACCESS_TOKEN` e
 *    `WHATSAPP_GRAPH_URL` (https).
 *
 * `WHATSAPP_APP_SECRET` (assina cada entrega) e `WHATSAPP_VERIFY_TOKEN`
 * (desafio do cadastro do webhook) são obrigatórios para qualquer provedor.
 */
export function provedorDeWhatsAppConfigurado(config: ConfigService): ProvedorDeWhatsApp {
  const log = new Logger('WhatsApp');
  const escolhido = config.get<string>('WHATSAPP_FORNECEDOR')?.trim();
  const segredo = config.get<string>('WHATSAPP_APP_SECRET')?.trim();
  const tokenDeVerificacao = config.get<string>('WHATSAPP_VERIFY_TOKEN')?.trim();

  if (!escolhido) return new ProvedorIndisponivelDeWhatsApp();

  const faltamBase = [
    !segredo && 'WHATSAPP_APP_SECRET',
    !tokenDeVerificacao && 'WHATSAPP_VERIFY_TOKEN',
  ].filter(Boolean);
  if (faltamBase.length) {
    log.error(
      `WHATSAPP_FORNECEDOR=${escolhido} sem ${faltamBase.join(' e ')}: WhatsApp desligado — ` +
        'o webhook não teria como ser conferido.',
    );
    return new ProvedorIndisponivelDeWhatsApp();
  }

  if (escolhido === 'simulado') {
    if (config.get<string>('NODE_ENV') === 'production') {
      log.error('WHATSAPP_FORNECEDOR=simulado ignorado em produção.');
      return new ProvedorIndisponivelDeWhatsApp();
    }
    log.warn('WhatsApp SIMULADO: nenhuma mensagem sai deste servidor.');
    return new ProvedorSimuladoDeWhatsApp(segredo!, tokenDeVerificacao!);
  }

  if (escolhido === 'meta') {
    const token = config.get<string>('WHATSAPP_ACCESS_TOKEN')?.trim();
    const graphUrl = config.get<string>('WHATSAPP_GRAPH_URL')?.trim();
    const faltam = [!token && 'WHATSAPP_ACCESS_TOKEN', !graphUrl && 'WHATSAPP_GRAPH_URL'].filter(Boolean);
    if (faltam.length) {
      log.error(`WHATSAPP_FORNECEDOR=meta sem ${faltam.join(' e ')}: WhatsApp desligado.`);
      return new ProvedorIndisponivelDeWhatsApp();
    }
    if (!/^https:\/\//i.test(graphUrl!)) {
      log.error('WHATSAPP_GRAPH_URL precisa ser https: WhatsApp desligado.');
      return new ProvedorIndisponivelDeWhatsApp();
    }
    return new ProvedorMetaDeWhatsApp({
      graphUrl: graphUrl!,
      token: token!,
      segredoDoApp: segredo!,
      tokenDeVerificacao: tokenDeVerificacao!,
    });
  }

  log.error(`WHATSAPP_FORNECEDOR="${escolhido}" não tem adaptador. WhatsApp desligado.`);
  return new ProvedorIndisponivelDeWhatsApp();
}
