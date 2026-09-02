import {
  DEAL_STATUSES,
  DEAL_TRANSITIONS,
  DEAL_TERMINAL_STATUSES,
  canTransition,
  isDealTerminal,
  isDealEditable,
  type DealStatusValue,
} from './deal';

describe('máquina de estados do negócio', () => {
  it('todo status tem entrada na tabela de transições', () => {
    // Um status novo no enum sem entrada aqui daria `undefined.includes` em
    // produção, no clique do vendedor. Melhor quebrar no CI.
    for (const s of DEAL_STATUSES) {
      expect(DEAL_TRANSITIONS[s]).toBeDefined();
    }
  });

  it('nenhuma transição aponta para um status inexistente', () => {
    const validos = new Set<string>(DEAL_STATUSES);
    for (const [de, paras] of Object.entries(DEAL_TRANSITIONS)) {
      for (const para of paras) {
        expect({ de, para, existe: validos.has(para) }).toEqual({ de, para, existe: true });
      }
    }
  });

  it('o caminho feliz percorre draft até delivered', () => {
    const caminho: DealStatusValue[] = [
      'draft', 'proposal', 'negotiating', 'awaiting_credit',
      'contract_issued', 'signed', 'invoiced', 'documentation', 'delivered',
    ];
    for (let i = 0; i < caminho.length - 1; i++) {
      expect(canTransition(caminho[i], caminho[i + 1])).toBe(true);
    }
  });

  it('não se pula etapa: draft não vai direto para signed nem para delivered', () => {
    expect(canTransition('draft', 'signed')).toBe(false);
    expect(canTransition('draft', 'delivered')).toBe(false);
    expect(canTransition('proposal', 'invoiced')).toBe(false);
  });

  it('não se anda para trás depois de assinado', () => {
    expect(canTransition('signed', 'negotiating')).toBe(false);
    expect(canTransition('delivered', 'invoiced')).toBe(false);
    expect(canTransition('invoiced', 'signed')).toBe(false);
  });

  it('antes da assinatura cancela-se; depois dela, distrata-se', () => {
    // A assimetria é o ponto: são eventos jurídicos diferentes.
    for (const antes of ['draft', 'proposal', 'negotiating', 'awaiting_credit', 'contract_issued'] as const) {
      expect(canTransition(antes, 'canceled')).toBe(true);
      expect(canTransition(antes, 'rescinded')).toBe(false);
    }
    for (const depois of ['signed', 'invoiced', 'documentation', 'delivered'] as const) {
      expect(canTransition(depois, 'rescinded')).toBe(true);
      expect(canTransition(depois, 'canceled')).toBe(false);
    }
  });

  it('estados terminais não têm saída', () => {
    for (const s of DEAL_TERMINAL_STATUSES) {
      expect(DEAL_TRANSITIONS[s]).toEqual([]);
      expect(isDealTerminal(s)).toBe(true);
      for (const destino of DEAL_STATUSES) {
        expect(canTransition(s, destino)).toBe(false);
      }
    }
  });

  it('os terminais são exatamente os que não têm saída', () => {
    // Sustenta o índice único parcial `deals_veiculo_negocio_vivo_idx`, que usa
    // esta mesma dupla para liberar o veículo. Se divergirem, um carro fica
    // preso a um negócio morto.
    const semSaida = DEAL_STATUSES.filter((s) => DEAL_TRANSITIONS[s].length === 0);
    expect(new Set(semSaida)).toEqual(new Set(DEAL_TERMINAL_STATUSES));
  });

  it('valor só é editável antes da assinatura', () => {
    expect(isDealEditable('draft')).toBe(true);
    expect(isDealEditable('negotiating')).toBe(true);
    expect(isDealEditable('contract_issued')).toBe(true);
    expect(isDealEditable('signed')).toBe(false);
    expect(isDealEditable('delivered')).toBe(false);
  });
});
