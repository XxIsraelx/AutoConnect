import { conferirOperacao, type OperacaoParaConferir } from './conferencia-fiscal';

const CHAVE = '35261011222333000181550010000012341123456787';
const OUTRA = '35261011222333000181550010000099991123456780';

/** Uma venda em que tudo bate. Cada teste estraga uma coisa. */
function venda(mudar: Partial<OperacaoParaConferir> = {}): OperacaoParaConferir {
  return {
    tipo: 'saida', origemId: 'negocio-1', vehicleId: 'v1', veiculo: 'Fiat Argo ABC1D23',
    data: '2026-10-10T15:00:00Z', valor: '82500.00', notaPropriaEsperada: true,
    notas: [{ id: 'n1', status: 'autorizada', chave: CHAVE, valorTotal: '82500.00', autorizadaEm: '2026-10-10T16:00:00Z', criadaEm: '2026-10-10T15:59:00Z' }],
    renave: [{ id: 'r1', tipo: 'saida_venda', status: 'confirmado', chaveNfe: CHAVE, valor: '82500.00', dataOperacao: '2026-10-10T12:00:00Z' }],
    ...mudar,
  };
}
const codigos = (op: OperacaoParaConferir) => conferirOperacao(op).divergencias.map((d) => d.codigo);

describe('conferirOperacao', () => {
  it('estoque, nota e RENAVE contando a mesma história: nada a dizer', () => {
    const r = conferirOperacao(venda());
    expect(r.divergencias).toEqual([]);
    expect(r.nota?.id).toBe('n1');
    expect(r.renave?.id).toBe('r1');
  });

  it('valor da nota e do RENAVE diferentes do negócio são divergências, com os dois números', () => {
    const r = conferirOperacao(venda({
      notas: [{ ...venda().notas[0]!, valorTotal: '82000.00' }],
      renave: [{ ...venda().renave[0]!, valor: '85200.00' }],
    }));
    expect(r.divergencias.map((d) => [d.codigo, d.gravidade])).toEqual([
      ['valor_da_nota', 'divergencia'], ['valor_no_renave', 'divergencia'],
    ]);
    expect(r.divergencias[1]!.mensagem).toContain('85.200,00');
  });

  it('chave ausente no RENAVE vem com a da nota como sugestão; chave errada é divergência', () => {
    const ausente = conferirOperacao(venda({ renave: [{ ...venda().renave[0]!, chaveNfe: null }] }));
    expect(ausente.divergencias).toEqual([expect.objectContaining({ codigo: 'chave_ausente_no_renave', sugestao: CHAVE })]);
    expect(codigos(venda({ renave: [{ ...venda().renave[0]!, chaveNfe: OUTRA }] }))).toEqual(['chave_diferente']);
  });

  it('data do RENAVE em outro dia (de Brasília) é aviso; mesmo dia em fuso diferente não é', () => {
    expect(codigos(venda({ renave: [{ ...venda().renave[0]!, dataOperacao: '2026-10-12T12:00:00Z' }] }))).toEqual(['data_no_renave']);
    // 01:00 UTC do dia 11 ainda é dia 10 em Brasília.
    expect(codigos(venda({ renave: [{ ...venda().renave[0]!, dataOperacao: '2026-10-11T01:00:00Z' }] }))).toEqual([]);
  });

  it('sem nota e sem RENAVE: dois avisos; nota rejeitada e RENAVE pendente: dois avisos diferentes', () => {
    expect(codigos(venda({ notas: [], renave: [] }))).toEqual(['sem_nota', 'sem_renave']);
    expect(codigos(venda({
      notas: [{ ...venda().notas[0]!, status: 'rejeitada', chave: null, autorizadaEm: null }],
      renave: [{ ...venda().renave[0]!, status: 'pendente' }],
    }))).toEqual(['nota_nao_autorizada', 'renave_nao_confirmado']);
  });

  it('a nota autorizada conta mesmo havendo rejeitadas e canceladas mais novas', () => {
    const r = conferirOperacao(venda({
      notas: [
        { id: 'velha', status: 'rejeitada', chave: null, valorTotal: '82500.00', autorizadaEm: null, criadaEm: '2026-10-10T15:00:00Z' },
        venda().notas[0]!,
      ],
    }));
    expect(r.nota?.id).toBe('n1');
  });

  it('registro cancelado não conta como vivo; o vivo mais recente é o que vale', () => {
    expect(codigos(venda({ renave: [{ ...venda().renave[0]!, status: 'cancelado' }] }))).toEqual(['sem_renave']);
    const r = conferirOperacao(venda({
      renave: [
        { ...venda().renave[0]!, id: 'antigo', status: 'cancelado', dataOperacao: '2026-10-11T12:00:00Z' },
        venda().renave[0]!,
      ],
    }));
    expect(r.renave?.id).toBe('r1');
  });

  it('entrada de pessoa jurídica não tem nota nossa: não é divergência, e a chave não se cruza', () => {
    const entrada: OperacaoParaConferir = {
      ...venda(), tipo: 'entrada', notaPropriaEsperada: false, notas: [], valor: '61000.00',
      renave: [{ id: 'e1', tipo: 'entrada_compra', status: 'confirmado', chaveNfe: OUTRA, valor: '61000.00', dataOperacao: '2026-10-10T12:00:00Z' }],
    };
    expect(conferirOperacao(entrada).divergencias).toEqual([]);
  });

  it('RENAVE sem valor (transferência) não compara valor', () => {
    expect(codigos(venda({ renave: [{ ...venda().renave[0]!, valor: null }] }))).toEqual([]);
  });
});
