/**
 * Nota fiscal do veículo: perfil fiscal da loja e a montagem da NF-e.
 *
 * Trilha N do plano fiscal (`docs/planos/plano-fiscal-renave-nfe.md`). Este
 * arquivo **monta** a nota no vocabulário do domínio — quem a transforma no
 * formato do emissor é o adaptador, e quem calcula tributo é o emissor e o
 * contador. Daí as duas regras que o atravessam:
 *
 *  1. **Tributo não é decidido aqui.** CFOP, situação tributária e texto de
 *     informações complementares vêm do perfil da loja. As sugestões abaixo são
 *     ponto de partida para a conversa com o contador, nunca padrão silencioso:
 *     a situação tributária nem tem sugestão, e produção exige o carimbo de
 *     que o contador confirmou.
 *  2. **O que falta é dito, não adivinhado.** `montarNota` devolve a lista de
 *     faltas em vez de preencher o buraco — como `pendenciasParaPublicar` faz
 *     com o anúncio. Nota com campo inventado é pior que nota não emitida.
 */
import { cnpjValido, cpfValido } from '../schemas/auth';
import { chassiValido } from './consulta-veicular';
import { deCentavos, emCentavos } from './dinheiro';

/* ── Regime tributário ───────────────────────────────────────── */

export const REGIMES_TRIBUTARIOS = [
  'mei',
  'simples_nacional',
  'simples_excesso_sublimite',
  'lucro_presumido',
  'lucro_real',
] as const;
export type RegimeTributario = (typeof REGIMES_TRIBUTARIOS)[number];

export const ROTULO_DO_REGIME: Record<RegimeTributario, string> = {
  mei: 'MEI',
  simples_nacional: 'Simples Nacional',
  simples_excesso_sublimite: 'Simples Nacional — excesso de sublimite',
  lucro_presumido: 'Lucro Presumido',
  lucro_real: 'Lucro Real',
};

/**
 * Código de Regime Tributário da NF-e. Presumido e Real são o mesmo CRT (3,
 * "regime normal") — a diferença entre eles é de apuração, que é do contador.
 */
export function crtDoRegime(regime: RegimeTributario): 1 | 2 | 3 | 4 {
  switch (regime) {
    case 'simples_nacional': return 1;
    case 'simples_excesso_sublimite': return 2;
    case 'mei': return 4;
    default: return 3;
  }
}

/**
 * CSOSN para quem está no Simples (CRT 1) e para o MEI (CRT 4); CST para o
 * resto, inclusive o Simples em excesso de sublimite, que recolhe ICMS por fora.
 */
export function usaCsosn(regime: RegimeTributario): boolean {
  const crt = crtDoRegime(regime);
  return crt === 1 || crt === 4;
}

const CSOSNS = new Set(['101', '102', '103', '201', '202', '203', '300', '400', '500', '900']);
const CSTS_DE_ICMS = new Set(['00', '02', '10', '15', '20', '30', '40', '41', '50', '51', '53', '60', '61', '70', '90']);

/** A situação tributária do ICMS é do tipo que o regime da loja usa? */
export function situacaoTributariaValida(regime: RegimeTributario, codigo: string): boolean {
  return usaCsosn(regime) ? CSOSNS.has(codigo) : CSTS_DE_ICMS.has(codigo);
}

export const AMBIENTES_FISCAIS = ['homologacao', 'producao'] as const;
export type AmbienteFiscal = (typeof AMBIENTES_FISCAIS)[number];

/* ── Operações ───────────────────────────────────────────────── */

export const OPERACOES_FISCAIS = [
  'venda',
  'compra_de_particular',
  'entrada_de_troca',
  'entrada_em_consignacao',
  'devolucao_de_consignacao',
  'venda_de_consignado',
] as const;
export type OperacaoFiscal = (typeof OPERACOES_FISCAIS)[number];

export type DirecaoDaNota = 'entrada' | 'saida';

