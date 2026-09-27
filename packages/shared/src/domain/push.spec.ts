import {
  encurtar,
  inscricaoDePushSchema,
  notificacaoDeLeadNovo,
  notificacaoDeMensagem,
} from './push';

describe('notificações do vendedor', () => {
  it('lead novo: quem e o carro, com a etiqueta do lead', () => {
    expect(notificacaoDeLeadNovo({
      leadId: 'l1', nome: 'Maria Souza', veiculo: 'Chevrolet Onix 2019', origem: 'OLX',
    })).toEqual({
      titulo: 'Lead novo (OLX)',
      corpo: 'Maria Souza — Chevrolet Onix 2019',
      url: '/leads',
      etiqueta: 'lead-l1',
    });
  });

  it('sem responsável, o título diz — é o aviso da gerência', () => {
    const n = notificacaoDeLeadNovo({ leadId: 'l1', nome: null, veiculo: 'veículo', origem: 'Site', semResponsavel: true });
    expect(n.titulo).toBe('Lead sem responsável (Site)');
    // "veículo" é o marcador de "sem carro" do serviço de leads: não entra.
    expect(n.corpo).toBe('Cliente sem nome');
  });

  it('mensagem: o nome e o canal no título, o texto no corpo, a conversa na etiqueta', () => {
    expect(notificacaoDeMensagem({ conversationId: 'c9', nome: 'João', canal: 'WhatsApp', texto: 'Oi, tudo bem?' }))
      .toEqual({ titulo: 'João (WhatsApp)', corpo: 'Oi, tudo bem?', url: '/chat?c=c9', etiqueta: 'conversa-c9' });
  });

  it('encurta na palavra, com reticências', () => {
    expect(encurtar('uma frase bem comprida para caber', 20)).toBe('uma frase bem…');
    expect(encurtar('  curta  ', 20)).toBe('curta');
  });
});

describe('inscrição do navegador', () => {
  const valida = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc:def',
    expirationTime: null,
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
  };

  it('aceita o PushSubscription.toJSON() do navegador', () => {
    expect(inscricaoDePushSchema.parse(valida)).toEqual(valida);
  });

  it('recusa endpoint que não é https e chave faltando', () => {
    expect(() => inscricaoDePushSchema.parse({ ...valida, endpoint: 'http://x.com/a' })).toThrow();
    expect(() => inscricaoDePushSchema.parse({ endpoint: valida.endpoint, keys: { auth: 'x' } })).toThrow();
  });
});
