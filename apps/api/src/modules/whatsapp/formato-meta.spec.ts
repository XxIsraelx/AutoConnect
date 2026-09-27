import type { EventoDeWhatsApp } from '@autoconnect/shared';
import {
  corpoDeModelo,
  corpoDeTexto,
  interpretarEntregaDaMeta,
  montarEntregaDaMeta,
  responderDesafioDaMeta,
} from './formato-meta';

/** Uma entrega como a da documentação da Meta, com os campos que usamos. */
function entrega(value: Record<string, unknown>, conta = '106540352242922') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '102290129340398',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550783881', phone_number_id: conta },
          ...value,
        },
      }],
    }],
  };
}

describe('interpretarEntregaDaMeta — mensagens', () => {
  it('texto do cliente, com o nome do perfil e a hora da Meta', () => {
    const eventos = interpretarEntregaDaMeta(entrega({
      contacts: [{ profile: { name: 'Maria Souza' }, wa_id: '5511987654321' }],
      messages: [{
        from: '5511987654321', id: 'wamid.HBgL', timestamp: '1758974400',
        type: 'text', text: { body: 'Oi, o Onix ainda está disponível?' },
      }],
    }));

    expect(eventos).toEqual([{
      tipo: 'mensagem',
      idExterno: 'wamid.HBgL',
      conta: '106540352242922',
      de: '5511987654321',
      nome: 'Maria Souza',
      formato: 'texto',
      texto: 'Oi, o Onix ainda está disponível?',
      recebidaEm: new Date(1758974400 * 1000),
    }]);
  });

  it('mídia vira formato com a legenda; áudio, sem texto', () => {
    const eventos = interpretarEntregaDaMeta(entrega({
      messages: [
        { from: '55', id: 'a', timestamp: '1', type: 'image', image: { caption: 'meu carro de troca', id: 'm1' } },
        { from: '55', id: 'b', timestamp: '1', type: 'audio', audio: { id: 'm2' } },
        { from: '55', id: 'c', timestamp: '1', type: 'document', document: { filename: 'cnh.pdf' } },
      ],
    }));
    expect(eventos.map((e) => e.tipo === 'mensagem' && [e.formato, e.texto])).toEqual([
      ['imagem', 'meu carro de troca'],
      ['audio', null],
      ['documento', 'cnh.pdf'],
    ]);
  });

  it('resposta a botão e a menu: o cliente "disse" o rótulo', () => {
    const eventos = interpretarEntregaDaMeta(entrega({
      messages: [
        { from: '55', id: 'a', timestamp: '1', type: 'button', button: { text: 'Quero agendar' } },
        { from: '55', id: 'b', timestamp: '1', type: 'interactive', interactive: { type: 'list_reply', list_reply: { title: 'Sábado' } } },
      ],
    }));
    expect(eventos.map((e) => e.tipo === 'mensagem' && e.texto)).toEqual(['Quero agendar', 'Sábado']);
  });

  it('reação e aviso de sistema não são mensagens para a conversa', () => {
    const eventos = interpretarEntregaDaMeta(entrega({
      messages: [
        { from: '55', id: 'a', timestamp: '1', type: 'reaction', reaction: { emoji: '👍' } },
        { from: '55', id: 'b', timestamp: '1', type: 'system', system: { body: 'trocou de número' } },
      ],
    }));
    expect(eventos).toEqual([]);
  });

  it('tipo desconhecido entra como "outro", para a loja saber que o cliente escreveu', () => {
    const [e] = interpretarEntregaDaMeta(entrega({
      messages: [{ from: '55', id: 'a', timestamp: '1', type: 'order', order: {} }],
    }));
    expect(e).toMatchObject({ tipo: 'mensagem', formato: 'outro' });
  });
});

describe('interpretarEntregaDaMeta — status de entrega', () => {
  it('traduz sent/delivered/read', () => {
    const eventos = interpretarEntregaDaMeta(entrega({
      statuses: [
        { id: 'w1', status: 'sent', timestamp: '10', recipient_id: '55' },
        { id: 'w1', status: 'delivered', timestamp: '11', recipient_id: '55' },
        { id: 'w1', status: 'read', timestamp: '12', recipient_id: '55' },
      ],
    }));
    expect(eventos.map((e) => e.tipo === 'status' && e.status)).toEqual(['enviada', 'entregue', 'lida']);
  });

  it('falha traz código, título e detalhe', () => {
    const [e] = interpretarEntregaDaMeta(entrega({
      statuses: [{
        id: 'w1', status: 'failed', timestamp: '10', recipient_id: '55',
        errors: [{
          code: 131047, title: 'Re-engagement message',
          error_data: { details: 'Message failed to send because more than 24 hours have passed.' },
        }],
      }],
    }));
    expect(e).toMatchObject({
      tipo: 'status',
      status: 'falhou',
      erro: '131047 — Re-engagement message: Message failed to send because more than 24 hours have passed.',
    });
  });

  it('status que não usamos é ignorado', () => {
    expect(interpretarEntregaDaMeta(entrega({
      statuses: [{ id: 'w1', status: 'deleted', timestamp: '10' }],
    }))).toEqual([]);
  });
});