/** Para frase: o identificador `saida` não tem acento, o texto tem. */
export const ROTULO_DA_DIRECAO: Record<DirecaoDaNota, string> = { entrada: 'entrada', saida: 'saída' };

export interface DefinicaoDaOperacao {
  rotulo: string;
  direcao: DirecaoDaNota;
  /** Para a tela: quando esta nota existe, em uma frase. */
  quando: string;
  naturezaSugerida: string;
  cfopInternoSugerido: string;
  cfopInterestadualSugerido: string;
}

/**
 * As operações de uma revenda de usados, com **sugestões** de natureza e CFOP.
 *
 * Os CFOPs são os da tabela nacional para cada caso, e mesmo assim são
 * sugestão: consignação de veículo de particular, por exemplo, tem tratamento
 * que varia por estado e por contador. A situação tributária (CST/CSOSN) não
 * tem sugestão nenhuma — depende do regime, do estado e da redução de base de
 * cálculo que a loja aplica, e errar ali é tributo errado, não campo feio.
 */
export const DEFINICAO_DAS_OPERACOES: Record<OperacaoFiscal, DefinicaoDaOperacao> = {
  venda: {
    rotulo: 'Venda de veículo',
    direcao: 'saida',
    quando: 'A loja vende um veículo do próprio estoque.',
    naturezaSugerida: 'Venda de veículo usado',
    cfopInternoSugerido: '5102',
    cfopInterestadualSugerido: '6102',
  },
  compra_de_particular: {
    rotulo: 'Compra de particular',
    direcao: 'entrada',
    quando: 'A loja compra um veículo de pessoa física, que não emite nota.',
    naturezaSugerida: 'Compra de veículo usado para revenda',
    cfopInternoSugerido: '1102',
    cfopInterestadualSugerido: '2102',
  },
  entrada_de_troca: {
    rotulo: 'Entrada de troca',
    direcao: 'entrada',
    quando: 'O cliente dá o usado dele como parte do pagamento.',
    naturezaSugerida: 'Entrada de veículo usado recebido em troca',
    cfopInternoSugerido: '1102',
    cfopInterestadualSugerido: '2102',
  },
  entrada_em_consignacao: {
    rotulo: 'Entrada em consignação',
    direcao: 'entrada',
    quando: 'O dono deixa o veículo na loja para venda, sem a loja comprá-lo.',
    naturezaSugerida: 'Entrada de veículo em consignação',
    cfopInternoSugerido: '1917',
    cfopInterestadualSugerido: '2917',
  },
  devolucao_de_consignacao: {
    rotulo: 'Devolução de consignado',
    direcao: 'saida',
    quando: 'O consignado volta para o dono sem ter sido vendido.',
    naturezaSugerida: 'Devolução de veículo recebido em consignação',
    cfopInternoSugerido: '5918',
    cfopInterestadualSugerido: '6918',
  },
  venda_de_consignado: {
    rotulo: 'Venda de consignado',
    direcao: 'saida',
    quando: 'A loja vende um veículo que estava em consignação.',
    naturezaSugerida: 'Venda de veículo recebido em consignação',
    cfopInternoSugerido: '5115',
    cfopInterestadualSugerido: '6115',
  },
};

/**
 * A nota de saída de um negócio: venda do estoque ou venda de consignado.
 *
 * Decide pela origem da aquisição do veículo, que o estoque já registra — o
 * vendedor não escolhe a natureza da nota, e por isso não erra.
 */
export function operacaoDeSaidaDoNegocio(origemDaAquisicao: string | null): OperacaoFiscal {
  return origemDaAquisicao === 'consignment' ? 'venda_de_consignado' : 'venda';
}

export type DestinoDaOperacao = 'interna' | 'interestadual';

