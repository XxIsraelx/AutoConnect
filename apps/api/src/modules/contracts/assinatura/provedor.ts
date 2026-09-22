import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type {
  EnvelopeCriado, EventoDeAssinatura, ProvedorDeAssinatura,
} from '@autoconnect/shared';
import { ProvedorSimulado } from './provedor-simulado';
import { ProvedorClicksign } from './provedor-clicksign';

export const PROVEDOR_DE_ASSINATURA = Symbol('ProvedorDeAssinatura');

const INDISPONIVEL =
  'Nenhum provedor de assinatura eletrônica está configurado. ' +
  'Use a assinatura registrada no sistema ou configure ASSINATURA_FORNECEDOR.';

/**
 * Provedor ausente.
 *
 * Assinatura externa depende de conta e contrato com o provedor. Até haver um,
 * a API recusa alto (503) e a tela esconde a opção — `disponivel = false` é a
 * chave de liga/desliga da funcionalidade, sem infraestrutura de feature flag.
 *
 * O webhook também recusa: sem provedor não há segredo para conferir o HMAC,
 * e aceitar evento sem conferir seria deixar qualquer um marcar contrato como
 * assinado.
 */
export class ProvedorIndisponivel implements ProvedorDeAssinatura {
  readonly nome = 'nenhum';
  readonly disponivel = false;

  criarEnvelope(): Promise<EnvelopeCriado> {
    return Promise.reject(new ServiceUnavailableException(INDISPONIVEL));
  }

  cancelar(): Promise<void> {
    return Promise.reject(new ServiceUnavailableException(INDISPONIVEL));
  }

  baixarAssinado(): Promise<Uint8Array> {
    return Promise.reject(new ServiceUnavailableException(INDISPONIVEL));
  }

  interpretarWebhook(): EventoDeAssinatura {
    throw new ServiceUnavailableException(INDISPONIVEL);
  }
}

/**
 * Escolhe o provedor pela configuração.
 *
 * `ASSINATURA_FORNECEDOR`:
 *  - ausente → indisponível (a opção some da tela);
 *  - `simulado` → provedor em memória, **recusado em produção**: um contrato
 *    marcado como assinado por simulação é documento falso;
 *  - `clicksign` → API 3.0, exige também `CLICKSIGN_ACCESS_TOKEN` e
 *    `CLICKSIGN_API_URL` (https). Faltando algum, fica indisponível com erro
 *    no log — nunca derruba o boot.
 *
 * `ASSINATURA_WEBHOOK_SECRET` é obrigatório para qualquer provedor: sem ele
 * não há como conferir que o webhook veio mesmo do provedor.
 */
export function provedorConfigurado(config: ConfigService): ProvedorDeAssinatura {
  const log = new Logger('AssinaturaExterna');
  const escolhido = config.get<string>('ASSINATURA_FORNECEDOR')?.trim();
  const segredo = config.get<string>('ASSINATURA_WEBHOOK_SECRET')?.trim();

  if (!escolhido) return new ProvedorIndisponivel();

  if (!segredo) {
    log.error(
      `ASSINATURA_FORNECEDOR=${escolhido} sem ASSINATURA_WEBHOOK_SECRET: ` +
        'assinatura externa desligada — o webhook não teria como ser conferido.',
    );
    return new ProvedorIndisponivel();
  }

  if (escolhido === 'simulado') {
    if (config.get<string>('NODE_ENV') === 'production') {
      log.error('ASSINATURA_FORNECEDOR=simulado ignorado em produção.');
      return new ProvedorIndisponivel();
    }
    log.warn('Assinatura externa SIMULADA: nenhum documento sai deste servidor.');
    return new ProvedorSimulado(segredo);
  }

  if (escolhido === 'clicksign') {
    const token = config.get<string>('CLICKSIGN_ACCESS_TOKEN')?.trim();
    const apiUrl = config.get<string>('CLICKSIGN_API_URL')?.trim();
    const faltam = [
      !token && 'CLICKSIGN_ACCESS_TOKEN',
      !apiUrl && 'CLICKSIGN_API_URL',
    ].filter(Boolean);
    if (faltam.length) {
      log.error(`ASSINATURA_FORNECEDOR=clicksign sem ${faltam.join(' e ')}: assinatura externa desligada.`);
      return new ProvedorIndisponivel();
    }
    if (!/^https:\/\//i.test(apiUrl!)) {
      log.error('CLICKSIGN_API_URL precisa ser https: assinatura externa desligada.');
      return new ProvedorIndisponivel();
    }
    if (config.get<string>('NODE_ENV') === 'production' && /sandbox/i.test(apiUrl!)) {
      // Não bloqueia (homologação pode rodar com NODE_ENV=production), mas
      // assinatura colhida no sandbox não tem validade jurídica.
      log.warn('Clicksign em SANDBOX com NODE_ENV=production: as assinaturas não têm validade.');
    }
    return new ProvedorClicksign({ apiUrl: apiUrl!, token: token!, segredoWebhook: segredo });
  }

  log.error(`ASSINATURA_FORNECEDOR="${escolhido}" não tem adaptador. Assinatura externa desligada.`);
  return new ProvedorIndisponivel();
}
