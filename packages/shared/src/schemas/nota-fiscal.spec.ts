import { AmbienteFiscal, OperacaoFiscal, RegimeTributario } from '@autoconnect/db';
import { AMBIENTES_FISCAIS, OPERACOES_FISCAIS, REGIMES_TRIBUTARIOS } from '../domain/nota-fiscal';
import { dadosFiscaisDoVeiculoSchema, perfilDeOperacaoSchema, perfilFiscalSchema } from './nota-fiscal';

/**
 * Paridade dos enums fiscais com o Prisma — mesma razão de
 * `paridade-enums.spec.ts`, em arquivo próprio para a trilha fiscal não
 * escrever no arquivo que as outras sessões também editam.
 */
const conjunto = (v: readonly string[]) => new Set(v);

describe('paridade dos enums fiscais', () => {
  it('RegimeTributario', () => {
    expect(conjunto(REGIMES_TRIBUTARIOS)).toEqual(conjunto(Object.values(RegimeTributario)));
  });
  it('AmbienteFiscal', () => {
    expect(conjunto(AMBIENTES_FISCAIS)).toEqual(conjunto(Object.values(AmbienteFiscal)));
  });
  it('OperacaoFiscal', () => {
    expect(conjunto(OPERACOES_FISCAIS)).toEqual(conjunto(Object.values(OperacaoFiscal)));
  });
});

describe('corpos do perfil fiscal', () => {
  it('série reservada (890 a 999) é recusada', () => {
    expect(perfilFiscalSchema.safeParse({ regime: 'lucro_real', serie: 1, ambiente: 'homologacao' }).success).toBe(true);
    expect(perfilFiscalSchema.safeParse({ regime: 'lucro_real', serie: 890, ambiente: 'homologacao' }).success).toBe(false);
  });

  it('campo a mais é recusado — o perfil muda imposto', () => {
    const r = perfilDeOperacaoSchema.safeParse({
      natureza: 'Venda', cfopInterno: '5102', cfopInterestadual: '6102',
      situacaoTributaria: null, pisCofinsSituacaoTributaria: null, informacoesComplementares: null, aliquota: '18',
    });
    expect(r.success).toBe(false);
  });

  it('dados do veículo saem normalizados, e vazio vira nulo', () => {
    expect(dadosFiscaisDoVeiculoSchema.parse({ ncm: '8703.21.00', renavam: '123456789', origem: 0 }))
      .toEqual({ ncm: '87032100', renavam: '00123456789', origem: 0 });
    expect(dadosFiscaisDoVeiculoSchema.parse({ ncm: ' ', renavam: null, origem: 1 }))
      .toEqual({ ncm: null, renavam: null, origem: 1 });
    const r = dadosFiscaisDoVeiculoSchema.safeParse({ ncm: '870321', renavam: null, origem: 0 });
    expect(r.success).toBe(false);
  });
});
