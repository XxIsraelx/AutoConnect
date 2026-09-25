import {
  aplicarEventoDeCobranca, avaliarCobranca, CATALOGO_DE_PLANOS, DIAS_DE_AVISO_ANTES,
  DIAS_DE_CARENCIA, ehPlanoPago, FAIXAS, faixaParaEstoque, limiteDeVeiculos,
  PLANOS_PAGOS, somarDias, usoDoEstoque,
  type EstadoDaCobranca,
} from './cobranca';

const AGORA = new Date('2026-10-01T12:00:00.000Z');
const dias = (n: number) => somarDias(AGORA, n);

describe('catálogo de planos', () => {
  it('as faixas sobem em preço e em teto, e a última é ilimitada', () => {
    // O catálogo é lido por preço e por limite em três lugares (tela da loja,
    // painel do super admin, regra de publicação). Uma faixa fora de ordem
    // faria `faixaParaEstoque` sugerir o plano errado sem erro nenhum.
    const precos = FAIXAS.map((f) => f.precoMensalCentavos);
    expect(precos).toEqual([...precos].sort((a, b) => Number(a - b)));

    const tetos = FAIXAS.slice(0, -1).map((f) => f.limiteVeiculos);
    expect(tetos.every((t) => t !== null)).toBe(true);
    expect(FAIXAS[FAIXAS.length - 1]!.limiteVeiculos).toBeNull();
  });

  it('cobra os valores decididos, em centavos', () => {
    expect(CATALOGO_DE_PLANOS.essencial.precoMensalCentavos).toBe(27_900n);
    expect(CATALOGO_DE_PLANOS.crescimento.precoMensalCentavos).toBe(47_900n);
    expect(CATALOGO_DE_PLANOS.profissional.precoMensalCentavos).toBe(79_900n);
  });

  it('o catálogo cobre exatamente os planos pagos', () => {
    expect(Object.keys(CATALOGO_DE_PLANOS).sort()).toEqual([...PLANOS_PAGOS].sort());
    expect(ehPlanoPago('trial')).toBe(false);
    expect(ehPlanoPago('essencial')).toBe(true);
  });
});

describe('limite de estoque', () => {
  it('o trial roda com o teto da menor faixa', () => {
    // Trial ilimitado faria a loja subir 60 carros em 14 dias e descobrir o
    // limite depois de pagar.
    expect(limiteDeVeiculos('trial')).toBe(CATALOGO_DE_PLANOS.essencial.limiteVeiculos);
  });

  it('plano desconhecido cai no teto mais baixo, nunca em ilimitado', () => {
    expect(limiteDeVeiculos('starter')).toBe(30);
  });

  it('sugere a menor faixa que comporta o estoque', () => {
    expect(faixaParaEstoque(0)?.plano).toBe('essencial');
    expect(faixaParaEstoque(30)?.plano).toBe('essencial');
    expect(faixaParaEstoque(31)?.plano).toBe('crescimento');
    expect(faixaParaEstoque(80)?.plano).toBe('crescimento');
    expect(faixaParaEstoque(81)?.plano).toBe('profissional');
    expect(faixaParaEstoque(10_000)?.plano).toBe('profissional');
  });

  it('no limite avisa; passar do limite é o que bloqueia', () => {
    expect(usoDoEstoque('essencial', 29)).toMatchObject({ noLimite: false, excedido: false });
    expect(usoDoEstoque('essencial', 30)).toMatchObject({ noLimite: true, excedido: false });
    expect(usoDoEstoque('essencial', 31)).toMatchObject({ noLimite: true, excedido: true });
  });

  it('faixa ilimitada nunca excede', () => {
    expect(usoDoEstoque('profissional', 99_999)).toMatchObject({
      limite: null, noLimite: false, excedido: false,
    });
  });
});

