import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type {
  EmitenteRegistrado, ProvedorDeNotaFiscal, RetornoDaCartaDeCorrecao, RetornoDoEmissor,
} from '@autoconnect/shared';
import { ProvedorDeNotaSimulado } from './provedor-simulado';
import { ProvedorFocusNfe } from './provedor-focus';

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
  readonly exigeCertificado = false;

  private recusar<T>(): Promise<T> {
    return Promise.reject(new ServiceUnavailableException(INDISPONIVEL));
  }

  registrarEmitente(): Promise<EmitenteRegistrado> { return this.recusar(); }
  emitir(): Promise<RetornoDoEmissor> { return this.recusar(); }
  cartaDeCorrecao(): Promise<RetornoDaCartaDeCorrecao> { return this.recusar(); }
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
 *  - `focusnfe` → Focus NFe; exige `FOCUS_NFE_TOKEN_MASTER`. Produção só com
 *    `FOCUS_NFE_PRODUCAO_LIBERADA=true` — sem ela, a instalação emite apenas em
 *    homologação, que é como ela deve estrear. `NFE_WEBHOOK_URL` (a URL pública
 *    de `/webhooks/nota-fiscal`) cria o gatilho da empresa; sem ela, o retorno
 *    chega só pela consulta.
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

  if (escolhido === 'focusnfe') {
    const tokenMaster = config.get<string>('FOCUS_NFE_TOKEN_MASTER')?.trim();
    if (!tokenMaster) {
      log.error('NFE_FORNECEDOR=focusnfe sem FOCUS_NFE_TOKEN_MASTER: emissão de NF-e desligada.');
      return new EmissorIndisponivel();
    }
    const producaoLiberada = config.get<string>('FOCUS_NFE_PRODUCAO_LIBERADA')?.trim() === 'true';
    const urlDoWebhook = config.get<string>('NFE_WEBHOOK_URL')?.trim() || null;
    if (urlDoWebhook && !/^https:\/\//i.test(urlDoWebhook)) {
      log.error('NFE_WEBHOOK_URL precisa ser https: o gatilho não será criado.');
    }
    if (!producaoLiberada) log.warn('Focus NFe em HOMOLOGAÇÃO: as notas não têm valor fiscal.');
    return new ProvedorFocusNfe({
      tokenMaster,
      segredoWebhook: token,
      producaoLiberada,
      urlDoWebhook: urlDoWebhook && /^https:\/\//i.test(urlDoWebhook) ? urlDoWebhook : null,
    });
  }

  log.error(`NFE_FORNECEDOR="${escolhido}" não tem adaptador. Emissão de NF-e desligada.`);
  return new EmissorIndisponivel();
}
