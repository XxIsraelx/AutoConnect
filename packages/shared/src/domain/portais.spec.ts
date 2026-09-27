import {
  codigoDeConfirmacaoDoGmail,
  enderecoDeEntrada,
  interpretarEmailDeLead,
  leadDePortalSchema,
  mensagemDoLeadDePortal,
  textoDoHtml,
  tokenDoDestinatario,
} from './portais';

/**
 * As amostras abaixo são **montadas**, no formato que os portais costumam usar
 * — não são e-mails reais da OLX. Quando chegar uma amostra de verdade, ela
 * entra aqui como caso próprio, e o leitor específico do portal nasce dela.
 */

describe('interpretarEmailDeLead — texto com "Rótulo: valor"', () => {
  const texto = [
    'Olá, Auto Sul!',
    'Você recebeu uma nova mensagem sobre o seu anúncio.',
    '',
    'Nome: Maria Souza',
    'Telefone: (11) 98765-4321',
    'E-mail: Maria.Souza@Gmail.com',
    'Mensagem: Olá, o carro ainda está disponível?',
    'Aceita troca num Gol 2015?',
    '',
    'Anúncio: Chevrolet Onix 1.0 LT 2019',
    'Preço: R$ 55.900',
    'Código do anúncio: 1234567890',
    'https://sp.olx.com.br/autos-e-pecas/carros/onix-1234567890',
    '',
    'Atendimento OLX: (11) 3003-0000',
  ].join('\n');

  it('extrai o contato, a mensagem de várias linhas e o anúncio', () => {
    expect(interpretarEmailDeLead({ assunto: 'Nova mensagem', texto, html: null })).toEqual({
      idExterno: null,
      nome: 'Maria Souza',
      telefone: '11987654321',
      email: 'maria.souza@gmail.com',
      mensagem: 'Olá, o carro ainda está disponível?\nAceita troca num Gol 2015?',
      anuncio: {
        titulo: 'Chevrolet Onix 1.0 LT 2019',
        preco: 'R$ 55.900',
        codigo: '1234567890',
        url: 'https://sp.olx.com.br/autos-e-pecas/carros/onix-1234567890',
      },
    });
  });

  it('o telefone solto do rodapé não entra: só o rotulado', () => {
    const semTelefoneDoCliente = texto.replace('Telefone: (11) 98765-4321\n', '');
    const r = interpretarEmailDeLead({ assunto: null, texto: semTelefoneDoCliente, html: null });
    expect(r?.telefone).toBeNull();
    // Ainda é lead: tem e-mail.
    expect(r?.email).toBe('maria.souza@gmail.com');
  });

  it('sem telefone nem e-mail do cliente, não é lead', () => {
    expect(interpretarEmailDeLead({
      assunto: 'Seu anúncio expira amanhã',
      texto: 'Anúncio: Onix 2019\nRenove para continuar aparecendo. Atendimento: (11) 3003-0000',
      html: null,
    })).toBeNull();
  });

  it('aceita "Rótulo - valor" e rótulos sinônimos', () => {
    const r = interpretarEmailDeLead({
      assunto: null,
      texto: 'Interessado - João Lima\nWhatsApp - 21 99876 5432\nComentário: tem laudo?',
      html: null,
    });
    expect(r).toMatchObject({ nome: 'João Lima', telefone: '21998765432', mensagem: 'tem laudo?' });
  });
});

