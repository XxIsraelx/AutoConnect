import {
  TIPOS_CONSULTA, TTL_CONSULTA_HORAS, normalizarPlaca, placaValida,
  chassiValido, chaveIdempotencia, validadeDaConsulta, seloDeProcedencia,
} from './consulta-veicular';

describe('consulta veicular', () => {
  describe('placa', () => {
    it('aceita o formato antigo e o Mercosul', () => {
      expect(placaValida('ABC1234')).toBe(true);
      expect(placaValida('ABC1D23')).toBe(true);
    });

    it('normaliza antes de validar — a loja digita com hífen e minúscula', () => {
      expect(normalizarPlaca('abc-1d23')).toBe('ABC1D23');
      expect(placaValida('abc-1d23')).toBe(true);
    });

    it('recusa o que não é placa', () => {
      for (const ruim of ['ABC12', 'ABCD123', '1234567', '', 'AB1C234']) {
        expect(placaValida(ruim)).toBe(false);
      }
    });
  });

  describe('chassi', () => {
    it('aceita 17 caracteres válidos', () => {
      expect(chassiValido('9BWZZZ377VT004251')).toBe(true);
    });

    it('recusa I, O e Q — a norma os exclui para não confundir com 1 e 0', () => {
      expect(chassiValido('9BWZZZ377VT00425I')).toBe(false);
      expect(chassiValido('9BWZZZ377VT00425O')).toBe(false);
      expect(chassiValido('9BWZZZ377VT00425Q')).toBe(false);
    });

    it('recusa tamanho errado', () => {
      expect(chassiValido('9BWZZZ377VT0042')).toBe(false);
      expect(chassiValido('9BWZZZ377VT0042511')).toBe(false);
    });
  });

  describe('idempotência', () => {
    const hoje = new Date('2026-09-03T10:00:00Z');

    it('mesma placa, tipo e dia dão a mesma chave — não se paga duas vezes', () => {
      const a = chaveIdempotencia('t1', { placa: 'ABC1D23' }, 'debts', hoje);
      const b = chaveIdempotencia('t1', { placa: 'abc-1d23' }, 'debts', new Date('2026-09-03T23:59:00Z'));

      expect(a).toBe(b);
    });

    it('dia seguinte dá chave nova — a loja pode reconsultar', () => {
      const a = chaveIdempotencia('t1', { placa: 'ABC1D23' }, 'debts', hoje);
      const b = chaveIdempotencia('t1', { placa: 'ABC1D23' }, 'debts', new Date('2026-09-04T10:00:00Z'));

      expect(a).not.toBe(b);
    });

    it('tipos diferentes não se atropelam', () => {
      const a = chaveIdempotencia('t1', { placa: 'ABC1D23' }, 'debts', hoje);
      const b = chaveIdempotencia('t1', { placa: 'ABC1D23' }, 'theft', hoje);

      expect(a).not.toBe(b);
    });

    it('concessionárias diferentes não compartilham consulta', () => {
      // Cache entre tenants seria mais barato e vazaria que a concorrente
      // consultou aquela placa.
      const a = chaveIdempotencia('t1', { placa: 'ABC1D23' }, 'debts', hoje);
      const b = chaveIdempotencia('t2', { placa: 'ABC1D23' }, 'debts', hoje);

      expect(a).not.toBe(b);
    });

    it('placa e chassi produzem chaves distintas', () => {
      const a = chaveIdempotencia('t1', { placa: 'ABC1D23' }, 'debts', hoje);
      const b = chaveIdempotencia('t1', { chassi: '9BWZZZ377VT004251' }, 'debts', hoje);

      expect(a).not.toBe(b);
    });
  });

  describe('validade do cache', () => {
    it('todo tipo tem TTL definido', () => {
      for (const t of TIPOS_CONSULTA) {
        expect(TTL_CONSULTA_HORAS[t]).toBeGreaterThan(0);
      }
    });

    it('o que muda semanalmente vale menos que o fato histórico', () => {
      // Débito e multa mudam toda semana; passagem por leilão não muda.
      expect(TTL_CONSULTA_HORAS.debts).toBeLessThan(TTL_CONSULTA_HORAS.auction);
      expect(TTL_CONSULTA_HORAS.fines).toBeLessThan(TTL_CONSULTA_HORAS.auction);
    });

    it('calcula o fim da validade a partir da consulta', () => {
      const desde = new Date('2026-09-03T10:00:00Z');
      const ate = validadeDaConsulta('debts', desde);

      expect(ate.getTime() - desde.getTime()).toBe(24 * 3_600_000);
    });
  });

  describe('selo de procedência', () => {
    it('só entra consulta que aconteceu e não achou nada', () => {
      const selo = seloDeProcedencia([
        { tipo: 'theft', alerta: false, status: 'success' },
        { tipo: 'auction', alerta: false, status: 'success' },
      ]);

      expect(selo.map((s) => s.tipo)).toEqual(['theft', 'auction']);
    });

    it('consulta com alerta não vira selo', () => {
      const selo = seloDeProcedencia([{ tipo: 'debts', alerta: true, status: 'success' }]);

      expect(selo).toEqual([]);
    });

    it('consulta que falhou NÃO vira selo', () => {
      // O erro perigoso: afirmar "sem débitos" a partir de consulta que não
      // aconteceu. Isso é informação falsa na vitrine.
      const selo = seloDeProcedencia([
        { tipo: 'debts', alerta: false, status: 'failed' },
        { tipo: 'theft', alerta: false, status: 'pending' },
      ]);

      expect(selo).toEqual([]);
    });
  });
});