describe('avaliarCobranca', () => {
  it('loja sem assinatura nenhuma não é bloqueada', () => {
    // Dado anterior ao autosserviço: inventar um bloqueio para quem nunca teve
    // trial trancaria um cliente por causa de uma migração.
    expect(avaliarCobranca(null, AGORA).somenteLeitura).toBe(false);
  });

  it('trial em dia não avisa nada', () => {
    const v = avaliarCobranca({ plan: 'trial', status: 'active', trialEndsAt: dias(10) }, AGORA);
    expect(v).toMatchObject({ situacao: 'trial', somenteLeitura: false, aviso: null });
    expect(v.diasRestantes).toBe(10);
  });

  it(`avisa a partir de ${DIAS_DE_AVISO_ANTES} dias do fim do trial`, () => {
    const v = avaliarCobranca(
      { plan: 'trial', status: 'active', trialEndsAt: dias(DIAS_DE_AVISO_ANTES) }, AGORA,
    );
    expect(v.situacao).toBe('trial_terminando');
    expect(v.somenteLeitura).toBe(false);
    expect(v.aviso).toContain('termina em 3 dias');
  });

  it('trial vencido sem plano pago é somente leitura na hora', () => {
    // A carência de 7 dias é do **boleto vencido**, não do teste grátis: o
    // teste já são 14 dias de graça.
    const v = avaliarCobranca({ plan: 'trial', status: 'active', trialEndsAt: dias(-1) }, AGORA);
    expect(v.situacao).toBe('somente_leitura');
    expect(v.somenteLeitura).toBe(true);
    expect(v.aviso).toContain('Nada foi apagado');
  });

  it('plano pago em dia não bloqueia nem avisa', () => {
    const v = avaliarCobranca(
      { plan: 'crescimento', status: 'active', currentPeriodEnd: dias(20) }, AGORA,
    );
    expect(v).toMatchObject({ situacao: 'ativa', somenteLeitura: false, aviso: null });
  });

  it('super admin trocando o plano à mão destrava, mesmo com trial vencido', () => {
    // É o caminho de desbloqueio manual, e ele precisa continuar funcionando
    // depois do bloqueio — inclusive numa instalação sem gateway nenhum.
    const v = avaliarCobranca(
      { plan: 'essencial', status: 'active', trialEndsAt: dias(-90) }, AGORA,
    );
    expect(v.somenteLeitura).toBe(false);
  });

  it('fatura vencida dá carência, e só depois dela bloqueia', () => {
    const dentro = avaliarCobranca(
      { plan: 'essencial', status: 'past_due', graceUntil: dias(3) }, AGORA,
    );
    expect(dentro.situacao).toBe('em_carencia');
    expect(dentro.somenteLeitura).toBe(false);
    expect(dentro.diasRestantes).toBe(3);
    expect(dentro.aviso).toContain('3 dias');

    const fora = avaliarCobranca(
      { plan: 'essencial', status: 'past_due', graceUntil: dias(-1) }, AGORA,
    );
    expect(fora.situacao).toBe('somente_leitura');
    expect(fora.somenteLeitura).toBe(true);
  });

  it('cancelada é somente leitura na hora, sem carência', () => {
    const v = avaliarCobranca({ plan: 'essencial', status: 'canceled' }, AGORA);
    expect(v.somenteLeitura).toBe(true);
    expect(v.aviso).toContain('cancelada');
  });

  it('aceita data como string ISO — é o que vem da API', () => {
    const v = avaliarCobranca(
      { plan: 'trial', status: 'active', trialEndsAt: dias(5).toISOString() }, AGORA,
    );
    expect(v.diasRestantes).toBe(5);
  });

  it('data inválida não vira "não vencido"', () => {
    // `new Date("lixo")` é NaN, e um NaN comparado com qualquer coisa é falso —
    // sem o tratamento, a loja ficaria em trial para sempre.
    const v = avaliarCobranca({ plan: 'trial', status: 'active', trialEndsAt: 'lixo' }, AGORA);
    expect(v.somenteLeitura).toBe(true);
  });
});

