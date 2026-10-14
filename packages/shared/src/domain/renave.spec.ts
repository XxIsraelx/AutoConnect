import {
  operacaoRenaveDaAquisicao, pendenciasRenave, podeTransitarRenave, situacaoNoRenave,
  statusDepoisDoEvento, tipoDoDocumento,
  type EntradaDasPendencias, type RegistroParaRenave,
} from './renave';
import { digitoVerificadorDaChave } from './chave-nfe';
import { registrarRenaveSchema, chaveNfeRenaveSchema, enviarRenaveSchema } from '../schemas/renave';

/** NF-e de SP, outubro de 2026, emitida por 11.222.333/0001-81. */
const CHAVE_DA_LOJA = '35261011222333000181550010000012341123456787';
const CNPJ_DA_LOJA = '11222333000181';

const comDigito = (primeiras43: string) => primeiras43 + digitoVerificadorDaChave(primeiras43);

let seq = 0;
const registro = (p: Partial<RegistroParaRenave>): RegistroParaRenave => ({
  id: `r${++seq}`,
  tipo: 'entrada_compra',
  status: 'confirmado',
  dealId: null,
  chaveNfe: CHAVE_DA_LOJA,
  dataOperacao: '2026-10-01',
  createdAt: '2026-10-01T12:00:00Z',
  ...p,
});

const base = (p: Partial<EntradaDasPendencias> = {}): EntradaDasPendencias => ({
  veiculo: { status: 'available', condition: 'used' },
  aquisicao: { origin: 'direct_purchase', enteredAt: '2026-10-01' },
  negocios: [],
  registros: [],
  cnpjDaLoja: CNPJ_DA_LOJA,
  ...p,
});

const codigos = (e: EntradaDasPendencias) => pendenciasRenave(e).map((p) => p.codigo);

describe('operacaoRenaveDaAquisicao', () => {
  it.each([
    ['direct_purchase', 'entrada_compra'],
    // Troca e leilão são compra: quem vende é quem consta no CRV.
    ['trade_in', 'entrada_compra'],
    ['auction', 'entrada_compra'],
    ['dealer_transfer', 'entrada_transferencia'],
    ['consignment', 'entrada_consignacao'],
    // Zero km entra pela montadora, fora do registro manual.
    ['factory', null],
  ] as const)('%s → %s', (origem, operacao) => {
    expect(operacaoRenaveDaAquisicao(origem)).toBe(operacao);
  });
});

describe('máquina de estados', () => {
  it('confirmado só sai para cancelado', () => {
    expect(podeTransitarRenave('confirmado', 'cancelado')).toBe(true);
    expect(podeTransitarRenave('confirmado', 'pendente')).toBe(false);
    expect(podeTransitarRenave('confirmado', 'recusado')).toBe(false);
  });

  it('recusado e cancelado são finais', () => {
    for (const para of ['pendente', 'confirmado', 'recusado', 'cancelado'] as const) {
      expect(podeTransitarRenave('recusado', para)).toBe(false);
      expect(podeTransitarRenave('cancelado', para)).toBe(false);
    }
  });
});

describe('situacaoNoRenave', () => {
  it('sem registro vivo, sem registro', () => {
    expect(situacaoNoRenave([])).toBe('sem_registro');
    expect(situacaoNoRenave([registro({ status: 'cancelado' })])).toBe('sem_registro');
  });

  it('é o último movimento que manda: entrou, saiu, voltou', () => {
    const entrou = registro({ dataOperacao: '2026-01-10' });
    const saiu = registro({ tipo: 'saida_venda', dealId: 'd1', dataOperacao: '2026-03-10' });
    expect(situacaoNoRenave([entrou, saiu])).toBe('fora_do_estoque');

    const voltou = registro({ dataOperacao: '2026-05-10' });
    // A ordem do array não importa: a cronologia é a da data do fato.
    expect(situacaoNoRenave([voltou, saiu, entrou])).toBe('em_estoque');
  });

  it('saída cancelada devolve o carro ao estoque, como no RENAVE', () => {
    const entrou = registro({ dataOperacao: '2026-01-10' });
    const saiu = registro({ tipo: 'saida_venda', dealId: 'd1', status: 'cancelado', dataOperacao: '2026-03-10' });
    expect(situacaoNoRenave([entrou, saiu])).toBe('em_estoque');
  });
});

