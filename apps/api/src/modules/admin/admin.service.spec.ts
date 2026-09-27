import { estadoDaCobrancaNoPainel, inicioDoMesEmSaoPaulo } from './admin.service';

/**
 * A API roda em UTC; as lojas, em São Paulo. "Este mês" no painel é o mês de
 * lá — senão, das 21h à meia-noite do último dia, o gasto com consulta e o
 * faturamento do mês apareceriam zerados.
 */
describe('inicioDoMesEmSaoPaulo', () => {
  it('meio do mês: dia 1 às 00h de São Paulo (03h UTC)', () => {
    expect(inicioDoMesEmSaoPaulo(new Date('2026-09-22T15:00:00Z')).toISOString())
      .toBe('2026-09-01T03:00:00.000Z');
  });

  it('já é dia 1 em UTC, mas ainda é o último dia em São Paulo', () => {
    expect(inicioDoMesEmSaoPaulo(new Date('2026-10-01T01:30:00Z')).toISOString())
      .toBe('2026-09-01T03:00:00.000Z');
  });

  it('virada do ano', () => {
    expect(inicioDoMesEmSaoPaulo(new Date('2027-01-01T02:59:59Z')).toISOString())
      .toBe('2026-12-01T03:00:00.000Z');
    expect(inicioDoMesEmSaoPaulo(new Date('2027-01-01T03:00:00Z')).toISOString())
      .toBe('2027-01-01T03:00:00.000Z');
  });
});

/**
 * O gateway de cobrança era o único serviço externo que não aparecia na aba
 * Sistema — e era o que tira dinheiro da conta. O que o painel diz sobre ele é
 * regra, e regra se testa sem subir o Nest.
 */
describe('estadoDaCobrancaNoPainel', () => {
  it('sem gateway pedido: off, e diz quem desbloqueia no lugar dele', () => {
    const v = estadoDaCobrancaNoPainel({ nome: 'nenhum', disponivel: false }, undefined);
    expect(v).toMatchObject({ key: 'billing', status: 'off' });
    expect(v.detail).toContain('super admin');
  });

  it('pedido e não montado: down, apontando o log da subida', () => {
    // O motivo exato (chave faltando, URL sem https) já foi para o log do boot;
    // repetir no painel duplicaria a regra da fábrica do provedor.
    const v = estadoDaCobrancaNoPainel({ nome: 'nenhum', disponivel: false }, 'asaas');
    expect(v).toMatchObject({ status: 'down', provider: 'asaas' });
    expect(v.detail).toContain('log de inicialização');
  });

  it('simulado: up, dizendo que nada sai daqui', () => {
    const v = estadoDaCobrancaNoPainel({ nome: 'simulado', disponivel: true }, 'simulado');
    expect(v).toMatchObject({ status: 'up', provider: 'simulado' });
    expect(v.detail).toContain('nenhuma cobrança sai');
  });

  it('sandbox: up, mas avisando que não é dinheiro de verdade', () => {
    // O defeito que motivou isto: a assinatura externa avisava no boot e na
    // tela quando estava em sandbox; a cobrança avisava só no boot, e o `sandbox`
    // que a API já devolvia não era mostrado em lugar nenhum.
    const v = estadoDaCobrancaNoPainel({ nome: 'asaas', disponivel: true, sandbox: true }, 'asaas');
    expect(v.status).toBe('up');
    expect(v.detail).toContain('dinheiro de verdade');
  });

  it('produção: up e sem ressalva nenhuma', () => {
    const v = estadoDaCobrancaNoPainel({ nome: 'asaas', disponivel: true, sandbox: false }, 'asaas');
    expect(v).toEqual({ key: 'billing', label: 'Cobrança', provider: 'asaas', status: 'up', detail: undefined });
  });
});
