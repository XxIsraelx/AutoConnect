import {
  cfopValido,
  crtDoRegime,
  DEFINICAO_DAS_OPERACOES,
  destinoDaOperacao,
  montarNota,
  normalizarNcm,
  normalizarRenavam,
  operacaoDeSaidaDoNegocio,
  OPERACOES_FISCAIS,
  REGIMES_TRIBUTARIOS,
  situacaoTributariaValida,
  usaCsosn,
  type ContextoDaNota,
} from './nota-fiscal';

const ENDERECO_SP = {
  logradouro: 'Av. Brasil', numero: '1000', bairro: 'Centro',
  cidade: 'São Paulo', uf: 'SP', cep: '01000000',
};
const ENDERECO_MG = { ...ENDERECO_SP, cidade: 'Belo Horizonte', uf: 'MG', cep: '30000000' };

/** Venda presencial, Simples Nacional, tudo preenchido. Cada teste estraga uma coisa. */
function contexto(mudar: Partial<ContextoDaNota> = {}): ContextoDaNota {
  return {
    operacao: 'venda',
    configuracao: { regime: 'simples_nacional', serie: 1, ambiente: 'homologacao', contadorConfirmouEm: null },
    perfil: {
      natureza: 'Venda de veículo usado',
      cfopInterno: '5102',
      cfopInterestadual: '6102',
      situacaoTributaria: '102',
      informacoesComplementares: '  Documento emitido por ME ou EPP optante pelo Simples Nacional.  ',
    },
    emitente: {
      cnpj: '11.222.333/0001-81', inscricaoEstadual: '123456789', razaoSocial: 'Loja Ltda',
      nomeFantasia: 'Loja', endereco: ENDERECO_SP,
    },
    contraparte: { nome: 'Maria Compradora', documento: '529.982.247-25', endereco: ENDERECO_SP, email: null },
    veiculo: {
      marca: 'Fiat', modelo: 'Argo', versao: 'Drive 1.0', anoFabricacao: 2021, anoModelo: 2022,
      cor: 'prata', quilometragem: 35210, chassi: '9bd358a4nmyl12345', placa: 'abc1d23',
      renavam: '12345678901', ncm: '8703.21.00', origem: 0,
    },
    valor: '84900.5',
    presencial: true,
    ...mudar,
  };
}

describe('regime tributário', () => {
  it('Presumido e Real são o mesmo CRT; Simples é 1, excesso de sublimite 2, MEI 4', () => {
    expect(crtDoRegime('simples_nacional')).toBe(1);
    expect(crtDoRegime('simples_excesso_sublimite')).toBe(2);
    expect(crtDoRegime('lucro_presumido')).toBe(3);
    expect(crtDoRegime('lucro_real')).toBe(3);
    expect(crtDoRegime('mei')).toBe(4);
  });

  it('CSOSN no Simples e no MEI; CST em todo o resto, inclusive excesso de sublimite', () => {
    const comCsosn = REGIMES_TRIBUTARIOS.filter(usaCsosn);
    expect(comCsosn).toEqual(['mei', 'simples_nacional']);
    expect(situacaoTributariaValida('simples_nacional', '102')).toBe(true);
    expect(situacaoTributariaValida('simples_nacional', '00')).toBe(false);
    expect(situacaoTributariaValida('lucro_presumido', '20')).toBe(true);
    expect(situacaoTributariaValida('lucro_presumido', '102')).toBe(false);
    expect(situacaoTributariaValida('simples_excesso_sublimite', '102')).toBe(false);
  });
});

