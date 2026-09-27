import {
  CATEGORIAS_PADRAO, diasDeAtraso, estaAtrasado, mesEstaFechado, podeAlterar,
  saldoDaConta, saldoPrevisto, somarLancamentos,
  type LancamentoParaRegra,
} from './financeiro';

const HOJE = new Date('2026-09-27T15:00:00Z');

const lanc = (p: Partial<LancamentoParaRegra> = {}): LancamentoParaRegra => ({
  direction: 'saida',
  status: 'previsto',
  value: '100.00',
  dueDate: new Date('2026-09-27T00:00:00Z'),
  ...p,
});

describe('atraso', () => {
  it('vence hoje não está atrasado — a comparação é por dia, não por instante', () => {
    // `dueDate < agora` diria que um boleto que vence hoje às 23h já atrasou
    // às 9h da manhã.
    expect(estaAtrasado(lanc({ dueDate: new Date('2026-09-27T00:00:00Z') }), HOJE)).toBe(false);
  });

  it('venceu ontem está atrasado, e conta os dias', () => {
    const l = lanc({ dueDate: new Date('2026-09-24T00:00:00Z') });
    expect(estaAtrasado(l, HOJE)).toBe(true);
    expect(diasDeAtraso(l, HOJE)).toBe(3);
  });

  it('pago e cancelado nunca atrasam', () => {
    const vencido = { dueDate: new Date('2026-08-01T00:00:00Z') };
    expect(estaAtrasado(lanc({ ...vencido, status: 'pago' }), HOJE)).toBe(false);
    // Ninguém cobra o que a loja desistiu de cobrar.
    expect(estaAtrasado(lanc({ ...vencido, status: 'cancelado' }), HOJE)).toBe(false);
    expect(diasDeAtraso(lanc({ ...vencido, status: 'pago' }), HOJE)).toBe(0);
  });
});

describe('saldo', () => {
  const pagos: LancamentoParaRegra[] = [
    lanc({ direction: 'entrada', status: 'pago', value: '80000.00' }),
    lanc({ direction: 'saida', status: 'pago', value: '71000.50' }),
  ];

  it('saldo é inicial + entradas pagas − saídas pagas', () => {
    expect(saldoDaConta('1000.00', pagos)).toBe('9999.50');
  });

  it('previsto não entra no saldo — não é dinheiro ainda', () => {
    const com = [...pagos, lanc({ direction: 'entrada', status: 'previsto', value: '50000.00' })];
    expect(saldoDaConta('1000.00', com)).toBe('9999.50');
  });

  it('cancelado não entra em nada', () => {
    const com = [...pagos, lanc({ direction: 'saida', status: 'cancelado', value: '5000.00' })];
    expect(saldoDaConta('0.00', com)).toBe('8999.50');
  });

  it('centavo não se perde: 0,10 + 0,20 é 0,30', () => {
    // A razão de tudo passar por centavos em `bigint`.
    const soma = [
      lanc({ direction: 'entrada', status: 'pago', value: '0.10' }),
      lanc({ direction: 'entrada', status: 'pago', value: '0.20' }),
    ];
    expect(saldoDaConta('0.00', soma)).toBe('0.30');
  });

  it('saldo pode ficar negativo — e diz isso em vez de zerar', () => {
    expect(saldoDaConta('100.00', [lanc({ status: 'pago', value: '250.00' })])).toBe('-150.00');
  });
});

describe('saldo previsto', () => {
  const l: LancamentoParaRegra[] = [
    lanc({ direction: 'entrada', status: 'pago', value: '10000.00' }),
    lanc({ direction: 'saida', status: 'previsto', value: '3000.00', dueDate: new Date('2026-09-30T00:00:00Z') }),
    lanc({ direction: 'saida', status: 'previsto', value: '8000.00', dueDate: new Date('2026-10-15T00:00:00Z') }),
  ];

  it('até o fim do mês, só o que vence até lá', () => {
    expect(saldoPrevisto('0.00', l, new Date('2026-09-30T00:00:00Z'))).toBe('7000.00');
  });

  it('até meados do mês seguinte, o caixa fica negativo — é a pergunta do dono', () => {
    expect(saldoPrevisto('0.00', l, new Date('2026-10-20T00:00:00Z'))).toBe('-1000.00');
  });

  it('previsto vencido conta: quem não pagou ainda deve', () => {
    const atrasado = [lanc({ direction: 'saida', status: 'previsto', value: '500.00', dueDate: new Date('2026-08-01T00:00:00Z') })];
    expect(saldoPrevisto('1000.00', atrasado, HOJE)).toBe('500.00');
  });
});

describe('somarLancamentos', () => {
  it('soma sem olhar direção nem status — quem filtra é quem chama', () => {
    expect(somarLancamentos([lanc({ value: '1.10' }), lanc({ value: '2.20' })])).toBe('3.30');
  });

  it('lista vazia é zero, não erro', () => {
    expect(somarLancamentos([])).toBe('0.00');
  });
});

describe('mês fechado', () => {
  const fechados = [{ year: 2026, month: 8 }];

  it('a trava é pelo vencimento, não pela data de digitação', () => {
    // Fechar agosto diz "agosto está conferido"; um lançamento novo com
    // vencimento em agosto mudaria o resultado de um mês já fechado.
    expect(mesEstaFechado(new Date('2026-08-31T00:00:00Z'), fechados)).toBe(true);
    expect(mesEstaFechado(new Date('2026-09-01T00:00:00Z'), fechados)).toBe(false);
  });

  it('lançamento em mês fechado não se altera, e a mensagem diz o caminho', () => {
    const v = podeAlterar(lanc({ dueDate: new Date('2026-08-10T00:00:00Z') }), fechados);
    expect(v.pode).toBe(false);
    expect(v.motivo).toContain('08/2026');
    expect(v.motivo).toContain('Reabra');
  });

  it('cancelado é definitivo — para voltar atrás, cria-se outro', () => {
    const v = podeAlterar(lanc({ status: 'cancelado' }), []);
    expect(v.pode).toBe(false);
    expect(v.motivo).toContain('Crie outro');
  });

  it('o resto se altera', () => {
    expect(podeAlterar(lanc(), fechados)).toEqual({ pode: true });
  });
});

describe('plano de contas padrão', () => {
  it('cobre as duas direções e não repete nome dentro da mesma', () => {
    for (const dir of ['entrada', 'saida'] as const) {
      const nomes = CATEGORIAS_PADRAO.filter((c) => c.direction === dir).map((c) => c.name);
      expect(nomes.length).toBeGreaterThan(2);
      expect(new Set(nomes).size).toBe(nomes.length);
    }
  });

  it('tem as duas linhas que mais pesam no caixa de uma revenda', () => {
    const saidas = CATEGORIAS_PADRAO.filter((c) => c.direction === 'saida').map((c) => c.name);
    expect(saidas).toContain('Compra de veículo');
    expect(saidas).toContain('Preparação e funilaria');
  });
});