describe('pendenciasRenave — entrada', () => {
  it('carro no estoque sem entrada é obrigação, com a data da aquisição', () => {
    const [p] = pendenciasRenave(base());
    expect(p).toMatchObject({ codigo: 'entrada_sem_registro', gravidade: 'obrigatoria' });
    expect(p!.desde).toBe(new Date('2026-10-01').toISOString());
  });

  it('entrada confirmada com NF-e: nada pendente', () => {
    expect(codigos(base({ registros: [registro({})] }))).toEqual([]);
  });

  it('entrada pendente é aviso, não obrigação — a loja já fez a parte dela', () => {
    const ps = pendenciasRenave(base({ registros: [registro({ status: 'pendente', chaveNfe: null })] }));
    expect(ps.map((p) => [p.codigo, p.gravidade])).toEqual([['entrada_aguardando_protocolo', 'aviso']]);
  });

  it('entrada recusada não conta: o carro continua sem entrada', () => {
    expect(codigos(base({ registros: [registro({ status: 'recusado' })] }))).toEqual(['entrada_sem_registro']);
  });

  it('sem NF-e de entrada é obrigação na compra (o manual trava a saída sem ela)…', () => {
    const [p] = pendenciasRenave(base({ registros: [registro({ chaveNfe: null })] }));
    expect(p).toMatchObject({ codigo: 'entrada_sem_nfe', gravidade: 'obrigatoria' });
  });

  it('…e aviso no consignado, cuja regra ainda não foi publicada', () => {
    const ps = pendenciasRenave(base({
      aquisicao: { origin: 'consignment', enteredAt: '2026-10-01' },
      registros: [registro({ tipo: 'entrada_consignacao', chaveNfe: null })],
    }));
    expect(ps.map((p) => [p.codigo, p.gravidade])).toEqual([
      ['entrada_sem_nfe', 'aviso'],
      ['consignado_sem_contrato', 'aviso'],
    ]);
  });

  it('zero km e arquivado sem venda ficam de fora', () => {
    expect(codigos(base({ veiculo: { status: 'available', condition: 'new' } }))).toEqual([]);
    expect(codigos(base({ aquisicao: { origin: 'factory', enteredAt: '2026-10-01' } }))).toEqual([]);
    expect(codigos(base({ veiculo: { status: 'archived', condition: 'used' } }))).toEqual([]);
  });

  it('sem aquisição registrada, a pendência existe do mesmo jeito — só sem data', () => {
    const [p] = pendenciasRenave(base({ aquisicao: null }));
    expect(p).toMatchObject({ codigo: 'entrada_sem_registro' });
    expect(p!.desde).toBeUndefined();
  });
});

describe('pendenciasRenave — saída', () => {
  const entrada = registro({ dataOperacao: '2026-09-01' });

  it('negócio faturado sem saída é obrigação, apontando o negócio', () => {
    const ps = pendenciasRenave(base({
      veiculo: { status: 'sold', condition: 'used' },
      negocios: [{ id: 'd1', status: 'invoiced', closedAt: '2026-10-10' }],
      registros: [entrada],
    }));
    expect(ps).toEqual([expect.objectContaining({
      codigo: 'saida_sem_registro', gravidade: 'obrigatoria', dealId: 'd1',
    })]);
  });

  it('negócio ainda não faturado não cobra saída', () => {
    expect(codigos(base({
      negocios: [{ id: 'd1', status: 'signed' }],
      registros: [entrada],
    }))).toEqual([]);
  });

  it('saída confirmada sem NF-e de saída é obrigação', () => {
    const ps = pendenciasRenave(base({
      veiculo: { status: 'sold', condition: 'used' },
      negocios: [{ id: 'd1', status: 'delivered' }],
      registros: [entrada, registro({ tipo: 'saida_venda', dealId: 'd1', chaveNfe: null, dataOperacao: '2026-10-10' })],
    }));
    expect(ps.map((p) => [p.codigo, p.gravidade])).toEqual([['saida_sem_nfe', 'obrigatoria']]);
  });

  it('NF-e de saída de outro CNPJ é aviso — a raiz da matriz vale', () => {
    const deOutro = comDigito('3526109988877700019955001000001234112345678');
    const daFilial = comDigito('3526101122233300029955001000001234112345678');
    const caso = (chaveNfe: string) => codigos(base({
      veiculo: { status: 'sold', condition: 'used' },
      negocios: [{ id: 'd1', status: 'invoiced' }],
      registros: [entrada, registro({ tipo: 'saida_venda', dealId: 'd1', chaveNfe, dataOperacao: '2026-10-10' })],
    }));
    expect(caso(deOutro)).toEqual(['nfe_de_outro_emitente']);
    expect(caso(daFilial)).toEqual([]);
  });

  it('venda desfeita com saída viva pede o cancelamento da saída', () => {
    const ps = pendenciasRenave(base({
      negocios: [{ id: 'd1', status: 'rescinded' }],
      registros: [entrada, registro({ tipo: 'saida_venda', dealId: 'd1', dataOperacao: '2026-10-10' })],
    }));
    expect(ps.map((p) => p.codigo)).toEqual(['saida_de_negocio_desfeito']);
  });

  it('distrato e nova venda: a segunda venda cobra a própria saída', () => {
    const ps = pendenciasRenave(base({
      veiculo: { status: 'sold', condition: 'used' },
      negocios: [
        { id: 'd1', status: 'rescinded' },
        { id: 'd2', status: 'invoiced' },
      ],
      registros: [
        entrada,
        registro({ tipo: 'saida_venda', dealId: 'd1', status: 'cancelado', dataOperacao: '2026-10-05' }),
      ],
    }));
    expect(ps).toEqual([expect.objectContaining({ codigo: 'saida_sem_registro', dealId: 'd2' })]);
  });

  it('obrigações vêm antes dos avisos', () => {
    const ps = pendenciasRenave(base({
      veiculo: { status: 'sold', condition: 'used' },
      negocios: [{ id: 'd1', status: 'invoiced' }],
      registros: [registro({ status: 'pendente', chaveNfe: null })],
    }));
    expect(ps.map((p) => p.gravidade)).toEqual(['obrigatoria', 'aviso']);
  });
});

