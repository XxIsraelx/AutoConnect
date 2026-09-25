import {
  createBranchSchema,
  expedienteSchema,
  updateBranchSchema,
  updateTenantSchema,
} from './tenant';
import { calcularPrazoDeResposta, expedienteOuPadrao, EXPEDIENTE_PADRAO } from '../domain/sla';

/**
 * Os três campos que o piloto do primeiro dia viu sumirem.
 *
 * Cada `it` abaixo falha no schema anterior: `businessHours`, `primaryPhone` e
 * `acceptsTradeIn` não existiam, e o Zod os descartava sem dizer nada. O teste
 * que importa não é "o schema aceita o campo" — é "o valor **sai** do parse",
 * porque o defeito era justamente a saída limpa.
 */
describe('schemas da concessionária', () => {
  const expedienteCompleto = {
    '0': { closed: true, open: '09:00', close: '18:00' },
    '1': { closed: false, open: '08:00', close: '19:00' },
    '2': { closed: false, open: '08:00', close: '19:00' },
    '3': { closed: false, open: '08:00', close: '19:00' },
    '4': { closed: false, open: '08:00', close: '19:00' },
    '5': { closed: false, open: '08:00', close: '19:00' },
    '6': { closed: false, open: '09:00', close: '17:00' },
  };

  describe('updateTenantSchema', () => {
    it('devolve `primaryPhone` e `acceptsTradeIn` — antes eram descartados', () => {
      const saida = updateTenantSchema.parse({
        primaryPhone: '(31) 3271-8080',
        acceptsTradeIn: true,
      });

      expect(saida).toEqual({ primaryPhone: '(31) 3271-8080', acceptsTradeIn: true });
    });

    it('recusa telefone que não é telefone brasileiro', () => {
      expect(() => updateTenantSchema.parse({ primaryPhone: '123' })).toThrow();
    });

    it('é estrito: campo desconhecido vira erro, não silêncio', () => {
      const r = updateTenantSchema.safeParse({ tradeName: 'Garagem', isActive: false });

      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0].code).toBe('unrecognized_keys');
      }
    });
  });

  describe('expediente', () => {
    it('aceita a semana inteira, com dia fechado', () => {
      expect(expedienteSchema.parse(expedienteCompleto)).toEqual(expedienteCompleto);
    });

    it('recusa fechamento antes da abertura — o dia sumiria do cálculo do SLA', () => {
      expect(
        expedienteSchema.safeParse({ '1': { closed: false, open: '19:00', close: '08:00' } })
          .success,
      ).toBe(false);
    });

    it('recusa hora fora do formato e dia fora de 0–6', () => {
      expect(
        expedienteSchema.safeParse({ '1': { closed: false, open: '8h', close: '19:00' } }).success,
      ).toBe(false);
      expect(
        expedienteSchema.safeParse({ '9': { closed: false, open: '08:00', close: '19:00' } })
          .success,
      ).toBe(false);
    });

    it('o que sai do schema é o que o relógio do SLA aceita', () => {
      // O elo que faltava: sem `businessHours` no schema, o expediente salvo
      // nunca chegava ao banco e `expedienteOuPadrao` caía no padrão do shared.
      const salvo = expedienteSchema.parse(expedienteCompleto);
      expect(expedienteOuPadrao(salvo)).toEqual(salvo);
      expect(expedienteOuPadrao(salvo)).not.toEqual(EXPEDIENTE_PADRAO);

      // Segunda-feira 07:00 (loja fechada até as 08:00), 15 minutos de prazo.
      const prazo = calcularPrazoDeResposta(
        new Date('2026-09-28T10:00:00.000Z'), // 07:00 em São Paulo
        15,
        salvo,
      );
      expect(prazo?.toISOString()).toBe('2026-09-28T11:15:00.000Z');
    });
  });

  describe('updateBranchSchema', () => {
    it('devolve `businessHours` — o campo que a tela mandava e o Zod comia', () => {
      const saida = updateBranchSchema.parse({
        city: 'Belo Horizonte',
        businessHours: expedienteCompleto,
      });

      expect(saida.businessHours).toEqual(expedienteCompleto);
    });

    it('herda o `.strict()` da criação — `omit` e `partial` não o perdem', () => {
      expect(createBranchSchema.safeParse({ name: 'Matriz', inventado: 1 }).success).toBe(false);
      expect(updateBranchSchema.safeParse({ isActive: false }).success).toBe(false);
      expect(updateBranchSchema.safeParse({ isHeadquarters: true }).success).toBe(false);
    });

    it('continua aceitando o corpo completo que `/configuracoes` envia', () => {
      const corpo = {
        name: 'Matriz',
        phone: '(31) 3271-8080',
        email: 'contato@garagem.test',
        addressLine: 'Rua dos Aimorés',
        addressNumber: '1200',
        complement: 'Sala 2',
        neighborhood: 'Funcionários',
        city: 'Belo Horizonte',
        state: 'MG',
        postalCode: '30140-071',
        businessHours: expedienteCompleto,
      };

      expect(updateBranchSchema.safeParse(corpo).success).toBe(true);
    });
  });
});