describe('aplicarEventoDeCobranca', () => {
  const vencida: EstadoDaCobranca = {
    status: 'past_due', currentPeriodEnd: dias(-10), graceUntil: dias(-3),
  };

  it('pagamento confirmado volta para ativa e limpa a carência', () => {
    const { estado, mudou } = aplicarEventoDeCobranca(vencida, {
      tipo: 'pagamento_confirmado', ocorridoEm: AGORA,
    });
    expect(mudou).toBe(true);
    expect(estado.status).toBe('active');
    expect(estado.graceUntil).toBeNull();
    expect(estado.currentPeriodEnd!.getTime()).toBe(dias(30).getTime());
  });

  it('o mesmo pagamento aplicado duas vezes dá o mesmo estado', () => {
    const uma = aplicarEventoDeCobranca(vencida, { tipo: 'pagamento_confirmado', ocorridoEm: AGORA });
    const duas = aplicarEventoDeCobranca(uma.estado, { tipo: 'pagamento_confirmado', ocorridoEm: AGORA });
    expect(duas.mudou).toBe(false);
    expect(duas.estado).toEqual(uma.estado);
  });

  it('o vencimento abre a carência uma vez só', () => {
    const emDia: EstadoDaCobranca = { status: 'active', currentPeriodEnd: dias(-1), graceUntil: null };

    const primeiro = aplicarEventoDeCobranca(emDia, { tipo: 'pagamento_vencido', ocorridoEm: AGORA });
    expect(primeiro.mudou).toBe(true);
    expect(primeiro.estado.status).toBe('past_due');
    expect(primeiro.estado.graceUntil!.getTime()).toBe(dias(DIAS_DE_CARENCIA).getTime());

    // Segundo vencido não estende: senão quem nunca paga ganharia sete dias
    // por mês, para sempre.
    const segundo = aplicarEventoDeCobranca(primeiro.estado, {
      tipo: 'pagamento_vencido', ocorridoEm: dias(5),
    });
    expect(segundo.mudou).toBe(false);
    expect(segundo.estado.graceUntil!.getTime()).toBe(dias(DIAS_DE_CARENCIA).getTime());
  });

  it('a carência conta do vencimento da fatura, não de quando o webhook chegou', () => {
    const emDia: EstadoDaCobranca = { status: 'active', currentPeriodEnd: null, graceUntil: null };
    const { estado } = aplicarEventoDeCobranca(emDia, {
      tipo: 'pagamento_vencido',
      ocorridoEm: dias(2), // entrega atrasada
      fatura: {
        idExterno: 'pay_1', status: 'vencida', valorCentavos: 27_900n,
        vencimento: AGORA, pagoEm: null, meio: 'boleto', urlPagamento: null,
      },
    });
    expect(estado.graceUntil!.getTime()).toBe(dias(DIAS_DE_CARENCIA).getTime());
  });

  it('reembolso e cancelamento levam a cancelada, e repetir é no-op', () => {
    const ativa: EstadoDaCobranca = { status: 'active', currentPeriodEnd: dias(20), graceUntil: null };
    for (const tipo of ['reembolso', 'assinatura_cancelada'] as const) {
      const { estado, mudou } = aplicarEventoDeCobranca(ativa, { tipo, ocorridoEm: AGORA });
      expect(mudou).toBe(true);
      expect(estado.status).toBe('canceled');
      expect(aplicarEventoDeCobranca(estado, { tipo, ocorridoEm: AGORA }).mudou).toBe(false);
    }
  });

  it('evento ignorado não toca em nada', () => {
    const r = aplicarEventoDeCobranca(vencida, { tipo: 'ignorado', ocorridoEm: AGORA });
    expect(r.mudou).toBe(false);
    expect(r.estado).toBe(vencida);
  });

  it('pagamento depois do cancelamento reativa — quem pagou tem de voltar', () => {
    // O cliente cancelou, se arrependeu e pagou o boleto que já estava
    // emitido. Recusar a volta aqui seria cobrar sem entregar.
    const cancelada: EstadoDaCobranca = { status: 'canceled', currentPeriodEnd: null, graceUntil: null };
    const { estado, mudou } = aplicarEventoDeCobranca(cancelada, {
      tipo: 'pagamento_confirmado', ocorridoEm: AGORA,
    });
    expect(mudou).toBe(true);
    expect(estado.status).toBe('active');
  });
});
