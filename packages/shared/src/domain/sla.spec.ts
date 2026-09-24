import {
  EXPEDIENTE_PADRAO,
  FUSO_PADRAO,
  calcularPrazoDeResposta,
  contaComoPrimeiraResposta,
  expedienteOuPadrao,
  expedienteValido,
  limiteDeAlertaSegundos,
  situacaoDoSla,
} from './sla';

/**
 * O relógio do SLA.
 *
 * Tudo aqui é em `America/Sao_Paulo` (UTC−3, sem horário de verão desde 2019),
 * então "13:00Z" é "10:00" na loja. Os instantes são escritos em UTC de
 * propósito: é assim que chegam do banco, e escrever a hora local esconderia
 * justamente o erro que este arquivo existe para pegar.
 */
describe('prazo de primeiro contato', () => {
  const seg = (hhmmZ: string) => new Date(`2026-09-21T${hhmmZ}:00.000Z`); // segunda
  const sab = (hhmmZ: string) => new Date(`2026-09-26T${hhmmZ}:00.000Z`); // sábado
  const dom = (hhmmZ: string) => new Date(`2026-09-27T${hhmmZ}:00.000Z`); // domingo

  it('dentro do expediente, soma os minutos direto', () => {
    // 13:00Z = 10:00 na loja, dentro de 09–18.
    const prazo = calcularPrazoDeResposta(seg('13:00'), 15, EXPEDIENTE_PADRAO, FUSO_PADRAO);

    expect(prazo?.toISOString()).toBe('2026-09-21T13:15:00.000Z');
  });

  it('antes da abertura, o relógio só começa quando a loja abre', () => {
    // 09:00Z = 06:00 na loja. A loja abre às 09:00 locais = 12:00Z.
    const prazo = calcularPrazoDeResposta(seg('09:00'), 15, EXPEDIENTE_PADRAO, FUSO_PADRAO);

    expect(prazo?.toISOString()).toBe('2026-09-21T12:15:00.000Z');
  });

  it('depois do fechamento, cai na abertura do dia seguinte', () => {
    // 23:00Z de segunda = 20:00 local, loja fechada. Abre terça 09:00 = 12:00Z.
    const prazo = calcularPrazoDeResposta(seg('23:00'), 15, EXPEDIENTE_PADRAO, FUSO_PADRAO);

    expect(prazo?.toISOString()).toBe('2026-09-22T12:15:00.000Z');
  });

  it('atravessa o fechamento consumindo o que sobra no dia seguinte', () => {
    // 20:50Z = 17:50 local; restam 10 min até as 18:00. Um prazo de 30 min
    // consome 10 hoje e 20 amanhã, a partir das 09:00 locais (12:00Z).
    const prazo = calcularPrazoDeResposta(seg('20:50'), 30, EXPEDIENTE_PADRAO, FUSO_PADRAO);

    expect(prazo?.toISOString()).toBe('2026-09-22T12:20:00.000Z');
  });

  it('domingo fechado empurra para segunda — o lead não nasce estourado', () => {
    // Domingo 14:00Z = 11:00 local. Próxima abertura: segunda 09:00 = 12:00Z.
    const prazo = calcularPrazoDeResposta(dom('14:00'), 15, EXPEDIENTE_PADRAO, FUSO_PADRAO);

    expect(prazo?.toISOString()).toBe('2026-09-28T12:15:00.000Z');
  });

  it('sábado tem expediente próprio e o prazo respeita o fechamento mais cedo', () => {
    // Sábado 15:55Z = 12:55 local; sábado fecha às 13:00. Restam 5 min, o
    // prazo de 20 consome os 5 e vira para segunda.
    const prazo = calcularPrazoDeResposta(sab('15:55'), 20, EXPEDIENTE_PADRAO, FUSO_PADRAO);

    expect(prazo?.toISOString()).toBe('2026-09-28T12:15:00.000Z');
  });

  it('loja fechada todos os dias não produz prazo nenhum', () => {
    const fechada = Object.fromEntries(
      Object.entries(EXPEDIENTE_PADRAO).map(([d, v]) => [d, { ...v, closed: true }]),
    );

    // Sem hora de funcionamento não há prazo a cobrar — inventar um produziria
    // alarme sobre uma loja que nunca abriu.
    expect(calcularPrazoDeResposta(seg('13:00'), 15, fechada, FUSO_PADRAO)).toBeNull();
  });

  it('prazo zero ou negativo não vira prazo', () => {
    expect(calcularPrazoDeResposta(seg('13:00'), 0)).toBeNull();
    expect(calcularPrazoDeResposta(seg('13:00'), -5)).toBeNull();
  });

  it('respeita um expediente próprio da loja, não só o padrão', () => {
    const expediente = {
      ...EXPEDIENTE_PADRAO,
      '1': { closed: false, open: '14:00', close: '20:00' },
    };
    // 13:00Z = 10:00 local, antes das 14:00 → começa às 14:00 = 17:00Z.
    const prazo = calcularPrazoDeResposta(seg('13:00'), 30, expediente, FUSO_PADRAO);

    expect(prazo?.toISOString()).toBe('2026-09-21T17:30:00.000Z');
  });

  it('funciona em outro fuso — a loja é que define a hora', () => {
    // Manaus é UTC−4: 13:00Z = 09:00 local, exatamente a abertura.
    const prazo = calcularPrazoDeResposta(
      seg('13:00'), 15, EXPEDIENTE_PADRAO, 'America/Manaus',
    );

    expect(prazo?.toISOString()).toBe('2026-09-21T13:15:00.000Z');
  });
});

