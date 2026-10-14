/**
 * RENAVE — o que a loja já registrou e o que está faltando.
 *
 * Trilha R do plano fiscal (`docs/planos/plano-fiscal-renave-nfe.md`). O
 * AutoConnect **não** fala com o RENAVE: quem fala é a integradora credenciada
 * que a loja escolheu. Este arquivo responde a pergunta que sobra para nós —
 * "o que falta registrar?" — sem banco e sem tela, para a API e o painel
 * darem a mesma resposta.
 *
 * **De onde vem cada regra.** O manual técnico do renave-ws (SERPRO,
 * `renave.estaleiro.serpro.gov.br/renave-ws/manual/`), lido em 14/10/2026:
 *
 *  - entrada em estoque exige `dataCompra` e `valorCompra`; saída exige
 *    `dataVenda`, `valorVenda` e o documento do comprador;
 *  - a NF-e **não** vai na entrada nem na saída: é um passo seguinte
 *    (`POST /api/notas-fiscais`, evento `COMPRA` ou `VENDA`). Mas a saída só
 *    é aceita **depois** que a NF-e de entrada foi enviada;
 *  - errou? O manual prevê **cancelamento** de entrada (enquanto o Detran não
 *    agiu) e de saída (enquanto o Detran não transferiu). Não há "estorno";
 *  - a chave da NF-e informada pode ser trocada depois.
 *
 * O que **não** foi confirmado em fonte oficial nessa leitura vira `aviso`,
 * nunca `obrigatoria`: prazo em dias para registrar a entrada (nenhum no
 * manual), o módulo de consignação (entra na operação assistida de 15 a
 * 30/10/2026 e não está no manual) e o contrato eletrônico de consignação
 * (citado por fontes de mercado sobre a Resolução Contran nº 1.026/2026).
 *
 * Os enums repetem os do Prisma pelo motivo de sempre (o shared vai para o
 * navegador); `renave-paridade.spec.ts` quebra se divergirem.
 */

import type { AcquisitionOriginValue, DealStatusValue } from './deal';
import { DEAL_FATURADO_STATUSES, DEAL_TERMINAL_STATUSES } from './deal';
import { lerChaveNfe } from './chave-nfe';

/* ── Enums ──────────────────────────────────────────────────── */

export const RENAVE_OPERACOES = [
  'entrada_compra',
  'entrada_transferencia',
  'entrada_consignacao',
  'saida_venda',
  'saida_transferencia',
  'devolucao_consignado',
] as const;
export type RenaveOperacaoValue = (typeof RENAVE_OPERACOES)[number];

export const RENAVE_STATUSES = ['pendente', 'confirmado', 'recusado', 'cancelado'] as const;
export type RenaveStatusValue = (typeof RENAVE_STATUSES)[number];

export const RENAVE_ORIGENS = ['manual', 'integradora'] as const;
export type RenaveOrigemValue = (typeof RENAVE_ORIGENS)[number];

export const OPERACOES_DE_ENTRADA = [
  'entrada_compra', 'entrada_transferencia', 'entrada_consignacao',
] as const satisfies readonly RenaveOperacaoValue[];

export const OPERACOES_DE_SAIDA = [
  'saida_venda', 'saida_transferencia', 'devolucao_consignado',
] as const satisfies readonly RenaveOperacaoValue[];

export function ehEntrada(tipo: RenaveOperacaoValue): boolean {
  return (OPERACOES_DE_ENTRADA as readonly string[]).includes(tipo);
}

export const ROTULO_DA_OPERACAO_RENAVE: Record<RenaveOperacaoValue, string> = {
  entrada_compra: 'Entrada por compra',
  entrada_transferencia: 'Entrada por transferência entre lojas',
  entrada_consignacao: 'Entrada de consignado',
  saida_venda: 'Saída por venda',
  saida_transferencia: 'Saída por transferência entre lojas',
  devolucao_consignado: 'Devolução de consignado',
};

export const ROTULO_DO_STATUS_RENAVE: Record<RenaveStatusValue, string> = {
  pendente: 'Aguardando protocolo',
  confirmado: 'Confirmado',
  recusado: 'Recusado',
  cancelado: 'Cancelado',
};

/**
 * O que o RENAVE pede valor. `valorCompra` e `valorVenda` são obrigatórios no
 * manual; a transferência entre estabelecimentos não tem campo de valor. O de
 * consignado ainda não se sabe — fica com o valor da aquisição, se houver.
 */
