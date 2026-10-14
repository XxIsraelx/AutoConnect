import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ProvedorDeNotaFiscal, RetornoDoEmissor } from '@autoconnect/shared';
import { ProvedorDeNotaSimulado } from './provedor-simulado';

export const PROVEDOR_DE_NOTA_FISCAL = Symbol('ProvedorDeNotaFiscal');

const INDISPONIVEL =
  'Nenhum emissor de NF-e está configurado nesta instalação. ' +
  'A prévia continua mostrando os dados para o emissor que a loja já usa.';

/**
 * Emissor ausente.
 *
 * Sem `NFE_FORNECEDOR`, a emissão recusa alto (503) e a tela esconde o botão
 * — `disponivel = false` é a chave de liga/desliga, como na assinatura e na
 * cobrança. O webhook também recusa: sem emissor não há token para conferir,
 * e aceitar retorno sem conferir seria deixar qualquer um "autorizar" nota.
 */
export class EmissorIndisponivel implements ProvedorDeNotaFiscal {
  readonly nome = 'nenhum';
  readonly disponivel = false;
  readonly homologacao = false;

  private recusar<T>(): Promise<T> {
    return Promise.reject(new ServiceUnavailableException(INDISPONIVEL));
  }

  emitir(): Promise<RetornoDoEmissor> { return this.recusar(); }
  consultar(): Promise<RetornoDoEmissor> { return this.recusar(); }
  cancelar(): Promise<RetornoDoEmissor> { return this.recusar(); }
  baixarXml(): Promise<Uint8Array> { return this.recusar(); }
  baixarDanfe(): Promise<Uint8Array> { return this.recusar(); }
  interpretarWebhook(): never {
    throw new ServiceUnavailableException(INDISPONIVEL);
  }
}

/**
 * Escolhe o emissor pela configuração.
 *
 * `NFE_FORNECEDOR`:
 *  - ausente → indisponível (o botão some, a prévia continua);
 *  - `simulado` → em memória, **recusado em produção**: nota "autorizada" por
 *    simulação é documento fiscal falso;
 *  - o adaptador do emissor terceiro entra na fase N3.
 *
 * `NFE_WEBHOOK_TOKEN` é obrigatório para qualquer emissor: é o que separa o
 * retorno do emissor de um `curl` de quem descobriu a URL. Faltando, fica
 * indisponível com erro no log — nunca derruba o boot.
 */
export function emissorConfigurado(config: ConfigService): ProvedorDeNotaFiscal {
  const log = new Logger('NotaFiscal');
  const escolhido = config.get<string>('NFE_FORNECEDOR')?.trim();
  const token = config.get<string>('NFE_WEBHOOK_TOKEN')?.trim();

  if (!escolhido) return new EmissorIndisponivel();

  if (!token) {
    log.error(
      `NFE_FORNECEDOR=${escolhido} sem NFE_WEBHOOK_TOKEN: emissão de NF-e desligada — ` +
        'o retorno do emissor não teria como ser conferido.',
    );
    return new EmissorIndisponivel();
  }

  if (escolhido === 'simulado') {
    if (config.get<string>('NODE_ENV') === 'production') {
      log.error('NFE_FORNECEDOR=simulado ignorado em produção.');
      return new EmissorIndisponivel();
    }
    log.warn('Emissão de NF-e SIMULADA: nenhuma nota sai deste servidor.');
    return new ProvedorDeNotaSimulado(token);
  }

  log.error(`NFE_FORNECEDOR="${escolhido}" não tem adaptador. Emissão de NF-e desligada.`);
  return new EmissorIndisponivel();
}
