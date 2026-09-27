import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import type {
  InscricaoDePush,
  NotificacaoPush,
  ProvedorDePush,
  ResultadoDoPush,
} from '@autoconnect/shared';

export const PROVEDOR_DE_PUSH = Symbol('ProvedorDePush');

/** Sem configuração: a opção some da tela, e os avisos simplesmente não saem. */
export class PushIndisponivel implements ProvedorDePush {
  readonly nome = 'nenhum';
  readonly disponivel = false;
  readonly chavePublica = null;
  async enviar(): Promise<ResultadoDoPush> {
    return { ok: false, expirada: false, motivo: 'Push não configurado.' };
  }
}

/** Em memória, para testes e desenvolvimento. Recusado em produção pela fábrica. */
export class PushSimulado implements ProvedorDePush {
  readonly nome = 'simulado';
  readonly disponivel = true;
  /**
   * Uma chave VAPID de verdade, gerada ao subir: com texto qualquer aqui, o
   * navegador recusaria a inscrição e não daria para ativar em desenvolvimento.
   * O simulado continua não enviando nada.
   */
  readonly chavePublica = webpush.generateVAPIDKeys().publicKey;
  readonly enviados: { endpoint: string; notificacao: NotificacaoPush }[] = [];
  private readonly expiradas = new Set<string>();

  /** O serviço do navegador passa a responder 410 para este aparelho. */
  expirar(endpoint: string): void {
    this.expiradas.add(endpoint);
  }

  async enviar(inscricao: InscricaoDePush, notificacao: NotificacaoPush): Promise<ResultadoDoPush> {
    if (this.expiradas.has(inscricao.endpoint)) {
      return { ok: false, expirada: true, motivo: '410 Gone (simulado)' };
    }
    this.enviados.push({ endpoint: inscricao.endpoint, notificacao });
    return { ok: true };
  }
}

/**
 * Web Push com chaves VAPID (RFC 8292) — o padrão que Chrome, Firefox, Edge e
 * Safari (macOS e iOS 16.4+, com o app na tela inicial) implementam. Não há
 * conta de terceiro: as chaves são geradas uma vez (`npx web-push
 * generate-vapid-keys`) e o serviço de push de cada navegador as confere.
 */
export class PushWeb implements ProvedorDePush {
  readonly nome = 'webpush';
  readonly disponivel = true;
  private readonly log = new Logger('Push');

  constructor(
    readonly chavePublica: string,
    private readonly chavePrivada: string,
    private readonly assunto: string,
  ) {}

  /**
   * Uma segunda tentativa, 2 s depois, quando a falha é passageira (rede,
   * 429, 5xx). O aviso é disparado e esquecido: sem ela, um soluço de rede
   * até o serviço de push perde o lead — foi o que a verificação local mostrou.
   */
  async enviar(inscricao: InscricaoDePush, notificacao: NotificacaoPush): Promise<ResultadoDoPush> {
    const primeira = await this.tentar(inscricao, notificacao);
    if (primeira.ok || primeira.expirada || !this.passageira(primeira.motivo)) return primeira;
    await new Promise((r) => setTimeout(r, this.esperaAntesDeRepetirMs));
    return this.tentar(inscricao, notificacao);
  }

  /** Injetável nos testes, para não esperar de verdade. */
  esperaAntesDeRepetirMs = 2000;

  private passageira(motivo: string): boolean {
    const status = Number(motivo);
    return !Number.isFinite(status) || status === 429 || status >= 500;
  }

  private async tentar(inscricao: InscricaoDePush, notificacao: NotificacaoPush): Promise<ResultadoDoPush> {
    try {
      await webpush.sendNotification(
        { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
        JSON.stringify(notificacao),
        {
          vapidDetails: { subject: this.assunto, publicKey: this.chavePublica, privateKey: this.chavePrivada },
          // Um aviso de lead de ontem não serve para nada: se o aparelho ficou
          // desligado mais de 6 h, o serviço pode descartá-lo.
          TTL: 6 * 60 * 60,
          urgency: 'high',
          topic: notificacao.etiqueta.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
          timeout: 10_000,
        },
      );
      return { ok: true };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        return { ok: false, expirada: true, motivo: `${status} — inscrição expirada` };
      }
      this.log.warn(`Push não entregue (${status ?? 'rede'}): ${(err as Error).message}`);
      return { ok: false, expirada: false, motivo: String(status ?? (err as Error).message) };
    }
  }
}

/**
 * `PUSH_FORNECEDOR`: vazio (desligado), `simulado` (recusado em produção) ou
 * `webpush`, que exige `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e
 * `VAPID_SUBJECT` (`mailto:` ou `https:`). Faltando algo, desligado com erro no
 * log — nunca derruba o boot.
 */
export function provedorDePushConfigurado(config: ConfigService): ProvedorDePush {
  const log = new Logger('Push');
  const escolhido = config.get<string>('PUSH_FORNECEDOR')?.trim();
  if (!escolhido) return new PushIndisponivel();

  if (escolhido === 'simulado') {
    if (config.get<string>('NODE_ENV') === 'production') {
      log.error('PUSH_FORNECEDOR=simulado ignorado em produção.');
      return new PushIndisponivel();
    }
    return new PushSimulado();
  }

  if (escolhido === 'webpush') {
    const publica = config.get<string>('VAPID_PUBLIC_KEY')?.trim();
    const privada = config.get<string>('VAPID_PRIVATE_KEY')?.trim();
    const assunto = config.get<string>('VAPID_SUBJECT')?.trim();
    const faltam = [
      !publica && 'VAPID_PUBLIC_KEY', !privada && 'VAPID_PRIVATE_KEY', !assunto && 'VAPID_SUBJECT',
    ].filter(Boolean);
    if (faltam.length) {
      log.error(`PUSH_FORNECEDOR=webpush sem ${faltam.join(', ')}: push desligado.`);
      return new PushIndisponivel();
    }
    if (!/^(mailto:|https:\/\/)/.test(assunto!)) {
      log.error('VAPID_SUBJECT precisa começar com mailto: ou https://: push desligado.');
      return new PushIndisponivel();
    }
    return new PushWeb(publica!, privada!, assunto!);
  }

  log.error(`PUSH_FORNECEDOR="${escolhido}" não tem adaptador. Push desligado.`);
  return new PushIndisponivel();
}