describe('operações', () => {
  it('toda sugestão de CFOP bate com a direção da própria operação', () => {
    for (const op of OPERACOES_FISCAIS) {
      const d = DEFINICAO_DAS_OPERACOES[op];
      expect(cfopValido(d.cfopInternoSugerido, d.direcao, 'interna')).toBe(true);
      expect(cfopValido(d.cfopInterestadualSugerido, d.direcao, 'interestadual')).toBe(true);
    }
  });

  it.each([
    ['5102', 'saida', 'interna', true],
    ['6102', 'saida', 'interestadual', true],
    ['1102', 'entrada', 'interna', true],
    ['2102', 'entrada', 'interestadual', true],
    ['5102', 'entrada', 'interna', false],
    ['6102', 'saida', 'interna', false],
    ['7102', 'saida', 'interestadual', false],
    ['510', 'saida', 'interna', false],
    ['5.102', 'saida', 'interna', false],
  ] as const)('CFOP %s numa %s %s → %s', (cfop, direcao, destino, esperado) => {
    expect(cfopValido(cfop, direcao, destino)).toBe(esperado);
  });

  it('o negócio de um consignado sai como venda de consignado; o resto, como venda', () => {
    expect(operacaoDeSaidaDoNegocio('consignment')).toBe('venda_de_consignado');
    expect(operacaoDeSaidaDoNegocio('direct_purchase')).toBe('venda');
    expect(operacaoDeSaidaDoNegocio(null)).toBe('venda');
  });

  it('venda presencial é interna mesmo com comprador de outro estado', () => {
    expect(destinoDaOperacao('SP', 'MG', true)).toBe('interna');
    expect(destinoDaOperacao('SP', 'MG', false)).toBe('interestadual');
    expect(destinoDaOperacao('sp', 'SP', false)).toBe('interna');
  });
});

describe('dados do veículo', () => {
  it('NCM tem oito dígitos, com ou sem pontos', () => {
    expect(normalizarNcm('8703.21.00')).toBe('87032100');
    expect(normalizarNcm('8703210')).toBeNull();
    expect(normalizarNcm(null)).toBeNull();
  });

  it('RENAVAM antigo de nove dígitos ganha zeros à esquerda', () => {
    expect(normalizarRenavam('123456789')).toBe('00123456789');
    expect(normalizarRenavam('1234-5678-901')).toBe('12345678901');
    expect(normalizarRenavam('12345678')).toBeNull();
    expect(normalizarRenavam('123456789012')).toBeNull();
  });

});

