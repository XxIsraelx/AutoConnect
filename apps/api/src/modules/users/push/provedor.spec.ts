import type { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PushIndisponivel, PushSimulado, PushWeb, provedorDePushConfigurado } from './provedor';

jest.mock('web-push', () => ({
  sendNotification: jest.fn(),
  generateVAPIDKeys: () => ({ publicKey: 'chave-publica-gerada', privateKey: 'x' }),
}));
const enviar = webpush.sendNotification as jest.Mock;

const config = (v: Record<string, string | undefined>) =>
  ({ get: (k: string) => v[k] }) as unknown as ConfigService;
const VAPID = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:suporte@exemplo.com' };

describe('provedorDePushConfigurado', () => {
  it('sem fornecedor, desligado', () => {
    expect(provedorDePushConfigurado(config({}))).toBeInstanceOf(PushIndisponivel);
  });

  it('simulado fora de produção; recusado em produção', () => {
    const simulado = provedorDePushConfigurado(config({ PUSH_FORNECEDOR: 'simulado', NODE_ENV: 'test' }));
    expect(simulado).toBeInstanceOf(PushSimulado);
    expect(simulado.chavePublica).toBe('chave-publica-gerada');
    expect(provedorDePushConfigurado(config({ PUSH_FORNECEDOR: 'simulado', NODE_ENV: 'production' })))
      .toBeInstanceOf(PushIndisponivel);
  });

  it('webpush exige as três VAPID e um assunto mailto: ou https:', () => {
    expect(provedorDePushConfigurado(config({ PUSH_FORNECEDOR: 'webpush', VAPID_PUBLIC_KEY: 'x' })))
      .toBeInstanceOf(PushIndisponivel);
    expect(provedorDePushConfigurado(config({ PUSH_FORNECEDOR: 'webpush', ...VAPID, VAPID_SUBJECT: 'suporte' })))
      .toBeInstanceOf(PushIndisponivel);
    const p = provedorDePushConfigurado(config({ PUSH_FORNECEDOR: 'webpush', ...VAPID }));
    expect(p).toBeInstanceOf(PushWeb);
    expect(p.chavePublica).toBe('pub');
  });
});

describe('PushWeb', () => {
  const p = new PushWeb('pub', 'priv', 'mailto:suporte@exemplo.com');
  const inscricao = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'k', auth: 'a' };
  const notificacao = { titulo: 'T', corpo: 'C', url: '/leads', etiqueta: 'lead-1f2e' };

  beforeEach(() => enviar.mockReset());

  it('manda o JSON da notificação com as chaves VAPID e validade curta', async () => {
    enviar.mockResolvedValue({ statusCode: 201 });
    await expect(p.enviar(inscricao, notificacao)).resolves.toEqual({ ok: true });

    const [destino, corpo, opcoes] = enviar.mock.calls[0];
    expect(destino).toEqual({ endpoint: inscricao.endpoint, keys: { p256dh: 'k', auth: 'a' } });
    expect(JSON.parse(corpo)).toEqual(notificacao);
    expect(opcoes).toMatchObject({
      vapidDetails: { subject: 'mailto:suporte@exemplo.com', publicKey: 'pub', privateKey: 'priv' },
      TTL: 21600,
      urgency: 'high',
      topic: 'lead-1f2e',
    });
  });

  it('404 e 410 são inscrição expirada — ela sai do banco', async () => {
    enviar.mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 410 }));
    await expect(p.enviar(inscricao, notificacao)).resolves.toMatchObject({ ok: false, expirada: true });
    enviar.mockRejectedValue(Object.assign(new Error('Not found'), { statusCode: 404 }));
    await expect(p.enviar(inscricao, notificacao)).resolves.toMatchObject({ ok: false, expirada: true });
  });

  it('outras falhas não apagam a inscrição e não lançam', async () => {
    p.esperaAntesDeRepetirMs = 0;
    enviar.mockRejectedValue(Object.assign(new Error('rate'), { statusCode: 429 }));
    await expect(p.enviar(inscricao, notificacao)).resolves.toEqual({ ok: false, expirada: false, motivo: '429' });
    enviar.mockRejectedValue(new Error('ECONNRESET'));
    await expect(p.enviar(inscricao, notificacao)).resolves.toMatchObject({ ok: false, expirada: false });
  });

  it('falha passageira (rede, 429, 5xx) tenta de novo uma vez; a definitiva, não', async () => {
    p.esperaAntesDeRepetirMs = 0;
    enviar.mockRejectedValueOnce(new Error('Socket timeout')).mockResolvedValueOnce({ statusCode: 201 });
    await expect(p.enviar(inscricao, notificacao)).resolves.toEqual({ ok: true });
    expect(enviar).toHaveBeenCalledTimes(2);

    enviar.mockReset();
    enviar.mockRejectedValue(Object.assign(new Error('Bad request'), { statusCode: 400 }));
    await expect(p.enviar(inscricao, notificacao)).resolves.toMatchObject({ ok: false, expirada: false });
    expect(enviar).toHaveBeenCalledTimes(1);

    enviar.mockReset();
    enviar.mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 410 }));
    await p.enviar(inscricao, notificacao);
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});
