import { LimitePorIp, LIMITE_POR_JANELA, JANELA_MS } from './limite-por-ip';
import { chaveDoEnvio } from '../modules/leads/limite-por-ip';

describe('LimitePorIp', () => {
  const t0 = 1_700_000_000_000;

  it('deixa passar até o limite e recusa o seguinte', () => {
    const limite = new LimitePorIp();

    for (let i = 0; i < LIMITE_POR_JANELA; i++) {
      expect(limite.permitir('a', t0 + i)).toBe(true);
    }

    expect(limite.permitir('a', t0 + LIMITE_POR_JANELA)).toBe(false);
  });

  it('libera de novo quando a janela passa', () => {
    const limite = new LimitePorIp();
    for (let i = 0; i < LIMITE_POR_JANELA; i++) limite.permitir('a', t0);
    expect(limite.permitir('a', t0)).toBe(false);

    expect(limite.permitir('a', t0 + JANELA_MS + 1)).toBe(true);
  });

  it('a recusa não consome cota — quem insistiu não fica preso para sempre', () => {
    const limite = new LimitePorIp(2, 1000);
    limite.permitir('a', t0);
    limite.permitir('a', t0 + 10);
    expect(limite.permitir('a', t0 + 20)).toBe(false);

    // Duas tentativas recusadas no meio não empurram a janela para frente.
    limite.permitir('a', t0 + 30);
    limite.permitir('a', t0 + 40);

    // O primeiro envio expira em t0+1000: aí há vaga de novo.
    expect(limite.permitir('a', t0 + 1001)).toBe(true);
  });

  it('cada chave conta separado — um visitante não bloqueia o outro', () => {
    const limite = new LimitePorIp(1, 1000);

    expect(limite.permitir('ip-a|loja|carro', t0)).toBe(true);
    expect(limite.permitir('ip-a|loja|carro', t0)).toBe(false);
    expect(limite.permitir('ip-b|loja|carro', t0)).toBe(true);
    expect(limite.permitir('ip-a|loja|outro-carro', t0)).toBe(true);
  });
});

describe('chaveDoEnvio', () => {
  it('separa por IP, loja e veículo', () => {
    expect(chaveDoEnvio('1.2.3.4', 'loja', 'carro')).toBe('1.2.3.4|loja|carro');
    expect(chaveDoEnvio('1.2.3.4', 'loja', null)).toBe('1.2.3.4|loja|sem-veiculo');
    expect(chaveDoEnvio('1.2.3.4', 'loja', 'carro'))
      .not.toBe(chaveDoEnvio('1.2.3.4', 'outra', 'carro'));
  });
});