describe('montarNota', () => {
  it('monta a venda presencial com o CFOP interno e os dados normalizados', () => {
    const { nota, faltas } = montarNota(contexto({ contraparte: {
      nome: ' Maria Compradora ', documento: '529.982.247-25', endereco: ENDERECO_MG,
    } }));

    expect(faltas).toEqual([]);
    expect(nota).toMatchObject({
      direcao: 'saida',
      cfop: '5102',
      destino: 'interna',
      crt: 1,
      situacaoTributaria: '102',
      valorTotal: '84900.50',
      informacoesComplementares: 'Documento emitido por ME ou EPP optante pelo Simples Nacional.',
      emitente: { cnpj: '11222333000181' },
      contraparte: { nome: 'Maria Compradora', tipoDeDocumento: 'cpf', documento: '52998224725' },
      item: {
        ncm: '87032100', cfop: '5102', quantidade: '1', valorUnitario: '84900.50',
        chassi: '9BD358A4NMYL12345', placa: 'ABC1D23', renavam: '12345678901',
      },
    });
    expect(nota!.item.descricao).toBe(
      'Fiat Argo Drive 1.0 2021/2022, cor prata, chassi 9BD358A4NMYL12345, ' +
        'placa ABC1D23, RENAVAM 12345678901, 35.210 km',
    );
  });

  it('venda com entrega em outro estado usa o CFOP interestadual', () => {
    const { nota } = montarNota(contexto({
      presencial: false,
      contraparte: { nome: 'Maria', documento: '52998224725', endereco: ENDERECO_MG },
    }));
    expect(nota?.cfop).toBe('6102');
    expect(nota?.destino).toBe('interestadual');
  });

  it('compra de pessoa jurídica identifica o documento como CNPJ', () => {
    const { nota } = montarNota(contexto({
      operacao: 'compra_de_particular',
      perfil: { natureza: 'Compra', cfopInterno: '1102', cfopInterestadual: '2102', situacaoTributaria: '900', informacoesComplementares: null },
      contraparte: { nome: 'Locadora SA', documento: '11.444.777/0001-61', endereco: ENDERECO_SP },
    }));
    expect(nota?.direcao).toBe('entrada');
    expect(nota?.contraparte.tipoDeDocumento).toBe('cnpj');
    expect(nota?.informacoesComplementares).toBeNull();
  });

  it('CFOP de saída no perfil de uma entrada vira falta, com o dígito esperado', () => {
    const { nota, faltas } = montarNota(contexto({
      operacao: 'compra_de_particular',
      perfil: { natureza: 'Compra', cfopInterno: '5102', cfopInterestadual: '2102', situacaoTributaria: '900', informacoesComplementares: null },
    }));
    expect(nota).toBeNull();
    expect(faltas).toEqual([expect.objectContaining({
      campo: 'perfil.cfopInterno', onde: 'perfil_fiscal',
      mensagem: expect.stringContaining('deveria começar com 1'),
    })]);
  });

  it('CST num perfil de loja do Simples é falta, e a mensagem diz o que o regime usa', () => {
    const base = contexto();
    const { faltas } = montarNota(contexto({ perfil: { ...base.perfil!, situacaoTributaria: '00' } }));
    expect(faltas).toEqual([expect.objectContaining({
      campo: 'perfil.situacaoTributaria',
      mensagem: expect.stringContaining('não é um CSOSN'),
    })]);
  });

  it('produção exige a confirmação do contador; homologação não', () => {
    const producao = { regime: 'simples_nacional' as const, serie: 1, ambiente: 'producao' as const };
    expect(montarNota(contexto({ configuracao: { ...producao, contadorConfirmouEm: null } })).faltas)
      .toEqual([expect.objectContaining({ campo: 'configuracao.contadorConfirmouEm' })]);
    expect(montarNota(contexto({ configuracao: { ...producao, contadorConfirmouEm: '2026-10-14T12:00:00Z' } })).faltas)
      .toEqual([]);
  });

  it('diz tudo o que falta de uma vez, cada falta com o lugar onde se corrige', () => {
    const { nota, faltas } = montarNota({
      ...contexto(),
      configuracao: null,
      perfil: null,
      emitente: { cnpj: null, inscricaoEstadual: '', razaoSocial: 'Loja', nomeFantasia: 'Loja', endereco: null },
      contraparte: { nome: null, documento: '111.111.111-11', endereco: { ...ENDERECO_SP, numero: null, cep: ' ' } },
      veiculo: { ...contexto().veiculo, chassi: null, ncm: null, renavam: '123' },
      valor: '0',
    });

    expect(nota).toBeNull();
    expect(faltas.map((f) => `${f.onde}:${f.campo}`)).toEqual([
      'perfil_fiscal:configuracao',
      'perfil_fiscal:perfil',
      'loja:emitente.cnpj',
      'loja:emitente.inscricaoEstadual',
      'loja:emitente.endereco',
      'contraparte:contraparte.nome',
      'contraparte:contraparte.documento',
      'contraparte:contraparte.endereco',
      'veiculo:veiculo.chassi',
      'veiculo:veiculo.ncm',
      'veiculo:veiculo.renavam',
      'negocio:valor',
    ]);
    expect(faltas.find((f) => f.campo === 'contraparte.endereco')?.mensagem)
      .toBe('Endereço do comprador incompleto: falta número, CEP.');
  });

  it('valor fora do formato decimal é falta, não exceção', () => {
    expect(montarNota(contexto({ valor: '84.900,50' })).faltas)
      .toEqual([expect.objectContaining({ campo: 'valor' })]);
  });

  it('não exige situação tributária sugerida: a operação nasce sem ela', () => {
    const base = contexto();
    expect(montarNota(contexto({ perfil: { ...base.perfil!, situacaoTributaria: null } })).faltas)
      .toEqual([expect.objectContaining({
        campo: 'perfil.situacaoTributaria',
        mensagem: expect.stringContaining('com o contador'),
      })]);
  });
});
