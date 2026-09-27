import { leadPublicoSchema } from '../schemas/lead';
import {
  TEXTO_DE_CONSENTIMENTO_RAIO_X,
  mensagemDoRaioX,
  origemDoRaioX,
} from './raio-x';

describe('Raio-X', () => {
  describe('origemDoRaioX', () => {
    it('aceita rótulo de campanha e normaliza a caixa', () => {
      expect(origemDoRaioX('Instagram')).toBe('instagram');
      expect(origemDoRaioX('bio_ig-2026')).toBe('bio_ig-2026');
    });

    it('vazio ou ausente é "direto"', () => {
      expect(origemDoRaioX(undefined)).toBe('direto');
      expect(origemDoRaioX('')).toBe('direto');
    });

    it('lixo vindo da URL vira "direto" em vez de ir parar no lead', () => {
      expect(origemDoRaioX('<script>')).toBe('direto');
      expect(origemDoRaioX('a b')).toBe('direto');
      expect(origemDoRaioX('x'.repeat(41))).toBe('direto');
    });
  });

  describe('mensagemDoRaioX', () => {
    it('leva loja, cargo e origem, que é o que o vendedor precisa ler', () => {
      expect(mensagemDoRaioX({ loja: 'Valinhos Veículos', cargo: 'gerente', origem: 'instagram', secao: 'hero' }))
        .toBe('Raio-X do atendimento · Loja: Valinhos Veículos · Cargo: Gerente · Origem: instagram · Seção: hero');
    });

    it('sem seção, não inventa uma', () => {
      expect(mensagemDoRaioX({ loja: 'X Motors', cargo: 'dono' }))
        .toBe('Raio-X do atendimento · Loja: X Motors · Cargo: Dono · Origem: direto');
    });

    it('limpa espaços e corta nome de loja longo demais', () => {
      const m = mensagemDoRaioX({ loja: `  A   ${'b'.repeat(200)}`, cargo: 'outro' });
      expect(m).toContain('Loja: A b');
      expect(m.length).toBeLessThan(250);
    });
  });

  it('o corpo que a landing manda passa pelo schema da rota pública', () => {
    const r = leadPublicoSchema.safeParse({
      tenantId: '6f1c7a52-1f7e-4a41-9a0d-2f6c1b8e4c11',
      contactName: 'Joana Dona',
      contactPhone: '(19) 99876-5432',
      message: mensagemDoRaioX({ loja: 'Loja', cargo: 'dono' }),
      consentimento: true,
      consentText: TEXTO_DE_CONSENTIMENTO_RAIO_X,
      website: '',
    });
    expect(r.success).toBe(true);
  });
});