export function operacaoTemValor(tipo: RenaveOperacaoValue): boolean {
  return tipo === 'entrada_compra' || tipo === 'entrada_consignacao' || tipo === 'saida_venda';
}

/* ── Máquina de estados ─────────────────────────────────────── */

/**
 * `pendente` é "mandei para a integradora e não tenho o protocolo".
 * `confirmado` só sai para `cancelado` — o cancelamento que o RENAVE prevê —
 * e a linha original fica. O banco repete a regra num trigger.
 */
export const RENAVE_TRANSICOES: Record<RenaveStatusValue, readonly RenaveStatusValue[]> = {
  pendente: ['confirmado', 'recusado', 'cancelado'],
  confirmado: ['cancelado'],
  recusado: [],
  cancelado: [],
};

export function podeTransitarRenave(de: RenaveStatusValue, para: RenaveStatusValue): boolean {
  return RENAVE_TRANSICOES[de].includes(para);
}

/** Pendente ou confirmado: o registro conta. Recusado e cancelado não contam. */
export function registroVivo(r: { status: RenaveStatusValue }): boolean {
  return r.status === 'pendente' || r.status === 'confirmado';
}

/* ── Da aquisição para a operação ───────────────────────────── */

/**
 * A operação de entrada que corresponde a como a loja adquiriu o carro.
 *
 * Troca e leilão são **compra** para o RENAVE: quem vende é quem consta no
 * CRV, e a loja paga por ele. `factory` é zero km, que no RENAVE tem fluxo
 * próprio (entrada pela montadora) e fica fora do registro manual.
 */
export function operacaoRenaveDaAquisicao(
  origem: AcquisitionOriginValue,
): RenaveOperacaoValue | null {
  switch (origem) {
    case 'direct_purchase':
    case 'trade_in':
    case 'auction':
      return 'entrada_compra';
    case 'dealer_transfer':
      return 'entrada_transferencia';
    case 'consignment':
      return 'entrada_consignacao';
    case 'factory':
      return null;
  }
}

/* ── Situação do veículo ────────────────────────────────────── */

export interface RegistroParaRenave {
  id: string;
  tipo: RenaveOperacaoValue;
  status: RenaveStatusValue;
  dealId: string | null;
  chaveNfe: string | null;
  dataOperacao: Date | string;
  createdAt: Date | string;
}

export type SituacaoNoRenave = 'sem_registro' | 'em_estoque' | 'fora_do_estoque';

const instante = (d: Date | string) => new Date(d).getTime();

/** Registros vivos em ordem cronológica: pela data do fato, depois pela digitação. */
function vivosEmOrdem<R extends RegistroParaRenave>(registros: readonly R[]): R[] {
  return registros
    .filter(registroVivo)
    .sort((a, b) =>
      instante(a.dataOperacao) - instante(b.dataOperacao) ||
      instante(a.createdAt) - instante(b.createdAt));
}

/**
 * Onde o carro está para o RENAVE, pelo último registro vivo.
 *
 * O mesmo carro entra e sai mais de uma vez na vida (distrato, recompra), e
 * por isso a pergunta é "qual foi o último movimento", não "existe entrada".
 */
export function situacaoNoRenave(registros: readonly RegistroParaRenave[]): SituacaoNoRenave {
  const ultimo = vivosEmOrdem(registros).at(-1);
  if (!ultimo) return 'sem_registro';
  return ehEntrada(ultimo.tipo) ? 'em_estoque' : 'fora_do_estoque';
}

/* ── Pendências ─────────────────────────────────────────────── */

export const CODIGOS_DE_PENDENCIA_RENAVE = [
  'entrada_sem_registro',
  'entrada_aguardando_protocolo',
  'entrada_sem_nfe',
  'consignado_sem_contrato',
  'saida_sem_registro',
  'saida_aguardando_protocolo',
  'saida_sem_nfe',
  'saida_de_negocio_desfeito',
  'nfe_de_outro_emitente',
] as const;
export type CodigoDePendenciaRenave = (typeof CODIGOS_DE_PENDENCIA_RENAVE)[number];

/**
 * `obrigatoria`: a regra está no manual do RENAVE ou é a própria obrigação de
 * registrar. `aviso`: plausível, mas não confirmado em fonte oficial — ou
 * depende de algo que só a loja sabe. Nenhuma das duas bloqueia nada no
 * AutoConnect: travar a vitrine por um dado que talvez esteja certo na
 * integradora seria punir a loja pela nossa ignorância.
 */
