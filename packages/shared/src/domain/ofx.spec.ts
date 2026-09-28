import {
  dataDoOfx, lerOfx, sugerirConciliacao, JANELA_DE_CONCILIACAO_DIAS,
  type CandidatoParaConciliar,
} from './ofx';

/** Um extrato como os bancos brasileiros emitem: SGML, tag sem fechamento. */
const EXTRATO = `
OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260910120000[-3:BRT]
<TRNAMT>-1200.00
<FITID>202609100001
<MEMO>PAGAMENTO FUNILARIA SILVA
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260912
<TRNAMT>80000.00
<FITID>202609120007
<NAME>TED RECEBIDA
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('lerOfx', () => {
  it('lê as transações com tag sem fechamento, que é como o banco emite', () => {
    const { transacoes, ignoradas } = lerOfx(EXTRATO);

    expect(ignoradas).toBe(0);
    expect(transacoes).toHaveLength(2);
    expect(transacoes[0]).toMatchObject({
      fitid: '202609100001',
      valor: '1200.00',
      direction: 'saida',
      descricao: 'PAGAMENTO FUNILARIA SILVA',
    });
    // O sinal vira direção: `value` positivo é a regra do módulo inteiro.
    expect(transacoes[1]).toMatchObject({ valor: '80000.00', direction: 'entrada' });
  });

  it('a hora e o fuso do arquivo são descartados — o extrato diz o dia', () => {
    // Guardar 00:00 de um fuso faria a conciliação errar por um dia em metade
    // dos casos, justamente nos lançamentos do começo e do fim do dia.
    const [primeira] = lerOfx(EXTRATO).transacoes;
    expect(primeira!.data.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('aceita vírgula decimal, que emissor brasileiro manda apesar da especificação', () => {
    const { transacoes } = lerOfx(`<STMTTRN><DTPOSTED>20260901<TRNAMT>-1.234,50<FITID>x</STMTTRN>`);
    expect(transacoes[0]).toMatchObject({ valor: '1234.50', direction: 'saida' });
  });

  it('conta o que não deu para ler, em vez de sumir com a linha', () => {
    const { transacoes, ignoradas } = lerOfx(`
      <STMTTRN><DTPOSTED>20260901<TRNAMT>10.00<FITID>ok</STMTTRN>
      <STMTTRN><DTPOSTED>20260901<TRNAMT>abc<FITID>lixo</STMTTRN>
      <STMTTRN><DTPOSTED>20260901<TRNAMT>10.00</STMTTRN>
      <STMTTRN><DTPOSTED>20260901<TRNAMT>0.00<FITID>zero</STMTTRN>`);

    expect(transacoes).toHaveLength(1);
    // Sem FITID, valor ilegível e valor zero: três motivos, e nenhum silencioso.
    expect(ignoradas).toBe(3);
  });

  it('arquivo vazio ou de outro formato devolve lista vazia, não erro', () => {
    // Recusar o arquivo do cliente por causa do cabeçalho seria recusar o
    // extrato dele; o que não dá para ler aparece como zero transações.
    expect(lerOfx('').transacoes).toHaveLength(0);
    expect(lerOfx('{"json": true}').transacoes).toHaveLength(0);
  });
});

describe('dataDoOfx', () => {
  it('aceita as duas formas e recusa o resto', () => {
    expect(dataDoOfx('20260928')!.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(dataDoOfx('20260928235959[-3:BRT]')!.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(dataDoOfx('28/09/2026')).toBeNull();
  });
});

describe('sugerirConciliacao', () => {
  const t = (fitid: string, valor: string, direction: 'entrada' | 'saida', dia: number) => ({
    fitid, valor, direction, descricao: '',
    data: new Date(Date.UTC(2026, 8, dia)),
  });
  const c = (id: string, valor: string, direction: 'entrada' | 'saida', dia: number): CandidatoParaConciliar => ({
    id, valor, direction, data: new Date(Date.UTC(2026, 8, dia)),
  });

  it('casa por valor igual e data próxima, e marca alta quando é o mesmo dia', () => {
    const s = sugerirConciliacao([t('f1', '1200.00', 'saida', 10)], [c('l1', '1200.00', 'saida', 10)]);
    expect(s).toEqual([{ fitid: 'f1', lancamentoId: 'l1', distanciaEmDias: 0, confianca: 'alta' }]);
  });

  it('valor diferente não casa — nem por um centavo', () => {
    // Conciliar por aproximação seria inventar que 1.199,90 é 1.200,00, e uma
    // vez aceito o lojista para de conferir.
    expect(sugerirConciliacao(
      [t('f1', '1200.00', 'saida', 10)],
      [c('l1', '1199.90', 'saida', 10)],
    )).toHaveLength(0);
  });

  it('direção diferente não casa', () => {
    expect(sugerirConciliacao(
      [t('f1', '1200.00', 'entrada', 10)],
      [c('l1', '1200.00', 'saida', 10)],
    )).toHaveLength(0);
  });

  it('fora da janela não casa; dentro dela, casa como média', () => {
    const dentro = sugerirConciliacao(
      [t('f1', '500.00', 'saida', 10)],
      [c('l1', '500.00', 'saida', 10 + JANELA_DE_CONCILIACAO_DIAS)],
    );
    expect(dentro[0]).toMatchObject({ confianca: 'media', distanciaEmDias: JANELA_DE_CONCILIACAO_DIAS });

    expect(sugerirConciliacao(
      [t('f1', '500.00', 'saida', 10)],
      [c('l1', '500.00', 'saida', 10 + JANELA_DE_CONCILIACAO_DIAS + 1)],
    )).toHaveLength(0);
  });

  it('empate de valor resolve pela data mais próxima', () => {
    const s = sugerirConciliacao(
      [t('f1', '500.00', 'saida', 10)],
      [c('longe', '500.00', 'saida', 13), c('perto', '500.00', 'saida', 11)],
    );
    expect(s[0]!.lancamentoId).toBe('perto');
  });

  it('um lançamento é sugerido uma vez só — senão o mesmo dinheiro baixaria duas', () => {
    const s = sugerirConciliacao(
      [t('f1', '500.00', 'saida', 10), t('f2', '500.00', 'saida', 10)],
      [c('l1', '500.00', 'saida', 10)],
    );
    expect(s).toHaveLength(1);
    expect(s[0]!.fitid).toBe('f1');
  });

  it('sem candidato, devolve lista vazia em vez de sugerir qualquer coisa', () => {
    expect(sugerirConciliacao([t('f1', '500.00', 'saida', 10)], [])).toEqual([]);
  });
});
