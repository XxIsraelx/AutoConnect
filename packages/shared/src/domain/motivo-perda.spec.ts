import {
  CODIGOS_DE_CANCELAMENTO_DE_NEGOCIO,
  CODIGOS_DE_PERDA_DE_LEAD,
  MOTIVOS_DE_CANCELAMENTO_DE_NEGOCIO,
  MOTIVOS_DE_PERDA_DE_LEAD,
  exigeDetalhe,
  rotuloDoMotivo,
} from './motivo-perda';
import { updateLeadSchema } from '../schemas/lead';
import { transitionDealSchema } from '../schemas/deal';

describe('lista de motivos', () => {
  it.each([
    ['lead', MOTIVOS_DE_PERDA_DE_LEAD],
    ['negócio', MOTIVOS_DE_CANCELAMENTO_DE_NEGOCIO],
  ])('a lista de %s não tem código repetido', (_qual, lista) => {
    const codigos = lista.map((m) => m.codigo);

    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it.each([
    ['lead', MOTIVOS_DE_PERDA_DE_LEAD],
    ['negócio', MOTIVOS_DE_CANCELAMENTO_DE_NEGOCIO],
  ])('a lista de %s termina em "outro" — é a saída, não o primeiro item', (_qual, lista) => {
    expect(lista[lista.length - 1].codigo).toBe('outro');
  });

  it('as listas de código acompanham as listas de rótulo', () => {
    expect(CODIGOS_DE_PERDA_DE_LEAD).toEqual(MOTIVOS_DE_PERDA_DE_LEAD.map((m) => m.codigo));
    expect(CODIGOS_DE_CANCELAMENTO_DE_NEGOCIO).toEqual(
      MOTIVOS_DE_CANCELAMENTO_DE_NEGOCIO.map((m) => m.codigo),
    );
  });
});

describe('rótulo', () => {
  it('traduz o código da lista', () => {
    expect(rotuloDoMotivo('preco')).toBe('Preço');
  });

  it('código desconhecido vira "Outro", não "undefined"', () => {
    // O banco aceita qualquer texto não vazio: um UPDATE feito por SQL não
    // pode produzir uma linha sem rótulo no relatório.
    expect(rotuloDoMotivo('gravado_por_sql')).toBe('Outro');
  });

  it('sem motivo é dito com todas as letras', () => {
    expect(rotuloDoMotivo(null)).toBe('Sem motivo informado');
  });

  it('usa a lista do negócio quando pedida', () => {
    expect(rotuloDoMotivo('credito_reprovado', MOTIVOS_DE_CANCELAMENTO_DE_NEGOCIO))
      .toBe('Crédito reprovado');
  });

  it('só "outro" exige detalhe', () => {
    expect(exigeDetalhe('outro')).toBe(true);
    expect(exigeDetalhe('preco')).toBe(false);
  });
});

describe('motivo obrigatório ao perder o lead', () => {
  it('recusa "lost" sem código, apontando o campo', () => {
    const r = updateLeadSchema.safeParse({ status: 'lost' });

    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['lostReasonCode']);
  });

  it('recusa código fora da lista', () => {
    const r = updateLeadSchema.safeParse({ status: 'lost', lostReasonCode: 'nao_gostei' });

    expect(r.success).toBe(false);
  });

  it('recusa "outro" sem o texto livre', () => {
    // Sem isto "outro" vira o depósito de tudo e a lista não informa nada.
    const r = updateLeadSchema.safeParse({
      status: 'lost', lostReasonCode: 'outro', lostReason: '   ',
    });

    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['lostReason']);
  });

  it('aceita "outro" com o texto', () => {
    const r = updateLeadSchema.safeParse({
      status: 'lost', lostReasonCode: 'outro', lostReason: 'Mudou de cidade',
    });

    expect(r.success).toBe(true);
  });

  it('não cobra motivo nos demais status', () => {
    expect(updateLeadSchema.safeParse({ status: 'contacted' }).success).toBe(true);
  });
});

describe('motivo obrigatório ao cancelar o negócio', () => {
  it.each(['canceled', 'rescinded'])('%s sem código é recusado', (to) => {
    const r = transitionDealSchema.safeParse({ to });

    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['cancelReasonCode']);
  });

  it('"outro" sem texto é recusado', () => {
    const r = transitionDealSchema.safeParse({ to: 'canceled', cancelReasonCode: 'outro' });

    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['reason']);
  });

  it('as demais transições seguem sem motivo', () => {
    expect(transitionDealSchema.safeParse({ to: 'proposal' }).success).toBe(true);
  });
});