export type GravidadeRenave = 'obrigatoria' | 'aviso';

export interface PendenciaRenave {
  codigo: CodigoDePendenciaRenave;
  gravidade: GravidadeRenave;
  mensagem: string;
  /** O negócio a que a pendência se refere, quando é de saída. */
  dealId?: string;
  /** O registro a completar, quando já existe um. */
  registroId?: string;
  /** Desde quando a obrigação existe (entrada do carro, venda). */
  desde?: string;
}

export interface VeiculoParaRenave {
  status: 'available' | 'reserved' | 'sold' | 'in_maintenance' | 'archived';
  condition: 'new' | 'used' | 'semi_new' | 'demo';
}

export interface EntradaDasPendencias {
  veiculo: VeiculoParaRenave;
  aquisicao: { origin: AcquisitionOriginValue; enteredAt: Date | string } | null;
  negocios: readonly { id: string; status: DealStatusValue; closedAt?: Date | string | null }[];
  registros: readonly RegistroParaRenave[];
  /** CNPJ da loja, para conferir o emitente da NF-e de saída. */
  cnpjDaLoja?: string | null;
}

const NFE_DE_ENTRADA_CONFIRMADA: readonly RenaveOperacaoValue[] = ['entrada_compra', 'entrada_transferencia'];
const NFE_DE_SAIDA_CONFIRMADA: readonly RenaveOperacaoValue[] = ['saida_venda', 'saida_transferencia'];

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : undefined);

/**
 * Tudo o que falta registrar no RENAVE para um veículo.
 *
 * Zero km fica de fora: no RENAVE ele entra pela montadora, por um fluxo que
 * o registro manual não cobre. Arquivado sem venda também: o carro saiu do
 * estoque da loja por um caminho que o sistema não conhece.
 */
