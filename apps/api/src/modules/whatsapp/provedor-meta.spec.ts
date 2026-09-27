import { UnauthorizedException } from '@nestjs/common';
import { cabecalhoHmac } from '../contracts/assinatura/hmac';
import { ProvedorMetaDeWhatsApp, type ConfigDaMeta } from './provedor-meta';
import { RecusaDoWhatsApp } from './recusa';

/**
 * O adaptador da Meta contra um `fetch` de mentira. Não prova que a Meta
 * responde assim — prova que, se responder como a documentação diz, o sistema
 * faz a coisa certa. O que conferir com a conta de verdade está na decisão.
 */
type Chamada = { url: string; init: RequestInit };

function fetchQueResponde(status: number, corpo: unknown, chamadas: Chamada[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    return new Response(JSON.stringify(corpo), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const base = (f: typeof fetch): ConfigDaMeta => ({
  graphUrl: 'https://graph.facebook.com/v21.0/',
  token: 'EAAG-token',
  segredoDoApp: 'segredo-do-app',
  tokenDeVerificacao: 'verifica',
  fetch: f,
});

describe('ProvedorMetaDeWhatsApp — envio', () => {
  it('manda o texto para o número da loja, com o token da plataforma, e devolve o wamid', async () => {
    const chamadas: Chamada[] = [];
    const p = new ProvedorMetaDeWhatsApp(base(fetchQueResponde(200, {
      messaging_product: 'whatsapp',
      contacts: [{ input: '5511987654321', wa_id: '5511987654321' }],
      messages: [{ id: 'wamid.HBgLNTUxMTk4NzY1NDMyMRUCABEYEjQ' }],
    }, chamadas)));

    const r = await p.enviarTexto({ conta: '106540352242922', para: '5511987654321', texto: 'Olá' });

    expect(r).toEqual({ idExterno: 'wamid.HBgLNTUxMTk4NzY1NDMyMRUCABEYEjQ' });
    expect(chamadas).toHaveLength(1);
    // A barra do fim da URL configurada não vira barra dupla.
    expect(chamadas[0].url).toBe('https://graph.facebook.com/v21.0/106540352242922/messages');
    expect(chamadas[0].init.method).toBe('POST');
    expect((chamadas[0].init.headers as Record<string, string>).Authorization).toBe('Bearer EAAG-token');
    expect(JSON.parse(String(chamadas[0].init.body))).toMatchObject({
      to: '5511987654321', type: 'text', text: { body: 'Olá' },
    });
  });

  it('manda o modelo com nome, idioma e parâmetros', async () => {
    const chamadas: Chamada[] = [];
    const p = new ProvedorMetaDeWhatsApp(base(fetchQueResponde(200, { messages: [{ id: 'wamid.X' }] }, chamadas)));

    await p.enviarModelo({
      conta: '1', para: '55', modelo: 'autoconnect_retomar_conversa', idioma: 'pt_BR', parametros: ['Ana', 'Auto Sul'],
    });

    expect(JSON.parse(String(chamadas[0].init.body)).template).toEqual({
      name: 'autoconnect_retomar_conversa',
      language: { code: 'pt_BR' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'Auto Sul' }] }],
    });
  });

  it('erro da Meta vira recusa com o código e o detalhe — a tela mostra o motivo', async () => {
    const p = new ProvedorMetaDeWhatsApp(base(fetchQueResponde(400, {
      error: {
        message: '(#131047) Re-engagement message',
        type: 'OAuthException',
        code: 131047,
        error_data: { messaging_product: 'whatsapp', details: 'More than 24 hours have passed since the customer last replied.' },
      },
    })));

    await expect(p.enviarTexto({ conta: '1', para: '55', texto: 'x' })).rejects.toEqual(
      new RecusaDoWhatsApp('131047: More than 24 hours have passed since the customer last replied.'),
    );
  });

  it('erro sem corpo legível ainda diz o HTTP', async () => {
    const f = (async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch;
    const p = new ProvedorMetaDeWhatsApp(base(f));
    await expect(p.enviarTexto({ conta: '1', para: '55', texto: 'x' })).rejects.toEqual(
      new RecusaDoWhatsApp('A Meta recusou a mensagem (HTTP 502).'),
    );
  });

  it('rede fora do ar vira recusa, não exceção solta', async () => {
    const f = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const p = new ProvedorMetaDeWhatsApp(base(f));
    await expect(p.enviarTexto({ conta: '1', para: '55', texto: 'x' })).rejects.toBeInstanceOf(RecusaDoWhatsApp);
  });

  it('200 sem id da mensagem não é sucesso', async () => {
    const p = new ProvedorMetaDeWhatsApp(base(fetchQueResponde(200, { messages: [] })));
    await expect(p.enviarTexto({ conta: '1', para: '55', texto: 'x' })).rejects.toBeInstanceOf(RecusaDoWhatsApp);
  });
});

describe('ProvedorMetaDeWhatsApp — webhook', () => {
  const p = new ProvedorMetaDeWhatsApp(base(fetchQueResponde(200, {})));
  const corpo = Buffer.from(JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: '1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: '106' },
          messages: [{ from: '5511987654321', id: 'wamid.A', timestamp: '1', type: 'text', text: { body: 'oi' } }],
        },
      }],
    }],
  }));

  it('confere o X-Hub-Signature-256 com o segredo do app e traduz', () => {
    const eventos = p.interpretarWebhook({ 'x-hub-signature-256': cabecalhoHmac(corpo, 'segredo-do-app') }, corpo);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: 'mensagem', idExterno: 'wamid.A', conta: '106', texto: 'oi' });
  });

  it('assinatura errada ou ausente é 401, antes de ler o corpo', () => {
    expect(() => p.interpretarWebhook({ 'x-hub-signature-256': cabecalhoHmac(corpo, 'outro') }, corpo))
      .toThrow(UnauthorizedException);
    expect(() => p.interpretarWebhook({}, corpo)).toThrow(UnauthorizedException);
  });

  it('corpo assinado mas que não é JSON não gera evento', () => {
    const lixo = Buffer.from('não é json');
    expect(p.interpretarWebhook({ 'x-hub-signature-256': cabecalhoHmac(lixo, 'segredo-do-app') }, lixo)).toEqual([]);
  });

  it('responde o desafio com o token de verificação', () => {
    expect(p.responderDesafio({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verifica', 'hub.challenge': '42' })).toBe('42');
    expect(p.responderDesafio({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '42' })).toBeNull();
  });
});
