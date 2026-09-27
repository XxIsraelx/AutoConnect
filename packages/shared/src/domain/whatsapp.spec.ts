import {
  MODELOS_DE_WHATSAPP,
  MODELOS_MANUAIS,
  chaveDoEventoDeWhatsApp,
  contatoDoWhatsApp,
  enderecoDoWhatsApp,
  janelaDeAtendimentoAberta,
  janelaFechaEm,
  renderizarModelo,
  statusDeEntregaAvanca,
} from './whatsapp';

describe('janela de atendimento de 24 h', () => {
  const agora = new Date('2026-09-27T12:00:00Z');

  it('aberta até 24 h depois da última mensagem do cliente', () => {
    expect(janelaDeAtendimentoAberta(new Date('2026-09-26T12:00:01Z'), agora)).toBe(true);
    expect(janelaDeAtendimentoAberta('2026-09-27T11:59:00Z', agora)).toBe(true);
  });

  it('fechada a partir da 24ª hora', () => {
    expect(janelaDeAtendimentoAberta(new Date('2026-09-26T12:00:00Z'), agora)).toBe(false);
    expect(janelaDeAtendimentoAberta(new Date('2026-09-20T12:00:00Z'), agora)).toBe(false);
  });

  it('conversa que a loja iniciou nasce fechada: o cliente ainda não escreveu', () => {
    expect(janelaDeAtendimentoAberta(null, agora)).toBe(false);
    expect(janelaDeAtendimentoAberta(undefined, agora)).toBe(false);
    expect(janelaFechaEm(null)).toBeNull();
  });

  it('data inválida não abre a janela', () => {
    expect(janelaDeAtendimentoAberta('não é data', agora)).toBe(false);
  });

  it('diz quando fecha', () => {
    expect(janelaFechaEm('2026-09-27T10:00:00Z')?.toISOString()).toBe('2026-09-28T10:00:00.000Z');
  });
});

describe('status de entrega só avança', () => {
  it('segue a ordem enviando → enviada → entregue → lida', () => {
    expect(statusDeEntregaAvanca('enviando', 'enviada')).toBe(true);
    expect(statusDeEntregaAvanca('enviada', 'entregue')).toBe(true);
    expect(statusDeEntregaAvanca('entregue', 'lida')).toBe(true);
  });

  it('"lida" antes de "entregue" vale, e o "entregue" atrasado não a desfaz', () => {
    expect(statusDeEntregaAvanca('enviada', 'lida')).toBe(true);
    expect(statusDeEntregaAvanca('lida', 'entregue')).toBe(false);
  });

  it('a reentrega do mesmo status não muda nada', () => {
    expect(statusDeEntregaAvanca('entregue', 'entregue')).toBe(false);
  });

  it('falha só antes da entrega; depois dela, é aviso atrasado', () => {
    expect(statusDeEntregaAvanca('enviando', 'falhou')).toBe(true);
    expect(statusDeEntregaAvanca('enviada', 'falhou')).toBe(true);
    expect(statusDeEntregaAvanca('entregue', 'falhou')).toBe(false);
    expect(statusDeEntregaAvanca('lida', 'falhou')).toBe(false);
  });

  it('falhou é terminal', () => {
    expect(statusDeEntregaAvanca('falhou', 'entregue')).toBe(false);
  });

  it('sem status anterior, qualquer um entra', () => {
    expect(statusDeEntregaAvanca(null, 'entregue')).toBe(true);
  });
});

describe('contato do WhatsApp', () => {
  it('o wa_id sem o nono dígito cai no mesmo contato que o número com ele', () => {
    // Conta antiga: o WhatsApp devolve o celular brasileiro sem o nove.
    expect(contatoDoWhatsApp('551187654321')).toBe('11987654321');
    expect(contatoDoWhatsApp('5511987654321')).toBe('11987654321');
  });

  it('número estrangeiro fica com + e não colide com forma canônica', () => {
    expect(contatoDoWhatsApp('14155552671')).toBe('+14155552671');
  });

  it('envia para o wa_id quando o cliente já escreveu, senão para o número com DDI', () => {
    expect(enderecoDoWhatsApp('11987654321', '551187654321')).toBe('551187654321');
    expect(enderecoDoWhatsApp('11987654321')).toBe('5511987654321');
    expect(enderecoDoWhatsApp('+14155552671')).toBe('14155552671');
  });
});

describe('modelos', () => {
  it('renderiza o texto que o cliente vai ler e os parâmetros na ordem', () => {
    const r = renderizarModelo('primeiro_contato', {
      cliente: 'Maria', vendedor: 'Diego', loja: 'Auto Sul', veiculo: 'Onix  2021',
    });
    expect(r.parametros).toEqual(['Maria', 'Diego', 'Auto Sul', 'Onix 2021']);
    expect(r.texto).toBe(
      'Olá, Maria! Aqui é Diego, da Auto Sul. Recebemos seu interesse em Onix 2021. ' +
        'Posso te ajudar por aqui?',
    );
  });

  it('campo vazio é erro, não "Olá, !" no celular do cliente', () => {
    expect(() => renderizarModelo('retomar_conversa', { cliente: '  ', loja: 'Auto Sul' })).toThrow(
      /cliente/,
    );
  });

  it('todo placeholder do texto tem campo, e todo campo tem placeholder', () => {
    for (const modelo of Object.values(MODELOS_DE_WHATSAPP)) {
      const numeros = [...modelo.texto.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect([...new Set(numeros)].sort()).toEqual(modelo.campos.map((_, i) => i + 1));
    }
  });

  it('nomes no formato que a Meta aceita: minúsculas, dígitos e sublinhado', () => {
    for (const modelo of Object.values(MODELOS_DE_WHATSAPP)) {
      expect(modelo.nome).toMatch(/^[a-z0-9_]{1,512}$/);
    }
  });

  it('o lembrete de agendamento não aparece na escolha manual', () => {
    expect(MODELOS_MANUAIS).toEqual(['primeiro_contato', 'retomar_conversa', 'retorno_proposta']);
  });
});

describe('chave de idempotência', () => {
  it('mensagem pelo id; status pelo id e pelo status', () => {
    const em = new Date();
    expect(
      chaveDoEventoDeWhatsApp({
        tipo: 'mensagem', idExterno: 'wamid.A', conta: '1', de: '55', nome: null,
        formato: 'texto', texto: 'oi', recebidaEm: em,
      }),
    ).toBe('msg:wamid.A');
    expect(
      chaveDoEventoDeWhatsApp({
        tipo: 'status', idExterno: 'wamid.A', conta: '1', status: 'lida', em, erro: null,
      }),
    ).toBe('status:wamid.A:lida');
  });
});
