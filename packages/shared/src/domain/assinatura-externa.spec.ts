import {
  aplicarEventoDeAssinatura,
  assinaturaExternaViva,
  ASSINATURA_EXTERNA_STATUSES,
  type EstadoDaSolicitacao,
  type AssinaturaExternaStatus,
} from './assinatura-externa';

const quando = new Date('2026-09-22T12:00:00Z');

const enviado = (): EstadoDaSolicitacao => ({
  status: 'sent',
  signatarios: [
    { papel: 'dealer', nome: 'Loja', email: 'rep@loja.test', idExterno: 'sig-d', status: 'enviado' },
    { papel: 'customer', nome: 'Maria', email: 'maria@x.test', idExterno: 'sig-c', status: 'enviado' },
  ],
});

describe('aplicarEventoDeAssinatura', () => {
  it('assinou marca só o signatário do evento, pelo id externo', () => {
    const r = aplicarEventoDeAssinatura(enviado(), {
      tipo: 'assinou', idSignatarioExterno: 'sig-c', ocorridoEm: quando,
    });

    expect(r.mudou).toBe(true);
    expect(r.concluir).toBe(false);
    expect(r.estado.status).toBe('sent');
    expect(r.estado.signatarios.map((s) => s.status)).toEqual(['enviado', 'assinou']);
    expect(r.estado.signatarios[1]?.ocorridoEm).toBe(quando.toISOString());
  });

  it('assinou também casa pelo papel quando o provedor não manda id', () => {
    const r = aplicarEventoDeAssinatura(enviado(), { tipo: 'assinou', papel: 'dealer', ocorridoEm: quando });

    expect(r.estado.signatarios.map((s) => s.status)).toEqual(['assinou', 'enviado']);
  });

  it('id do provedor que não casa com ninguém cai para o papel', () => {
    const r = aplicarEventoDeAssinatura(enviado(), {
      tipo: 'assinou', idSignatarioExterno: 'chave-legada', papel: 'customer', ocorridoEm: quando,
    });

    expect(r.estado.signatarios.map((s) => s.status)).toEqual(['enviado', 'assinou']);
  });

  it('id que casa vence o papel', () => {
    const r = aplicarEventoDeAssinatura(enviado(), {
      tipo: 'assinou', idSignatarioExterno: 'sig-d', papel: 'customer', ocorridoEm: quando,
    });

    expect(r.estado.signatarios.map((s) => s.status)).toEqual(['assinou', 'enviado']);
  });

  it('id que não casa e sem papel não marca ninguém', () => {
    const r = aplicarEventoDeAssinatura(enviado(), {
      tipo: 'assinou', idSignatarioExterno: 'chave-legada', ocorridoEm: quando,
    });

    expect(r.mudou).toBe(false);
  });

  it('o mesmo assinou duas vezes não muda nada na segunda (entrega repetida)', () => {
    const uma = aplicarEventoDeAssinatura(enviado(), { tipo: 'assinou', papel: 'dealer', ocorridoEm: quando });
    const duas = aplicarEventoDeAssinatura(uma.estado, {
      tipo: 'assinou', papel: 'dealer', ocorridoEm: new Date('2026-09-23T00:00:00Z'),
    });

    expect(duas.mudou).toBe(false);
    // O horário é o da primeira entrega, não o da repetição.
    expect(duas.estado.signatarios[0]?.ocorridoEm).toBe(quando.toISOString());
  });

  it('assinar todos não conclui sozinho — quem conclui é o evento do provedor', () => {
    let e = enviado();
    e = aplicarEventoDeAssinatura(e, { tipo: 'assinou', papel: 'dealer', ocorridoEm: quando }).estado;
    const r = aplicarEventoDeAssinatura(e, { tipo: 'assinou', papel: 'customer', ocorridoEm: quando });

    expect(r.estado.status).toBe('sent');
    expect(r.concluir).toBe(false);
  });

  it('concluido fecha e pede para concluir o contrato', () => {
    const r = aplicarEventoDeAssinatura(enviado(), { tipo: 'concluido', ocorridoEm: quando });

    expect(r).toMatchObject({ mudou: true, concluir: true });
    expect(r.estado.status).toBe('completed');
    // Fora de ordem: o concluido chegou antes dos assinou, e o resultado é o mesmo.
    expect(r.estado.signatarios.every((s) => s.status === 'assinou')).toBe(true);
  });

  it('assinou atrasado, depois do concluido, é ignorado', () => {
    const c = aplicarEventoDeAssinatura(enviado(), { tipo: 'concluido', ocorridoEm: quando });
    const r = aplicarEventoDeAssinatura(c.estado, { tipo: 'assinou', papel: 'dealer', ocorridoEm: quando });

    expect(r.mudou).toBe(false);
    expect(r.concluir).toBe(false);
  });

  it('concluido repetido não conclui duas vezes', () => {
    const c = aplicarEventoDeAssinatura(enviado(), { tipo: 'concluido', ocorridoEm: quando });
    const r = aplicarEventoDeAssinatura(c.estado, { tipo: 'concluido', ocorridoEm: quando });

    expect(r).toMatchObject({ mudou: false, concluir: false });
  });

  it('recusou encerra a solicitação', () => {
    const r = aplicarEventoDeAssinatura(enviado(), { tipo: 'recusou', papel: 'customer', ocorridoEm: quando });

    expect(r.estado.status).toBe('refused');
    expect(r.estado.signatarios[1]?.status).toBe('recusou');
    expect(r.concluir).toBe(false);
  });

  it.each(['canceled', 'expired', 'refused', 'failed', 'pending'] as AssinaturaExternaStatus[])(
    'solicitação em %s não aceita conclusão (ex.: contrato anulado aqui)',
    (status) => {
      const r = aplicarEventoDeAssinatura({ ...enviado(), status }, { tipo: 'concluido', ocorridoEm: quando });

      expect(r).toMatchObject({ mudou: false, concluir: false });
      expect(r.estado.status).toBe(status);
    },
  );

  it('expirou e cancelado encerram sem concluir', () => {
    expect(aplicarEventoDeAssinatura(enviado(), { tipo: 'expirou', ocorridoEm: quando }).estado.status)
      .toBe('expired');
    expect(aplicarEventoDeAssinatura(enviado(), { tipo: 'cancelado', ocorridoEm: quando }).estado.status)
      .toBe('canceled');
  });

  it('ignorado não muda nada', () => {
    expect(aplicarEventoDeAssinatura(enviado(), { tipo: 'ignorado', ocorridoEm: quando }).mudou).toBe(false);
  });
});

describe('assinaturaExternaViva', () => {
  it('só pending e sent seguram o contrato', () => {
    const vivas = ASSINATURA_EXTERNA_STATUSES.filter(assinaturaExternaViva);
    expect(vivas).toEqual(['pending', 'sent']);
  });
});