describe('expediente vindo do banco', () => {
  it('aceita o formato que /configuracoes grava', () => {
    expect(expedienteValido(EXPEDIENTE_PADRAO)).toBe(true);
  });

  it.each([
    ['nulo', null],
    ['vazio', {}],
    ['lista', [{ closed: false, open: '09:00', close: '18:00' }]],
    ['dia fora de 0..6', { '9': { closed: false, open: '09:00', close: '18:00' } }],
    ['sem os campos', { '1': { aberto: true } }],
  ])('recusa %s e cai no padrão', (_caso, valor) => {
    expect(expedienteValido(valor)).toBe(false);
    expect(expedienteOuPadrao(valor)).toBe(EXPEDIENTE_PADRAO);
  });
});

describe('situação do prazo', () => {
  const criadoEm = new Date('2026-09-21T13:00:00.000Z');
  const prazo = new Date('2026-09-21T13:20:00.000Z'); // 20 min de janela

  it('sem prazo não inventa etiqueta', () => {
    expect(situacaoDoSla({ criadoEm, prazo: null, respondidoEm: null }).situacao)
      .toBe('sem_prazo');
  });

  it('respondido antes do prazo', () => {
    const r = situacaoDoSla({
      criadoEm, prazo, respondidoEm: new Date('2026-09-21T13:05:00.000Z'),
    });
    expect(r.situacao).toBe('respondido');
  });

  it('respondido depois do prazo continua sendo um estouro contabilizado', () => {
    const r = situacaoDoSla({
      criadoEm, prazo, respondidoEm: new Date('2026-09-21T14:05:00.000Z'),
    });
    expect(r.situacao).toBe('respondido_fora_do_prazo');
  });

  it('no prazo enquanto sobra mais de um quarto da janela', () => {
    const r = situacaoDoSla(
      { criadoEm, prazo, respondidoEm: null },
      new Date('2026-09-21T13:10:00.000Z'), // faltam 10 de 20 min
    );
    expect(r.situacao).toBe('no_prazo');
    expect(r.restanteSegundos).toBe(600);
  });

  it('vencendo no último quarto da janela', () => {
    const r = situacaoDoSla(
      { criadoEm, prazo, respondidoEm: null },
      new Date('2026-09-21T13:17:00.000Z'), // faltam 3 de 20 min
    );
    expect(r.situacao).toBe('vencendo');
  });

  it('estourado depois do prazo, com o restante negativo', () => {
    const r = situacaoDoSla(
      { criadoEm, prazo, respondidoEm: null },
      new Date('2026-09-21T13:25:00.000Z'),
    );
    expect(r.situacao).toBe('estourado');
    expect(r.restanteSegundos).toBe(-300);
  });

  it('o limite de alerta da API manda mais que a fração da janela', () => {
    // O lead chegou de madrugada: a janela real vai da criação até a abertura
    // da loja mais 15 min, e um quarto dela seriam horas. Com o limite que a
    // API calcula (25% de 15 min = 225s), a etiqueta só avisa perto do prazo —
    // e concorda com o filtro "vencendo" da lista.
    const criadoDeMadrugada = new Date('2026-09-21T06:00:00.000Z');
    const prazo = new Date('2026-09-21T12:15:00.000Z');
    const lead = { criadoEm: criadoDeMadrugada, prazo, respondidoEm: null };

    const faltando10min = new Date('2026-09-21T12:05:00.000Z');
    expect(situacaoDoSla(lead, faltando10min).situacao).toBe('vencendo');
    expect(situacaoDoSla(lead, faltando10min, 225).situacao).toBe('no_prazo');

    const faltando2min = new Date('2026-09-21T12:13:00.000Z');
    expect(situacaoDoSla(lead, faltando2min, 225).situacao).toBe('vencendo');
  });

  it('aceita datas em string, que é como o JSON chega na tela', () => {
    const r = situacaoDoSla(
      {
        criadoEm: criadoEm.toISOString(),
        prazo: prazo.toISOString(),
        respondidoEm: null,
      },
      new Date('2026-09-21T13:10:00.000Z'),
    );
    expect(r.situacao).toBe('no_prazo');
  });
});

describe('limite de alerta', () => {
  it('é um quarto do prazo configurado', () => {
    expect(limiteDeAlertaSegundos(60)).toBe(900);
    expect(limiteDeAlertaSegundos(15)).toBe(225);
  });

  it('nunca desce abaixo de um minuto, mesmo com prazo curtíssimo', () => {
    // Com prazo de 1 minuto, um quarto seriam 15 segundos — a etiqueta piscaria
    // e o vendedor não veria.
    expect(limiteDeAlertaSegundos(1)).toBe(60);
  });
});

describe('o que conta como primeira resposta', () => {
  it.each(['call', 'whatsapp', 'email', 'chat'])('%s conta', (kind) => {
    expect(contaComoPrimeiraResposta(kind)).toBe(true);
  });

  it.each(['note', 'visit', 'created', 'assignment', 'duplicate', 'rotation'])(
    '%s não conta',
    (kind) => {
      // Nota interna é o caso que mais importa: escrever sobre o cliente não é
      // falar com ele, e contá-la mediria quem digita mais.
      expect(contaComoPrimeiraResposta(kind)).toBe(false);
    },
  );
});