export function pendenciasRenave(e: EntradaDasPendencias): PendenciaRenave[] {
  const { veiculo, aquisicao, negocios, registros } = e;
  if (veiculo.condition === 'new') return [];
  if (aquisicao?.origin === 'factory') return [];

  const faturados = negocios.filter((n) =>
    (DEAL_FATURADO_STATUSES as readonly string[]).includes(n.status));
  if (veiculo.status === 'archived' && faturados.length === 0) return [];

  const vivos = vivosEmOrdem(registros);
  const pendencias: PendenciaRenave[] = [];

  /* Entrada */
  const entradas = vivos.filter((r) => ehEntrada(r.tipo));
  if (entradas.length === 0) {
    pendencias.push({
      codigo: 'entrada_sem_registro',
      gravidade: 'obrigatoria',
      mensagem: veiculo.status === 'sold' || faturados.length > 0
        ? 'O carro foi vendido sem entrada registrada no RENAVE — e o RENAVE só aceita a saída de carro em estoque.'
        : 'O carro está no estoque e não tem entrada registrada no RENAVE.',
      desde: iso(aquisicao?.enteredAt),
    });
  }
  for (const r of entradas) {
    if (r.status === 'pendente') {
      pendencias.push({
        codigo: 'entrada_aguardando_protocolo',
        gravidade: 'aviso',
        mensagem: 'Entrada enviada à integradora, aguardando o protocolo.',
        registroId: r.id,
      });
    } else if (!r.chaveNfe) {
      const confirmada = NFE_DE_ENTRADA_CONFIRMADA.includes(r.tipo);
      pendencias.push({
        codigo: 'entrada_sem_nfe',
        gravidade: confirmada ? 'obrigatoria' : 'aviso',
        mensagem: confirmada
          ? 'Falta a chave da NF-e de entrada. O RENAVE só aceita a saída depois dela.'
          : 'Falta a chave da NF-e de entrada do consignado (a regra do módulo de consignação ainda não foi publicada).',
        registroId: r.id,
      });
    }
  }

  if (aquisicao?.origin === 'consignment' && faturados.length === 0 && veiculo.status !== 'sold') {
    pendencias.push({
      codigo: 'consignado_sem_contrato',
      gravidade: 'aviso',
      mensagem:
        'Consignado: a Resolução Contran nº 1.026/2026 passa a exigir contrato eletrônico ' +
        'registrado no RENAVE antes da venda. O AutoConnect ainda não emite esse contrato — confira com a integradora.',
    });
  }

  /* Saída */
  for (const n of faturados) {
    const saida = vivos.find((r) => r.tipo === 'saida_venda' && r.dealId === n.id);
    if (!saida) {
      pendencias.push({
        codigo: 'saida_sem_registro',
        gravidade: 'obrigatoria',
        mensagem: 'Venda faturada sem saída registrada no RENAVE.',
        dealId: n.id,
        desde: iso(n.closedAt),
      });
    }
  }

  for (const r of vivos.filter((x) => !ehEntrada(x.tipo))) {
    if (r.status === 'pendente') {
      pendencias.push({
        codigo: 'saida_aguardando_protocolo',
        gravidade: 'aviso',
        mensagem: 'Saída enviada à integradora, aguardando o protocolo.',
        registroId: r.id,
        dealId: r.dealId ?? undefined,
      });
      continue;
    }

    if (!r.chaveNfe) {
      const confirmada = NFE_DE_SAIDA_CONFIRMADA.includes(r.tipo);
      pendencias.push({
        codigo: 'saida_sem_nfe',
        gravidade: confirmada ? 'obrigatoria' : 'aviso',
        mensagem: confirmada
          ? 'Falta a chave da NF-e de saída. O manual do RENAVE a pede depois da saída.'
          : 'Falta a chave da NF-e da devolução do consignado (regra ainda não publicada).',
        registroId: r.id,
        dealId: r.dealId ?? undefined,
      });
    } else if (r.tipo === 'saida_venda' && e.cnpjDaLoja) {
      // O manual exige emitente igual ao CNPJ do estabelecimento ou da matriz:
      // a raiz (8 primeiras posições) é a mesma nos dois.
      const emitente = lerChaveNfe(r.chaveNfe)?.documentoDoEmitente;
      if (emitente && emitente.slice(0, 8) !== e.cnpjDaLoja.toUpperCase().slice(0, 8)) {
        pendencias.push({
          codigo: 'nfe_de_outro_emitente',
          gravidade: 'aviso',
          mensagem: 'A NF-e de saída informada foi emitida por outro CNPJ. O RENAVE a recusa se não for da loja ou da matriz.',
          registroId: r.id,
          dealId: r.dealId ?? undefined,
        });
      }
    }

    if (r.dealId) {
      const negocio = negocios.find((n) => n.id === r.dealId);
      if (negocio && (DEAL_TERMINAL_STATUSES as readonly string[]).includes(negocio.status)) {
        pendencias.push({
          codigo: 'saida_de_negocio_desfeito',
          gravidade: 'aviso',
          mensagem:
            'A venda foi desfeita, mas a saída continua no RENAVE. Se o Detran ainda não transferiu, ' +
            'peça à integradora o cancelamento da saída e anote aqui.',
          registroId: r.id,
          dealId: r.dealId,
        });
      }
    }
  }

  return pendencias.sort((a, b) =>
    (a.gravidade === b.gravidade ? 0 : a.gravidade === 'obrigatoria' ? -1 : 1));
}

/* ── Camada neutra (R2) ─────────────────────────────────────── */

/**
 * O que um provedor de RENAVE (uma integradora) precisa implementar.
 *
 * O vocabulário é o do domínio, não o da integradora: o adaptador traduz. A
 * resposta pode vir na hora (protocolo no retorno), por webhook ou por
 * consulta — o desenho aceita as três, porque ainda não se sabe o que a
 * integradora escolhida oferece. `interpretarWebhook` confere a autenticidade
 * e **lança** quando ela não confere; o payload da integradora não sai dali.
 */
export interface ProvedorDeRenave {
  readonly nome: string;
  /** Falso quando nenhuma integradora está configurada: a tela esconde o envio. */
  readonly disponivel: boolean;
  /** Homologação: o registro não existe no RENAVE de verdade. */
  readonly sandbox?: boolean;
  registrarEntrada(pedido: PedidoDeEntradaRenave): Promise<RespostaDoRenave>;
  registrarSaida(pedido: PedidoDeSaidaRenave): Promise<RespostaDoRenave>;
  /** O cancelamento de entrada ou de saída que o manual prevê. */
  cancelar(idExterno: string, motivo: string): Promise<RespostaDoRenave>;
  consultar(idExterno: string): Promise<RespostaDoRenave>;
  /**
   * A chave da NF-e da operação — no manual, `POST /api/notas-fiscais` com
   * evento `COMPRA` (entrada) ou `VENDA` (saída), depois do registro. Trocar
   * a chave é chamar de novo.
   */
  informarNotaFiscal(idExterno: string, chaveNfe: string): Promise<void>;
  /** O ATPV-e da operação, quando a integradora o devolve. `null` = ainda não há. */
  baixarAtpv(idExterno: string): Promise<Uint8Array | null>;
  interpretarWebhook(cabecalhos: Record<string, string | string[] | undefined>, corpoCru: Uint8Array): EventoDoRenave;
}