/**
 * Interna ou interestadual.
 *
 * **Venda presencial é interna mesmo com comprador de outro estado:** quem vem
 * à loja e leva o carro consome a operação no estado da loja, e a nota sai com
 * CFOP 5. É o caso comum de revenda — o comprador de Minas que busca o carro em
 * São Paulo — e marcar interestadual por causa do endereço do comprador
 * mudaria o CFOP e o imposto. Confirmar com o contador, como o resto.
 */
export function destinoDaOperacao(
  ufDaLoja: string,
  ufDaContraparte: string,
  presencial: boolean,
): DestinoDaOperacao {
  if (presencial) return 'interna';
  return ufDaLoja.toUpperCase() === ufDaContraparte.toUpperCase() ? 'interna' : 'interestadual';
}

/**
 * O CFOP tem quatro dígitos e o primeiro diz a direção e o destino: 1 e 2 são
 * entradas, 5 e 6 são saídas; 1 e 5 internas, 2 e 6 interestaduais. Operação
 * com o exterior (3 e 7) não é desta trilha.
 */
export function cfopValido(cfop: string, direcao: DirecaoDaNota, destino: DestinoDaOperacao): boolean {
  return /^\d{4}$/.test(cfop) && cfop[0] === primeiroDigitoDoCfop(direcao, destino);
}

function primeiroDigitoDoCfop(direcao: DirecaoDaNota, destino: DestinoDaOperacao): string {
  if (direcao === 'entrada') return destino === 'interna' ? '1' : '2';
  return destino === 'interna' ? '5' : '6';
}

/* ── Dados do veículo ────────────────────────────────────────── */

/** NCM: oito dígitos. Automóvel de passageiro é capítulo 87.03. */
export function normalizarNcm(bruto: string | null | undefined): string | null {
  const d = (bruto ?? '').replace(/\D/g, '');
  return d.length === 8 ? d : null;
}

/**
 * RENAVAM: onze dígitos. Os antigos, de nove, ganham zeros à esquerda — é a
 * forma que o Detran passou a imprimir.
 *
 * O dígito verificador **não** é conferido: o algoritmo circula em versões
 * diferentes, e recusar um RENAVAM verdadeiro trava a nota de um carro que
 * existe. Sobra o tamanho, que pega o colado pela metade.
 */
export function normalizarRenavam(bruto: string | null | undefined): string | null {
  const d = (bruto ?? '').replace(/\D/g, '');
  if (d.length < 9 || d.length > 11) return null;
  return d.padStart(11, '0');
}

/** Origem da mercadoria (0 = nacional; 1 e 2 = importada). Vai junto do CST. */
export const ORIGENS_DA_MERCADORIA = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

/* ── Montagem ────────────────────────────────────────────────── */

export interface EnderecoFiscal {
  logradouro: string | null;
  numero: string | null;
  complemento?: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
}

export interface ConfiguracaoFiscal {
  regime: RegimeTributario;
  serie: number;
  ambiente: AmbienteFiscal;
  /** ISO. `null` enquanto ninguém registrou que o contador confirmou. */
  contadorConfirmouEm: string | null;
}

export interface PerfilDaOperacao {
  natureza: string;
  cfopInterno: string;
  cfopInterestadual: string;
  /** CST (2 dígitos) ou CSOSN (3), conforme o regime. */
  situacaoTributaria: string | null;
  informacoesComplementares: string | null;
}

export interface ContextoDaNota {
  operacao: OperacaoFiscal;
  configuracao: ConfiguracaoFiscal | null;
  perfil: PerfilDaOperacao | null;
  emitente: {
    cnpj: string | null;
    inscricaoEstadual: string | null;
    razaoSocial: string;
    nomeFantasia: string;
    endereco: EnderecoFiscal | null;
  };
  /** Destinatário na saída, remetente na entrada. */
  contraparte: {
    nome: string | null;
    documento: string | null;
    endereco: EnderecoFiscal | null;
    email?: string | null;
  };
  veiculo: {
    marca: string;
    modelo: string;
    versao: string | null;
    anoFabricacao: number;
    anoModelo: number;
    cor: string | null;
    quilometragem: number;
    chassi: string | null;
    placa: string | null;
    renavam: string | null;
    ncm: string | null;
    origem: number;
  };
  /** Decimal em string, como todo dinheiro do projeto (`"84900.00"`). */
  valor: string;
  /** A contraparte esteve na loja. Ver `destinoDaOperacao`. */
  presencial: boolean;
}

