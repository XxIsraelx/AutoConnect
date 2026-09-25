import {
  MOTIVO, TIPOS_DE_SAQUE, VALIDADE_PADRAO_DA_AUTORIZACAO_MIN,
  decidirSaque, ehTipoDeSaque, expiraEm, situacaoDaAutorizacao,
  type AutorizacaoDeSaque, type PedidoDeSaque,
} from './saque';

const AGORA = new Date('2026-09-25T12:00:00.000Z');

function autorizacao(campos: Partial<AutorizacaoDeSaque> = {}): AutorizacaoDeSaque {
  return {
    id: 'a1',
    tipo: 'TRANSFER',
    modo: 'exato',
    valorCentavos: 400_000n,
    expiraEm: new Date(AGORA.getTime() + 30 * 60_000),
    usadaEm: null,
    revogadaEm: null,
    ...campos,
  };
}

function pedido(campos: Partial<PedidoDeSaque> = {}): PedidoDeSaque {
  return { tipo: 'TRANSFER', idOperacao: 'op-1', valorCentavos: 400_000n, ...campos };
}

describe('decidirSaque', () => {
  it('recusa quando não há autorização nenhuma — o padrão é não', () => {
    expect(decidirSaque(pedido(), [], AGORA)).toEqual({
      aprovado: false,
      motivo: MOTIVO.semAutorizacao,
      autorizacaoId: null,
    });
  });

  it('aprova e aponta a autorização que casou', () => {
    const veredicto = decidirSaque(pedido(), [autorizacao()], AGORA);

    expect(veredicto).toEqual({ aprovado: true, motivo: null, autorizacaoId: 'a1' });
  });

  it('recusa valor diferente do exato — para mais e para menos', () => {
    const acima = decidirSaque(pedido({ valorCentavos: 400_001n }), [autorizacao()], AGORA);
    const abaixo = decidirSaque(pedido({ valorCentavos: 399_999n }), [autorizacao()], AGORA);

    expect(acima.aprovado).toBe(false);
    // Nem um centavo a menos: o valor é a identidade do saque autorizado, não
    // um limite. Quem quer folga usa o modo `teto`.
    expect(abaixo.aprovado).toBe(false);
  });

  it('no modo teto aceita até o valor, e recusa acima', () => {
    const teto = [autorizacao({ modo: 'teto', valorCentavos: 400_000n })];

    expect(decidirSaque(pedido({ valorCentavos: 399_999n }), teto, AGORA).aprovado).toBe(true);
    expect(decidirSaque(pedido({ valorCentavos: 400_000n }), teto, AGORA).aprovado).toBe(true);
    expect(decidirSaque(pedido({ valorCentavos: 400_001n }), teto, AGORA).aprovado).toBe(false);
  });

  it('recusa autorização expirada, mesmo por um milissegundo', () => {
    const vencida = [autorizacao({ expiraEm: AGORA })];

    expect(decidirSaque(pedido(), vencida, AGORA).motivo).toBe(MOTIVO.semAutorizacao);
  });

  it('recusa autorização já usada — uso único', () => {
    const usada = [autorizacao({ usadaEm: new Date(AGORA.getTime() - 60_000) })];

    expect(decidirSaque(pedido(), usada, AGORA).aprovado).toBe(false);
  });

  it('recusa autorização revogada', () => {
    const revogada = [autorizacao({ revogadaEm: new Date(AGORA.getTime() - 60_000) })];

    expect(decidirSaque(pedido(), revogada, AGORA).aprovado).toBe(false);
  });

  it('recusa tipo de operação diferente do autorizado', () => {
    const paraTransferencia = [autorizacao({ tipo: 'TRANSFER' })];

    expect(decidirSaque(pedido({ tipo: 'PIX_QR_CODE' }), paraTransferencia, AGORA).aprovado).toBe(false);
  });

  it('recusa valor zero ou negativo mesmo com teto folgado', () => {
    const teto = [autorizacao({ modo: 'teto', valorCentavos: 1_000_000n })];

    expect(decidirSaque(pedido({ valorCentavos: 0n }), teto, AGORA).aprovado).toBe(false);
    expect(decidirSaque(pedido({ valorCentavos: -1n }), teto, AGORA).aprovado).toBe(false);
  });

  it('entre várias que casam, escolhe a mais apertada', () => {
    const larga = autorizacao({ id: 'larga', modo: 'teto', valorCentavos: 1_000_000n });
    const justa = autorizacao({ id: 'justa', modo: 'exato', valorCentavos: 400_000n });

    expect(decidirSaque(pedido(), [larga, justa], AGORA).autorizacaoId).toBe('justa');
    // E a ordem da lista não muda a escolha.
    expect(decidirSaque(pedido(), [justa, larga], AGORA).autorizacaoId).toBe('justa');
  });

  it('empatadas no valor, escolhe a que expira antes', () => {
    const tarde = autorizacao({ id: 'tarde', expiraEm: new Date(AGORA.getTime() + 20 * 60_000) });
    const cedo = autorizacao({ id: 'cedo', expiraEm: new Date(AGORA.getTime() + 5 * 60_000) });

    expect(decidirSaque(pedido(), [tarde, cedo], AGORA).autorizacaoId).toBe('cedo');
  });
});

describe('tipos e validade', () => {
  it('reconhece só os tipos previstos', () => {
    expect(TIPOS_DE_SAQUE.every(ehTipoDeSaque)).toBe(true);
    expect(ehTipoDeSaque('TRANSFER_ALL_MY_MONEY')).toBe(false);
    expect(ehTipoDeSaque('')).toBe(false);
  });

  it('a validade padrão é curta', () => {
    expect(VALIDADE_PADRAO_DA_AUTORIZACAO_MIN).toBeLessThanOrEqual(60);
    expect(expiraEm(VALIDADE_PADRAO_DA_AUTORIZACAO_MIN, AGORA).getTime())
      .toBe(AGORA.getTime() + 30 * 60_000);
  });
});

describe('situacaoDaAutorizacao', () => {
  it('classifica pelo motivo mais forte primeiro', () => {
    const base = { expiraEm: new Date(AGORA.getTime() + 60_000), usadaEm: null, revogadaEm: null };

    expect(situacaoDaAutorizacao(base, AGORA)).toBe('valida');
    expect(situacaoDaAutorizacao({ ...base, usadaEm: AGORA }, AGORA)).toBe('usada');
    expect(situacaoDaAutorizacao({ ...base, revogadaEm: AGORA }, AGORA)).toBe('revogada');
    expect(situacaoDaAutorizacao({ ...base, expiraEm: AGORA }, AGORA)).toBe('expirada');
  });
});