export type TipoDeDocumento = 'CPF' | 'CNPJ';

/**
 * O documento do veículo, como o manual pede. O código de segurança do CRV
 * vai para a integradora e **não é gravado** — decisão de 14/10/2026.
 */
export interface DocumentoDoVeiculo {
  placa: string;
  renavam: string;
  chassi?: string | null;
  tipoCrv: TipoDeCrv;
  numeroCrv?: string | null;
  codigoSegurancaCrv: string;
}

export const TIPOS_DE_CRV = ['AZUL', 'VERDE', 'BRANCO', 'DIGITAL'] as const;
export type TipoDeCrv = (typeof TIPOS_DE_CRV)[number];

interface PedidoBase {
  /**
   * Mesma chave, mesmo pedido: reenviar depois de uma falha de rede não pode
   * virar segundo registro na integradora. Formada por veículo, operação e
   * sequência — o mesmo carro entra e sai mais de uma vez na vida.
   */
  chaveDeIdempotencia: string;
  cnpjDaLoja: string;
  veiculo: DocumentoDoVeiculo;
  dataOperacao: Date;
  /** Em reais, string canônica (`"1234.56"`). Nulo onde o RENAVE não pede. */
  valor: string | null;
}

export interface PedidoDeEntradaRenave extends PedidoBase {
  tipo: (typeof OPERACOES_DE_ENTRADA)[number];
  quilometragem: number;
  medidoEm: Date;
  /** Quem consta no CRV — o vendedor, na compra. */
  proprietario: { tipoDocumento: TipoDeDocumento; documento: string } | null;
}

export interface PedidoDeSaidaRenave extends PedidoBase {
  tipo: (typeof OPERACOES_DE_SAIDA)[number];
  comprador: { tipoDocumento: TipoDeDocumento; documento: string; nome: string; email?: string | null } | null;
}

/** O retorno de uma chamada, já no vocabulário do domínio. */
export interface RespostaDoRenave {
  idExterno: string;
  status: RenaveStatusValue;
  protocolo?: string | null;
  motivo?: string | null;
  ocorridoEm?: Date;
}

export const TIPOS_DE_EVENTO_RENAVE = [
  'confirmado', 'recusado', 'cancelado', 'atpv_disponivel', 'ignorado',
] as const;
export type TipoDeEventoRenave = (typeof TIPOS_DE_EVENTO_RENAVE)[number];

export interface EventoDoRenave {
  idExterno: string;
  /** Id do evento na integradora; sem ele, a chave é o SHA-256 do corpo cru. */
  idEvento?: string | null;
  tipo: TipoDeEventoRenave;
  protocolo?: string | null;
  motivo?: string | null;
  ocorridoEm: Date;
}

/**
 * O status que um evento leva o registro, ou `null` quando não leva a lugar
 * nenhum: evento fora de ordem, repetido, ou que a máquina de estados não
 * aceita (confirmação chegando depois do cancelamento).
 */
export function statusDepoisDoEvento(
  atual: RenaveStatusValue,
  evento: TipoDeEventoRenave,
): RenaveStatusValue | null {
  if (evento !== 'confirmado' && evento !== 'recusado' && evento !== 'cancelado') return null;
  return podeTransitarRenave(atual, evento) ? evento : null;
}

/**
 * Documento de pessoa pelo tamanho: 11 é CPF, 14 é CNPJ (inclusive o
 * alfanumérico). O resto é `null` — quem chama decide se é erro.
 */
export function tipoDoDocumento(doc: string | null | undefined): TipoDeDocumento | null {
  const limpo = (doc ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (/^\d{11}$/.test(limpo)) return 'CPF';
  if (/^[0-9A-Z]{12}\d{2}$/.test(limpo)) return 'CNPJ';
  return null;
}