describe('registrarRenaveSchema', () => {
  const vehicleId = '7b0f8c8e-5a0b-4c1e-9d55-1d2f3a4b5c6d';
  const dealId = '2c0f8c8e-5a0b-4c1e-9d55-1d2f3a4b5c6d';

  it('aceita a chave colada do DANFE e guarda a forma canônica', () => {
    const r = registrarRenaveSchema.parse({
      vehicleId, tipo: 'entrada_compra', protocolo: '123',
      chaveNfe: CHAVE_DA_LOJA.replace(/(.{4})/g, '$1 '),
    });
    expect(r.chaveNfe).toBe(CHAVE_DA_LOJA);
  });

  it('recusa chave com dígito errado e chave de NFC-e', () => {
    const errada = CHAVE_DA_LOJA.slice(0, 43) + '0';
    const nfce = comDigito('3526101122233300018165001000001234112345678');
    expect(chaveNfeRenaveSchema.safeParse({ chaveNfe: errada }).success).toBe(false);
    const r = chaveNfeRenaveSchema.safeParse({ chaveNfe: nfce });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('NFC-e');
  });

  it('saída por venda exige o negócio, e só ela o aceita', () => {
    expect(registrarRenaveSchema.safeParse({ vehicleId, tipo: 'saida_venda' }).success).toBe(false);
    expect(registrarRenaveSchema.safeParse({ vehicleId, tipo: 'saida_venda', dealId }).success).toBe(true);
    expect(registrarRenaveSchema.safeParse({ vehicleId, tipo: 'entrada_compra', dealId }).success).toBe(false);
  });

  it('valor não entra pelo corpo — vem da aquisição ou do negócio', () => {
    expect(registrarRenaveSchema.safeParse({ vehicleId, tipo: 'entrada_compra', valor: '1.00' }).success)
      .toBe(false);
  });

  it('data do fato no futuro é recusada', () => {
    const amanha = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(registrarRenaveSchema.safeParse({ vehicleId, tipo: 'entrada_compra', dataOperacao: amanha }).success)
      .toBe(false);
  });
});

describe('camada neutra (R2)', () => {
  it('evento só move o registro pela máquina de estados', () => {
    expect(statusDepoisDoEvento('pendente', 'confirmado')).toBe('confirmado');
    expect(statusDepoisDoEvento('pendente', 'recusado')).toBe('recusado');
    expect(statusDepoisDoEvento('confirmado', 'cancelado')).toBe('cancelado');
    // Fora de ordem: a confirmação que chega depois do cancelamento não ressuscita nada.
    expect(statusDepoisDoEvento('cancelado', 'confirmado')).toBeNull();
    expect(statusDepoisDoEvento('confirmado', 'confirmado')).toBeNull();
    expect(statusDepoisDoEvento('pendente', 'atpv_disponivel')).toBeNull();
  });

  it('documento pelo tamanho, inclusive o CNPJ alfanumérico', () => {
    expect(tipoDoDocumento('529.982.247-25')).toBe('CPF');
    expect(tipoDoDocumento('11.222.333/0001-81')).toBe('CNPJ');
    expect(tipoDoDocumento('12.ABC.345/01DE-35')).toBe('CNPJ');
    expect(tipoDoDocumento('123')).toBeNull();
    expect(tipoDoDocumento(null)).toBeNull();
  });

  describe('enviarRenaveSchema', () => {
    const vehicleId = '7b0f8c8e-5a0b-4c1e-9d55-1d2f3a4b5c6d';
    const crv = { tipoCrv: 'DIGITAL', codigoSegurancaCrv: '73915264801' };

    it('RENAVAM e vendedor não entram pelo corpo — vêm dos cadastros da nota fiscal', () => {
      expect(enviarRenaveSchema.safeParse({ vehicleId, tipo: 'entrada_compra', crv }).success).toBe(true);
      expect(enviarRenaveSchema.safeParse({
        vehicleId, tipo: 'entrada_compra', crv: { ...crv, renavam: '00123456789' },
      }).success).toBe(false);
      expect(enviarRenaveSchema.safeParse({
        vehicleId, tipo: 'entrada_compra', crv, documentoDoProprietario: '52998224725',
      }).success).toBe(false);
    });

    it('sem o documento do veículo, ou com letra no código de segurança, é recusado', () => {
      expect(enviarRenaveSchema.safeParse({ vehicleId, tipo: 'entrada_compra' }).success).toBe(false);
      expect(enviarRenaveSchema.safeParse({
        vehicleId, tipo: 'entrada_compra', crv: { ...crv, codigoSegurancaCrv: 'ABC' },
      }).success).toBe(false);
    });

    it('valor também não entra no envio', () => {
      expect(enviarRenaveSchema.safeParse({ vehicleId, tipo: 'entrada_compra', crv, valor: '1.00' }).success)
        .toBe(false);
    });
  });
});