/** Onde se corrige a falta — a tela usa para mandar a pessoa ao lugar certo. */
export type LugarDaFalta = 'perfil_fiscal' | 'loja' | 'veiculo' | 'contraparte' | 'negocio';

export interface FaltaParaEmitir {
  campo: string;
  onde: LugarDaFalta;
  mensagem: string;
}

export interface NotaMontada {
  operacao: OperacaoFiscal;
  direcao: DirecaoDaNota;
  natureza: string;
  cfop: string;
  destino: DestinoDaOperacao;
  presencial: boolean;
  crt: 1 | 2 | 3 | 4;
  situacaoTributaria: string;
  ambiente: AmbienteFiscal;
  serie: number;
  emitente: {
    cnpj: string;
    inscricaoEstadual: string;
    razaoSocial: string;
    nomeFantasia: string;
    endereco: EnderecoFiscal;
  };
  contraparte: {
    nome: string;
    tipoDeDocumento: 'cpf' | 'cnpj';
    documento: string;
    endereco: EnderecoFiscal;
    email: string | null;
  };
  item: {
    descricao: string;
    ncm: string;
    cfop: string;
    origem: number;
    quantidade: '1';
    valorUnitario: string;
    valorTotal: string;
    chassi: string;
    placa: string | null;
    renavam: string;
  };
  valorTotal: string;
  informacoesComplementares: string | null;
}

export interface ResultadoDaMontagem {
  nota: NotaMontada | null;
  faltas: FaltaParaEmitir[];
}

const CAMPOS_DO_ENDERECO: [keyof EnderecoFiscal, string][] = [
  ['logradouro', 'logradouro'],
  ['numero', 'número'],
  ['bairro', 'bairro'],
  ['cidade', 'cidade'],
  ['uf', 'UF'],
  ['cep', 'CEP'],
];

function faltasDoEndereco(
  endereco: EnderecoFiscal | null,
  prefixo: string,
  onde: LugarDaFalta,
  de: string,
): FaltaParaEmitir[] {
  const vazios = CAMPOS_DO_ENDERECO
    .filter(([campo]) => !endereco?.[campo]?.toString().trim())
    .map(([, nome]) => nome);
  if (vazios.length === 0) return [];
  return [{
    campo: `${prefixo}.endereco`,
    onde,
    mensagem: `Endereço ${de} incompleto: falta ${vazios.join(', ')}.`,
  }];
}

function descricaoDoItem(v: ContextoDaNota['veiculo'], renavam: string): string {
  const nome = [v.marca, v.modelo, v.versao].filter(Boolean).join(' ');
  const partes = [
    `${nome} ${v.anoFabricacao}/${v.anoModelo}`,
    v.cor ? `cor ${v.cor}` : null,
    `chassi ${(v.chassi ?? '').toUpperCase()}`,
    v.placa ? `placa ${v.placa.toUpperCase()}` : null,
    `RENAVAM ${renavam}`,
    `${v.quilometragem.toLocaleString('pt-BR')} km`,
  ];
  return partes.filter(Boolean).join(', ');
}

/**
 * Monta a nota, ou diz tudo o que falta de uma vez.
 *
 * Tudo de uma vez é de propósito: devolver só a primeira falta transforma a
 * emissão numa sequência de "corrigi, tentei, faltou outra coisa".
 *
 * Em **homologação** a confirmação do contador não é exigida: é exatamente o
 * ambiente em que a loja testa o perfil antes de levá-lo ao contador.
 */