describe('interpretarEmailDeLead — tabela HTML', () => {
  const html = `
    <html><body>
      <h2>Novo interessado no seu veículo</h2>
      <table>
        <tr><td><b>Nome</b></td><td>Carlos Pereira</td></tr>
        <tr><td><b>Celular</b></td><td>(51) 99123-4567</td></tr>
        <tr><td><b>E-mail</b></td><td>carlos@exemplo.com.br</td></tr>
        <tr><td><b>Veículo</b></td><td>Toyota Hilux SRV 2021</td></tr>
        <tr><td><b>Mensagem</b></td><td>Faz financiamento?</td></tr>
      </table>
      <p>Webmotors &amp; você</p>
    </body></html>`;

  it('rótulo e valor em células vizinhas viram campo', () => {
    expect(interpretarEmailDeLead({ assunto: null, texto: null, html })).toMatchObject({
      nome: 'Carlos Pereira',
      telefone: '51991234567',
      email: 'carlos@exemplo.com.br',
      mensagem: 'Faz financiamento?',
      anuncio: { titulo: 'Toyota Hilux SRV 2021' },
    });
  });

  it('o texto do HTML tira tags, estilo e entidades', () => {
    expect(textoDoHtml('<style>td{}</style><p>A &amp; B</p><br>C&nbsp;D')).toBe('A & B\n\nC D');
  });
});

describe('confirmação de encaminhamento do Gmail', () => {
  it('acha o código pelo assunto ou pelo corpo, só do remetente do Gmail', () => {
    expect(codigoDeConfirmacaoDoGmail({
      de: 'Equipe do Gmail <forwarding-noreply@google.com>',
      assunto: '(#482913576) Confirmação de encaminhamento do Gmail',
      texto: null,
      html: null,
    })).toBe('482913576');
    expect(codigoDeConfirmacaoDoGmail({
      de: 'forwarding-noreply@google.com',
      assunto: 'Gmail Forwarding Confirmation',
      texto: 'Confirmation code: 123456789',
      html: null,
    })).toBe('123456789');
    expect(codigoDeConfirmacaoDoGmail({
      de: 'golpe@exemplo.com', assunto: '(#482913576) Confirmação', texto: null, html: null,
    })).toBeNull();
  });
});

describe('endereço de entrada', () => {
  const token = 'a'.repeat(40);

  it('põe o token depois do +', () => {
    expect(enderecoDeEntrada('leads@entrada.autoconnectapp.com.br', token))
      .toBe(`leads+${token}@entrada.autoconnectapp.com.br`);
  });

  it('acha o token entre os destinatários, com nome e em maiúsculas', () => {
    expect(tokenDoDestinatario(['outro@x.com', `Auto Sul <LEADS+${token.toUpperCase()}@entrada.x>`])).toBe(token);
    expect(tokenDoDestinatario(['leads+curto@entrada.x'])).toBeNull();
  });
});

describe('formato AutoConnect do webhook', () => {
  it('aceita um lead ou uma lista, normaliza o telefone e descarta campos a mais', () => {
    const um = leadDePortalSchema.parse({
      id: 987, nome: ' Ana ', telefone: '+55 (11) 98765-4321', email: '', extra: 'ignorado',
      anuncio: { titulo: 'Onix 2019', preco: 55900 },
    });
    expect(um).toEqual({
      idExterno: '987', nome: 'Ana', telefone: '11987654321', email: null, mensagem: null,
      anuncio: { titulo: 'Onix 2019', url: null, codigo: null, preco: '55900' },
    });
    expect(leadDePortalSchema.parse([{ nome: 'A', email: 'a@b.com' }, { nome: 'B', telefone: '11987654321' }]))
      .toHaveLength(2);
  });

  it('e-mail inválido é erro de schema', () => {
    expect(() => leadDePortalSchema.parse({ nome: 'A', email: 'nao-e-email' })).toThrow();
  });
});

describe('mensagem do lead de portal', () => {
  it('junta o que o cliente escreveu e de qual anúncio veio', () => {
    expect(mensagemDoLeadDePortal({
      nome: 'A', telefone: null, email: 'a@b.com', mensagem: 'Tem laudo?',
      anuncio: { titulo: 'Onix 2019', preco: 'R$ 55.900', codigo: '123', url: 'https://olx.com.br/x' },
    }, 'olx')).toBe('Tem laudo?\nAnúncio na OLX: Onix 2019 · R$ 55.900 · código 123\nhttps://olx.com.br/x');
  });

  it('sem nada, nulo', () => {
    expect(mensagemDoLeadDePortal({ nome: 'A', telefone: '1', email: null, mensagem: null, anuncio: null }, 'olx'))
      .toBeNull();
  });
});
