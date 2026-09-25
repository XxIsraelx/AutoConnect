import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type {
  AssinaturaNoGateway, EventoDeCobranca, FaturaDoGateway, ProvedorDeCobranca,
} from '@autoconnect/shared';
import { ProvedorSimuladoDeCobranca } from './provedor-simulado';
import { ProvedorAsaas } from './provedor-asaas';

export const PROVEDOR_DE_COBRANCA = Symbol('ProvedorDeCobranca');

const INDISPONIVEL =
  'Nenhum gateway de cobrança está configurado. ' +
  'A assinatura desta loja é gerenciada manualmente — fale com o suporte.';

/**
 * Gateway ausente.
 *
 * Cobrar depende de conta no gateway. Até haver uma, a API recusa alto (503) e
 * a tela esconde a opção de contratar — `disponivel = false` é a chave de
 * liga/desliga da funcionalidade, sem infraestrutura de feature flag.
 *
 * O webhook também recusa: sem gateway não há token para conferir, e aceitar
 * evento sem conferir seria deixar qualquer um marcar uma loja como paga.
 *
 * **O bloqueio por vencimento continua valendo sem gateway.** Ele depende do
 * trial e da carência, que são do banco; o que some é o caminho para pagar.
 * Numa instalação sem gateway, quem desbloqueia é o super admin, à mão — que
 * é exatamente como o produto funcionava antes desta onda.
 */
export class CobrancaIndisponivel implements ProvedorDeCobranca {
  readonly nome = 'nenhum';
  readonly disponivel = false;

  salvarCliente(): Promise<{ idExterno: string }> {
    return Promise.reject(new ServiceUnavailableException(INDISPONIVEL));
  }

  criarAssinatura(): Promise<AssinaturaNoGateway> {
    return Promise.reject(new ServiceUnavailableException(INDISPONIVEL));
  }

  faturaAtual(): Promise<FaturaDoGateway | null> {
    return Promise.reject(new ServiceUnavailableException(INDISPONIVEL));
  }

  cancelarAssinatura(): Promise<void> {
    return Promise.reject(new ServiceUnavailableException(INDISPONIVEL));
  }

  interpretarWebhook(): EventoDeCobranca {
    throw new ServiceUnavailableException(INDISPONIVEL);
  }
}

/**
 * Escolhe o gateway pela configuração. Mesma fábrica da assinatura externa.
 *
 * `COBRANCA_FORNECEDOR`:
 *  - ausente → indisponível (a tela esconde a contratação);
 *  - `simulado` → em memória, **recusado em produção**: uma loja marcada como
 *    paga por simulação é uma loja usando o produto de graça, e do outro lado
 *    seria uma loja bloqueada sem dever nada;
 *  - `asaas` → API v3, exige também `ASAAS_API_KEY` e `ASAAS_API_URL` (https).
 *    Faltando algum, fica indisponível com erro no log — nunca derruba o boot.
 *
 * `COBRANCA_WEBHOOK_TOKEN` é obrigatório para qualquer gateway: sem ele não há
 * como conferir que o webhook veio mesmo de lá.
 */
export function cobrancaConfigurada(config: ConfigService): ProvedorDeCobranca {
  const log = new Logger('Cobranca');
  const escolhido = config.get<string>('COBRANCA_FORNECEDOR')?.trim();
  const token = config.get<string>('COBRANCA_WEBHOOK_TOKEN')?.trim();

  if (!escolhido) return new CobrancaIndisponivel();

  if (!token) {
    log.error(
      `COBRANCA_FORNECEDOR=${escolhido} sem COBRANCA_WEBHOOK_TOKEN: ` +
        'cobrança desligada — o webhook não teria como ser conferido.',
    );
    return new CobrancaIndisponivel();
  }

  if (escolhido === 'simulado') {
    if (config.get<string>('NODE_ENV') === 'production') {
      log.error('COBRANCA_FORNECEDOR=simulado ignorado em produção.');
      return new CobrancaIndisponivel();
    }
    log.warn('Cobrança SIMULADA: nenhuma cobrança sai deste servidor.');
    return new ProvedorSimuladoDeCobranca(token);
  }

  if (escolhido === 'asaas') {
    const apiKey = config.get<string>('ASAAS_API_KEY')?.trim();
    const apiUrl = config.get<string>('ASAAS_API_URL')?.trim();
    const faltam = [!apiKey && 'ASAAS_API_KEY', !apiUrl && 'ASAAS_API_URL'].filter(Boolean);
    if (faltam.length) {
      log.error(`COBRANCA_FORNECEDOR=asaas sem ${faltam.join(' e ')}: cobrança desligada.`);
      return new CobrancaIndisponivel();
    }
    if (!/^https:\/\//i.test(apiUrl!)) {
      log.error('ASAAS_API_URL precisa ser https: cobrança desligada.');
      return new CobrancaIndisponivel();
    }
    if (config.get<string>('NODE_ENV') === 'production' && /sandbox/i.test(apiUrl!)) {
      // Não bloqueia (homologação pode rodar com NODE_ENV=production), mas
      // cobrança de sandbox não move dinheiro nenhum.
      log.warn('Asaas em SANDBOX com NODE_ENV=production: nada será cobrado de verdade.');
    }
    return new ProvedorAsaas({ apiUrl: apiUrl!, apiKey: apiKey!, tokenWebhook: token });
  }

  log.error(`COBRANCA_FORNECEDOR="${escolhido}" não tem adaptador. Cobrança desligada.`);
  return new CobrancaIndisponivel();
}