export function montarNota(ctx: ContextoDaNota): ResultadoDaMontagem {
  const faltas: FaltaParaEmitir[] = [];
  const def = DEFINICAO_DAS_OPERACOES[ctx.operacao];
  const { configuracao: cfg, perfil, emitente, contraparte, veiculo } = ctx;

  // Perfil fiscal da loja
  if (!cfg) {
    faltas.push({
      campo: 'configuracao',
      onde: 'perfil_fiscal',
      mensagem: 'Configure o perfil fiscal da loja (regime tributário e série).',
    });
  } else if (cfg.ambiente === 'producao' && !cfg.contadorConfirmouEm) {
    faltas.push({
      campo: 'configuracao.contadorConfirmouEm',
      onde: 'perfil_fiscal',
      mensagem:
        'Para emitir em produção, registre que o contador confirmou o perfil fiscal. ' +
        'Em homologação dá para testar antes.',
    });
  }

  if (!perfil) {
    faltas.push({
      campo: 'perfil',
      onde: 'perfil_fiscal',
      mensagem: `Configure a operação "${def.rotulo}" no perfil fiscal.`,
    });
  } else {
    if (!perfil.natureza.trim()) {
      faltas.push({ campo: 'perfil.natureza', onde: 'perfil_fiscal', mensagem: `Defina a natureza da operação "${def.rotulo}".` });
    }
    if (!perfil.situacaoTributaria) {
      faltas.push({
        campo: 'perfil.situacaoTributaria',
        onde: 'perfil_fiscal',
        mensagem: `Defina a situação tributária do ICMS (CST ou CSOSN) da operação "${def.rotulo}" com o contador.`,
      });
    } else if (cfg && !situacaoTributariaValida(cfg.regime, perfil.situacaoTributaria)) {
      faltas.push({
        campo: 'perfil.situacaoTributaria',
        onde: 'perfil_fiscal',
        mensagem:
          `A situação tributária ${perfil.situacaoTributaria} não é ${usaCsosn(cfg.regime) ? 'um CSOSN' : 'um CST'} — ` +
          `é o que o regime ${ROTULO_DO_REGIME[cfg.regime]} usa.`,
      });
    }
  }

  // Emitente
  if (!emitente.cnpj || !cnpjValido(emitente.cnpj)) {
    faltas.push({ campo: 'emitente.cnpj', onde: 'loja', mensagem: 'O CNPJ da loja está ausente ou inválido.' });
  }
  if (!emitente.inscricaoEstadual?.trim()) {
    faltas.push({
      campo: 'emitente.inscricaoEstadual',
      onde: 'loja',
      mensagem: 'Informe a inscrição estadual da loja — revenda de veículos é contribuinte do ICMS.',
    });
  }
  faltas.push(...faltasDoEndereco(emitente.endereco, 'emitente', 'loja', 'da matriz'));

  // Contraparte
  const quem = def.direcao === 'saida' ? 'do comprador' : 'de quem entrega o veículo';
  const documento = (contraparte.documento ?? '').replace(/\D/g, '');
  const tipoDeDocumento: 'cpf' | 'cnpj' | null =
    documento.length === 11 && cpfValido(documento) ? 'cpf'
    : documento.length === 14 && cnpjValido(documento) ? 'cnpj'
    : null;
  if (!contraparte.nome?.trim()) {
    faltas.push({ campo: 'contraparte.nome', onde: 'contraparte', mensagem: `Falta o nome ${quem}.` });
  }
  if (!tipoDeDocumento) {
    faltas.push({ campo: 'contraparte.documento', onde: 'contraparte', mensagem: `O CPF ou CNPJ ${quem} está ausente ou inválido.` });
  }
  faltas.push(...faltasDoEndereco(contraparte.endereco, 'contraparte', 'contraparte', quem));

  // Veículo
  if (!veiculo.chassi || !chassiValido(veiculo.chassi)) {
    faltas.push({ campo: 'veiculo.chassi', onde: 'veiculo', mensagem: 'O chassi do veículo está ausente ou não tem 17 caracteres válidos.' });
  }
  const ncm = normalizarNcm(veiculo.ncm);
  if (!ncm) {
    faltas.push({ campo: 'veiculo.ncm', onde: 'veiculo', mensagem: 'Informe o NCM do veículo (8 dígitos) nos dados fiscais.' });
  }
  const renavam = normalizarRenavam(veiculo.renavam);
  if (!renavam) {
    faltas.push({ campo: 'veiculo.renavam', onde: 'veiculo', mensagem: 'Informe o RENAVAM do veículo nos dados fiscais.' });
  }

  // Valor
  let centavos: bigint | null = null;
  try {
    centavos = emCentavos(ctx.valor);
  } catch {
    // valor fora do formato decimal: a falta abaixo diz isso.
  }
  if (centavos === null || centavos <= 0n) {
    faltas.push({ campo: 'valor', onde: 'negocio', mensagem: 'O valor da operação precisa ser maior que zero.' });
  }

  // CFOP — só dá para conferir com o perfil e os dois endereços em mãos.
  const ufDaLoja = emitente.endereco?.uf ?? null;
  const ufDaContraparte = contraparte.endereco?.uf ?? null;
  let destino: DestinoDaOperacao | null = null;
  let cfop: string | null = null;
  if (perfil && ufDaLoja && ufDaContraparte) {
    destino = destinoDaOperacao(ufDaLoja, ufDaContraparte, ctx.presencial);
    cfop = destino === 'interna' ? perfil.cfopInterno : perfil.cfopInterestadual;
    if (!cfopValido(cfop, def.direcao, destino)) {
      faltas.push({
        campo: destino === 'interna' ? 'perfil.cfopInterno' : 'perfil.cfopInterestadual',
        onde: 'perfil_fiscal',
        mensagem:
          `O CFOP ${destino === 'interna' ? 'interno' : 'interestadual'} "${cfop}" da operação "${def.rotulo}" ` +
          `não serve para uma ${ROTULO_DA_DIRECAO[def.direcao]} ${destino} — deveria começar com ` +
          `${primeiroDigitoDoCfop(def.direcao, destino)}.`,
      });
    }
  }

  if (
    faltas.length > 0 || !cfg || !perfil || !destino || !cfop
    || !tipoDeDocumento || !ncm || !renavam || centavos === null
  ) {
    return { nota: null, faltas };
  }

  const valor = deCentavos(centavos);

  return {
    faltas: [],
    nota: {
      operacao: ctx.operacao,
      direcao: def.direcao,
      natureza: perfil.natureza.trim(),
      cfop,
      destino,
      presencial: ctx.presencial,
      crt: crtDoRegime(cfg.regime),
      situacaoTributaria: perfil.situacaoTributaria!,
      ambiente: cfg.ambiente,
      serie: cfg.serie,
      emitente: {
        cnpj: emitente.cnpj!.replace(/\D/g, ''),
        inscricaoEstadual: emitente.inscricaoEstadual!.trim(),
        razaoSocial: emitente.razaoSocial,
        nomeFantasia: emitente.nomeFantasia,
        endereco: emitente.endereco!,
      },
      contraparte: {
        nome: contraparte.nome!.trim(),
        tipoDeDocumento,
        documento,
        endereco: contraparte.endereco!,
        email: contraparte.email ?? null,
      },
      item: {
        descricao: descricaoDoItem(veiculo, renavam),
        ncm,
        cfop,
        origem: veiculo.origem,
        quantidade: '1',
        valorUnitario: valor,
        valorTotal: valor,
        chassi: veiculo.chassi!.toUpperCase(),
        placa: veiculo.placa ? veiculo.placa.toUpperCase() : null,
        renavam,
      },
      valorTotal: valor,
      informacoesComplementares: perfil.informacoesComplementares?.trim() || null,
    },
  };
}
