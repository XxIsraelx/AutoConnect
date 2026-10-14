import {
  aplicarRetorno, podeCancelar, PRAZO_DE_CANCELAMENTO_HORAS,
  type EstadoDaNota, type RetornoDoEmissor,
} from './emissao-nfe';

const CHAVE = '35261011222333000181550010000012341123456787';

const retorno = (r: Partial<RetornoDoEmissor>): RetornoDoEmissor => ({
  referencia: 'ref-1', situacao: 'processando', ocorridoEm: '2026-10-14T12:00:00Z', ...r,
});
const autorizacao = retorno({ situacao: 'autorizada', chave: CHAVE, protocolo: '135260000000001', numero: 1234 });

const processando: EstadoDaNota = { status: 'processando', chave: null };
const autorizada: EstadoDaNota = { status: 'autorizada', chave: CHAVE };

describe('aplicarRetorno', () => {
  it('processando → autorizada, rejeitada ou denegada', () => {
    expect(aplicarRetorno(processando, autorizacao)).toEqual({ status: 'autorizada', mudou: true });
    expect(aplicarRetorno(processando, retorno({ situacao: 'rejeitada', motivo: '539 Duplicidade' })))
      .toEqual({ status: 'rejeitada', mudou: true });
    expect(aplicarRetorno(processando, retorno({ situacao: 'denegada' })))
      .toEqual({ status: 'denegada', mudou: true });
  });

  it('autorização sem chave válida ou sem protocolo não autoriza', () => {
    const semChave = aplicarRetorno(processando, { ...autorizacao, chave: CHAVE.slice(0, 43) + '0' });
    expect(semChave).toMatchObject({ status: 'processando', mudou: false });
    expect(semChave.aviso).toContain('chave');
    expect(aplicarRetorno(processando, { ...autorizacao, protocolo: null }).status).toBe('processando');
  });

  it('reentrega da autorização não muda nada; outra chave é ignorada com aviso', () => {
    expect(aplicarRetorno(autorizada, autorizacao)).toEqual({ status: 'autorizada', mudou: false, aviso: undefined });
    const outra = aplicarRetorno(autorizada, { ...autorizacao, chave: '35261011222333000181550010000099991123456780' });
    expect(outra).toMatchObject({ status: 'autorizada', mudou: false });
    expect(outra.aviso).toContain('outra chave');
  });

  it('autorizada → cancelada; cancelamento recusado mantém autorizada e diz o motivo', () => {
    expect(aplicarRetorno(autorizada, retorno({ situacao: 'cancelada' }))).toEqual({ status: 'cancelada', mudou: true });
    const recusado = aplicarRetorno(autorizada, retorno({ situacao: 'cancelamento_rejeitado', motivo: 'Prazo excedido' }));
    expect(recusado).toMatchObject({ status: 'autorizada', mudou: false });
    expect(recusado.aviso).toContain('Prazo excedido');
  });

  it('estado terminal não volta — autorização atrasada não desfaz o cancelamento', () => {
    const cancelada: EstadoDaNota = { status: 'cancelada', chave: CHAVE };
    expect(aplicarRetorno(cancelada, autorizacao)).toMatchObject({ status: 'cancelada', mudou: false });
    expect(aplicarRetorno(cancelada, retorno({ situacao: 'cancelada' }))).toEqual({ status: 'cancelada', mudou: false, aviso: undefined });
    expect(aplicarRetorno({ status: 'rejeitada', chave: null }, autorizacao)).toMatchObject({ status: 'rejeitada', mudou: false });
  });

  it('cancelamento de nota ainda processando é ignorado', () => {
    expect(aplicarRetorno(processando, retorno({ situacao: 'cancelada' }))).toMatchObject({ status: 'processando', mudou: false });
  });
});

describe('podeCancelar', () => {
  const autorizadaEm = '2026-10-14T12:00:00Z';
  const depois = (h: number) => new Date(new Date(autorizadaEm).getTime() + h * 3_600_000);

  it(`dentro de ${PRAZO_DE_CANCELAMENTO_HORAS} horas, pode`, () => {
    expect(podeCancelar({ status: 'autorizada', autorizadaEm }, depois(23.9))).toEqual({ pode: true });
  });

  it('fora do prazo, não — e o motivo manda falar com o contador', () => {
    const r = podeCancelar({ status: 'autorizada', autorizadaEm }, depois(24.1));
    expect(r.pode).toBe(false);
    if (!r.pode) expect(r.motivo).toContain('contador');
  });

  it('nota que não está autorizada não se cancela', () => {
    expect(podeCancelar({ status: 'processando', autorizadaEm: null }, depois(1)).pode).toBe(false);
    expect(podeCancelar({ status: 'cancelada', autorizadaEm }, depois(1)).pode).toBe(false);
  });
});
