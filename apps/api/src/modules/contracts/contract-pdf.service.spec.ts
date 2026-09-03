import { ContractPdfService } from './contract-pdf.service';
import { TEMPLATE_PADRAO, resolver, type SnapshotContrato } from './blocos';

/**
 * O hash só prova alguma coisa se a geração for determinística. Sem fixar a
 * data de criação, o pdfmake carimba o relógio e o mesmo contrato produz bytes
 * diferentes a cada geração — o primeiro teste daqui é o que garante que essa
 * armadilha não volte.
 */
describe('ContractPdfService', () => {
  const servico = new ContractPdfService();
  const emitidoEm = new Date('2026-09-03T12:00:00.000Z');

  const snap = (): SnapshotContrato => ({
    emitidoEm: '03/09/2026',
    loja: { nome: 'Loja Demo', documento: '00.000.000/0001-91', endereco: 'Rua A, 1' },
    cliente: { nome: 'Maria Silva', documento: '123.456.789-00', email: 'm@ex.com' },
    veiculo: {
      descricao: 'Volkswagen Nivus Highline', anoModelo: 2024, anoFabricacao: 2023,
      placa: 'ABC1D23', chassi: '9BW', km: 12000,
    },
    valores: { tabela: '132.900,00', desconto: '4.900,00', venda: '128.000,00' },
    pagamentos: [
      { forma: 'down_payment', valor: '30.000,00', detalhe: null },
      { forma: 'financing', valor: '98.000,00', detalhe: 'Banco Demo · 48x' },
    ],
    garantia: { legalDays: 90, contractualMonths: 12, contractualScope: 'motor e câmbio' },
  });

  it('o mesmo contrato gera o mesmo hash', async () => {
    const a = await servico.gerar(TEMPLATE_PADRAO, snap(), emitidoEm);
    await new Promise((r) => setTimeout(r, 1100)); // o relógio anda entre as duas
    const b = await servico.gerar(TEMPLATE_PADRAO, snap(), emitidoEm);

    expect(a.hash).toBe(b.hash);
    expect(a.pdf.equals(b.pdf)).toBe(true);
  }, 30_000);

  it('mudar um centavo muda o hash', async () => {
    const a = await servico.gerar(TEMPLATE_PADRAO, snap(), emitidoEm);
    const outro = snap();
    outro.valores.venda = '128.000,01';
    const b = await servico.gerar(TEMPLATE_PADRAO, outro, emitidoEm);

    expect(a.hash).not.toBe(b.hash);
  }, 30_000);

  it('mudar o template muda o hash', async () => {
    const a = await servico.gerar(TEMPLATE_PADRAO, snap(), emitidoEm);
    const b = await servico.gerar(
      [...TEMPLATE_PADRAO, { tipo: 'paragrafo', texto: 'Cláusula extra.' }],
      snap(),
      emitidoEm,
    );

    expect(a.hash).not.toBe(b.hash);
  }, 30_000);

  it('emitir em datas diferentes muda o hash — cada emissão é um documento', async () => {
    const a = await servico.gerar(TEMPLATE_PADRAO, snap(), emitidoEm);
    const b = await servico.gerar(TEMPLATE_PADRAO, snap(), new Date('2026-09-04T12:00:00.000Z'));

    expect(a.hash).not.toBe(b.hash);
  }, 30_000);

  it('produz um PDF de verdade', async () => {
    const { pdf } = await servico.gerar(TEMPLATE_PADRAO, snap(), emitidoEm);

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30_000);
});

describe('resolução de placeholders', () => {
  const snap = { cliente: { nome: 'Maria' }, valores: { venda: '10,00' } } as never;

  it('substitui pelo valor do snapshot', () => {
    expect(resolver('Olá {{cliente.nome}}, total {{valores.venda}}', snap))
      .toBe('Olá Maria, total 10,00');
  });

  it('placeholder desconhecido vira vazio, não texto cru', () => {
    // `{{cliente.cpf}}` impresso no contrato é pior que um espaço em branco.
    expect(resolver('CPF: {{cliente.cpf}}.', snap)).toBe('CPF: .');
  });
});