describe('interpretarEntregaDaMeta — robustez', () => {
  it('objeto que não é do WhatsApp não gera evento', () => {
    expect(interpretarEntregaDaMeta({ object: 'page', entry: [] })).toEqual([]);
    expect(interpretarEntregaDaMeta(null)).toEqual([]);
    expect(interpretarEntregaDaMeta('texto')).toEqual([]);
  });

  it('parte malformada é pulada e o resto da entrega segue', () => {
    const eventos = interpretarEntregaDaMeta(entrega({
      messages: [
        { id: 'sem-remetente', type: 'text', text: { body: 'x' } },
        'lixo',
        { from: '55', id: 'ok', timestamp: '1', type: 'text', text: { body: 'certo' } },
      ],
    }));
    expect(eventos.map((e) => e.idExterno)).toEqual(['ok']);
  });

  it('mudança de outro campo (templates, qualidade da conta) é ignorada', () => {
    const corpo = entrega({});
    corpo.entry[0].changes[0].field = 'message_template_status_update';
    expect(interpretarEntregaDaMeta(corpo)).toEqual([]);
  });

  it('entrega com duas contas mantém a conta de cada evento', () => {
    const corpo = {
      object: 'whatsapp_business_account',
      entry: [
        entrega({ messages: [{ from: '55', id: 'a', timestamp: '1', type: 'text', text: { body: 'x' } }] }, '111').entry[0],
        entrega({ messages: [{ from: '55', id: 'b', timestamp: '1', type: 'text', text: { body: 'y' } }] }, '222').entry[0],
      ],
    };
    expect(interpretarEntregaDaMeta(corpo).map((e) => [e.idExterno, e.conta])).toEqual([['a', '111'], ['b', '222']]);
  });
});

describe('montarEntregaDaMeta — o inverso, para o simulado', () => {
  it('o que o simulado monta é traduzido de volta nos mesmos eventos', () => {
    const eventos: EventoDeWhatsApp[] = [
      {
        tipo: 'mensagem', idExterno: 'wamid.1', conta: '111', de: '5511987654321', nome: 'Ana',
        formato: 'texto', texto: 'oi', recebidaEm: new Date(1758974400000),
      },
      { tipo: 'status', idExterno: 'wamid.2', conta: '111', status: 'lida', em: new Date(1758974460000), erro: null },
      { tipo: 'status', idExterno: 'wamid.3', conta: '222', status: 'falhou', em: new Date(1758974460000), erro: 'motivo' },
    ];
    const volta = interpretarEntregaDaMeta(JSON.parse(JSON.stringify(montarEntregaDaMeta(eventos))));
    expect(volta).toEqual([
      eventos[0],
      eventos[1],
      { ...eventos[2], erro: '0 — motivo' },
    ]);
  });
});

describe('corpo do envio', () => {
  it('texto sem prévia de link', () => {
    expect(corpoDeTexto('5511987654321', 'Olá')).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '5511987654321',
      type: 'text', text: { preview_url: false, body: 'Olá' },
    });
  });

  it('modelo com os parâmetros do corpo, na ordem', () => {
    expect(corpoDeModelo('55119', 'autoconnect_retomar_conversa', 'pt_BR', ['Maria', 'Auto Sul'])).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '55119', type: 'template',
      template: {
        name: 'autoconnect_retomar_conversa',
        language: { code: 'pt_BR' },
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: 'Maria' }, { type: 'text', text: 'Auto Sul' }],
        }],
      },
    });
  });
});

describe('desafio do cadastro do webhook', () => {
  const q = (token: string, modo = 'subscribe') => ({
    'hub.mode': modo, 'hub.verify_token': token, 'hub.challenge': '1158201444',
  });

  it('devolve o challenge quando o token confere', () => {
    expect(responderDesafioDaMeta(q('certo'), 'certo')).toBe('1158201444');
  });

  it('token errado, modo errado ou token vazio configurado: nada', () => {
    expect(responderDesafioDaMeta(q('errado'), 'certo')).toBeNull();
    expect(responderDesafioDaMeta(q('certo', 'unsubscribe'), 'certo')).toBeNull();
    expect(responderDesafioDaMeta(q(''), '')).toBeNull();
    expect(responderDesafioDaMeta({}, 'certo')).toBeNull();
  });
});
