import { textoDaGarantia, type Garantia } from '@autoconnect/shared';

/**
 * O template do tenant é uma lista de blocos, não HTML livre.
 *
 * A restrição é deliberada: o gerador precisa produzir o mesmo byte para o
 * mesmo modelo e os mesmos dados, senão o hash não prova nada. HTML livre
 * abriria espaço para conteúdo dependente de tempo, fonte externa ou ordem de
 * atributos — tudo que faz o mesmo contrato gerar bytes diferentes.
 */
export type Bloco =
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'paragrafo'; texto: string }
  | { tipo: 'clausula'; titulo: string; itens: string[] }
  /** Renderizado a partir do domínio, não do texto que a loja escreveu. */
  | { tipo: 'garantia' }
  | { tipo: 'assinaturas' };

/** Dados congelados na emissão. Tudo string: nada é recalculado depois. */
export interface SnapshotContrato {
  emitidoEm: string;
  loja: { nome: string; documento: string | null; endereco: string | null };
  cliente: { nome: string; documento: string | null; email: string | null };
  veiculo: {
    descricao: string; anoModelo: number; anoFabricacao: number;
    placa: string | null; chassi: string | null; km: number;
  };
  valores: { tabela: string; desconto: string; venda: string };
  pagamentos: { forma: string; valor: string; detalhe: string | null }[];
  garantia: Garantia;
}

const ROTULO_PAGAMENTO: Record<string, string> = {
  cash: 'À vista', down_payment: 'Entrada', trade_in: 'Troca',
  financing: 'Financiamento', consortium: 'Consórcio', other: 'Outro',
};

/**
 * Troca `{{caminho.no.snapshot}}` pelo valor. Placeholder desconhecido vira
 * string vazia em vez de aparecer cru no contrato — um `{{cliente.nome}}` no
 * documento impresso é pior do que um espaço em branco.
 */
export function resolver(texto: string, snap: SnapshotContrato): string {
  return texto.replace(/\{\{([\w.]+)\}\}/g, (_, caminho: string) => {
    const valor = caminho
      .split('.')
      .reduce<unknown>((acc, chave) => (acc as Record<string, unknown>)?.[chave], snap);
    return valor == null ? '' : String(valor);
  });
}

/** Blocos → conteúdo do pdfmake. Sem nada dependente de relógio ou ambiente. */
export function paraConteudo(blocos: Bloco[], snap: SnapshotContrato): object[] {
  const saida: object[] = [];

  for (const bloco of blocos) {
    switch (bloco.tipo) {
      case 'titulo':
        saida.push({
          text: resolver(bloco.texto, snap),
          style: 'titulo', margin: [0, 0, 0, 12],
        });
        break;

      case 'paragrafo':
        saida.push({
          text: resolver(bloco.texto, snap),
          style: 'corpo', margin: [0, 0, 0, 8],
        });
        break;

      case 'clausula':
        saida.push({
          text: resolver(bloco.titulo, snap),
          style: 'clausula', margin: [0, 10, 0, 4],
        });
        saida.push({
          ol: bloco.itens.map((i) => resolver(i, snap)),
          style: 'corpo', margin: [0, 0, 0, 6],
        });
        break;

      case 'garantia':
        saida.push({ text: 'GARANTIA', style: 'clausula', margin: [0, 10, 0, 4] });
        saida.push({
          ul: textoDaGarantia(snap.garantia),
          style: 'corpo', margin: [0, 0, 0, 6],
        });
        break;

      case 'assinaturas':
        saida.push({
          margin: [0, 40, 0, 0],
          columns: [
            { text: `_______________________________\n${snap.loja.nome}\nVendedor`, style: 'corpo', alignment: 'center' },
            { text: `_______________________________\n${snap.cliente.nome}\nComprador`, style: 'corpo', alignment: 'center' },
          ],
        });
        break;
    }
  }

  return saida;
}

/** Tabela de valores e composição do pagamento, sempre na mesma ordem. */
export function blocoDeValores(snap: SnapshotContrato): object {
  const linhas = snap.pagamentos.map((p) => [
    ROTULO_PAGAMENTO[p.forma] ?? p.forma,
    p.detalhe ?? '—',
    { text: `R$ ${p.valor}`, alignment: 'right' },
  ]);

  return {
    margin: [0, 8, 0, 8],
    table: {
      widths: ['*', '*', 'auto'],
      body: [
        [{ text: 'Forma', bold: true }, { text: 'Detalhe', bold: true }, { text: 'Valor', bold: true, alignment: 'right' }],
        ...(linhas.length ? linhas : [['—', '—', { text: 'R$ 0,00', alignment: 'right' }]]),
        [{ text: 'Total', bold: true }, '', { text: `R$ ${snap.valores.venda}`, bold: true, alignment: 'right' }],
      ],
    },
    layout: 'lightHorizontalLines',
  };
}

/**
 * Template padrão. Existe para que uma loja nova emita contrato no primeiro
 * dia — e está declarado como ponto de partida, não como peça revisada: o
 * portão da Fase 2 exige revisão por advogado antes de cliente real usar.
 */
export const TEMPLATE_PADRAO: Bloco[] = [
  { tipo: 'titulo', texto: 'CONTRATO DE COMPRA E VENDA DE VEÍCULO AUTOMOTOR' },
  {
    tipo: 'paragrafo',
    texto:
      'VENDEDORA: {{loja.nome}}, inscrita no CNPJ sob o nº {{loja.documento}}, ' +
      'com endereço em {{loja.endereco}}.',
  },
  {
    tipo: 'paragrafo',
    texto: 'COMPRADOR(A): {{cliente.nome}}, portador(a) do documento {{cliente.documento}}.',
  },
  {
    tipo: 'clausula',
    titulo: 'CLÁUSULA 1ª — DO OBJETO',
    itens: [
      'O objeto deste contrato é o veículo {{veiculo.descricao}}, ' +
        'ano de fabricação {{veiculo.anoFabricacao}}, modelo {{veiculo.anoModelo}}, ' +
        'placa {{veiculo.placa}}, chassi {{veiculo.chassi}}, ' +
        'com {{veiculo.km}} km registrados no odômetro na data desta emissão.',
    ],
  },
  {
    tipo: 'clausula',
    titulo: 'CLÁUSULA 2ª — DO PREÇO E DA FORMA DE PAGAMENTO',
    itens: [
      'O preço total ajustado é de R$ {{valores.venda}}, ' +
        'sobre o valor de tabela de R$ {{valores.tabela}}, ' +
        'com desconto concedido de R$ {{valores.desconto}}.',
      'O pagamento observará a composição discriminada no quadro abaixo.',
    ],
  },
  { tipo: 'garantia' },
  {
    tipo: 'clausula',
    titulo: 'CLÁUSULA 4ª — DO FORO',
    itens: ['Fica eleito o foro do domicílio do consumidor, nos termos do art. 101, I, do CDC.'],
  },
  { tipo: 'paragrafo', texto: 'Emitido em {{emitidoEm}}.' },
  { tipo: 'assinaturas' },
];
