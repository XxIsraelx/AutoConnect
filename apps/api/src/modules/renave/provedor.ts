import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EventoDoRenave, ProvedorDeRenave, RespostaDoRenave } from '@autoconnect/shared';
import { ProvedorRenaveSimulado } from './provedor-simulado';

export const PROVEDOR_DE_RENAVE = Symbol('ProvedorDeRenave');

const INDISPONIVEL =
  'Nenhuma integradora RENAVE está configurada. Registre pela sua integradora e ' +
  'anote o protocolo aqui, ou configure RENAVE_FORNECEDOR.';

/**
 * Integradora ausente — o estado normal até a R3.
 *
 * O registro manual (R1) segue funcionando; o que some é o envio. A API recusa
 * alto (503) e a tela esconde o botão. O webhook também recusa: sem integradora
 * não há segredo para conferir a entrega.
 */
export class ProvedorRenaveIndisponivel implements ProvedorDeRenave {
  readonly nome = 'nenhum';
  readonly disponivel = false;
  readonly exigeCredencialDaLoja = false;

  private recusar<T>(): Promise<T> {
    return Promise.reject(new ServiceUnavailableException(INDISPONIVEL));
  }

  verificarCredencial(): Promise<boolean> { return this.recusar(); }
  registrarEntrada(): Promise<RespostaDoRenave> { return this.recusar(); }
  registrarSaida(): Promise<RespostaDoRenave> { return this.recusar(); }
  cancelar(): Promise<RespostaDoRenave> { return this.recusar(); }
  consultar(): Promise<RespostaDoRenave> { return this.recusar(); }
  informarNotaFiscal(): Promise<void> { return this.recusar(); }
  baixarAtpv(): Promise<Uint8Array | null> { return this.recusar(); }

  interpretarWebhook(): EventoDoRenave {
    throw new ServiceUnavailableException(INDISPONIVEL);
  }
}

/**
 * Escolhe a integradora pela configuração.
 *
 * `RENAVE_FORNECEDOR`:
 *  - ausente → indisponível (o envio some da tela; o registro manual fica);
 *  - `simulado` → em memória, **recusado em produção**: um registro marcado
 *    como confirmado por simulação seria declaração falsa ao lojista;
 *  - qualquer outro → ainda não há adaptador (R3), indisponível com erro no log.
 *
 * `RENAVE_WEBHOOK_SECRET` é obrigatório para qualquer integradora: sem ele não
 * há como conferir que o webhook veio dela. Nada aqui derruba o boot.
 */
export function provedorDeRenaveConfigurado(config: ConfigService): ProvedorDeRenave {
  const log = new Logger('Renave');
  const escolhido = config.get<string>('RENAVE_FORNECEDOR')?.trim();
  const segredo = config.get<string>('RENAVE_WEBHOOK_SECRET')?.trim();

  if (!escolhido) return new ProvedorRenaveIndisponivel();

  if (!segredo) {
    log.error(
      `RENAVE_FORNECEDOR=${escolhido} sem RENAVE_WEBHOOK_SECRET: envio ao RENAVE desligado — ` +
        'o webhook não teria como ser conferido.',
    );
    return new ProvedorRenaveIndisponivel();
  }

  if (escolhido === 'simulado') {
    if (config.get<string>('NODE_ENV') === 'production') {
      log.error('RENAVE_FORNECEDOR=simulado ignorado em produção.');
      return new ProvedorRenaveIndisponivel();
    }
    log.warn('RENAVE SIMULADO: nenhum registro sai deste servidor.');
    return new ProvedorRenaveSimulado(segredo);
  }

  log.error(`RENAVE_FORNECEDOR="${escolhido}" não tem adaptador. Envio ao RENAVE desligado.`);
  return new ProvedorRenaveIndisponivel();
}
