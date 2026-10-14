/**
 * A mesma história — Fase C do plano fiscal (`docs/planos/plano-fiscal-renave-nfe.md`).
 *
 * Estoque, nota fiscal e RENAVE são três registros do mesmo fato: este carro
 * entrou (ou saiu) por este valor, nesta data. Feitos em lugares diferentes,
 * cada um conta a sua versão. Esta regra cruza os três, operação por operação,
 * e diz onde discordam.
 *
 * **Divergência é lista, não bloqueio.** O negócio já está faturado e o carro
 * já saiu; travar alguma coisa agora não desfaz nada. O que ajuda é a loja ver,
 * antes do contador e antes da fiscalização, que a nota diz R$ 82.500 e o
 * RENAVE diz R$ 85.200.
 *
 * O que **não** está aqui: "negócio faturado sem saída no RENAVE" e "veículo
 * no estoque sem entrada" já são pendências da trilha do RENAVE
 * (`pendenciasRenave`). A conferência só olha operações que já têm algum
 * registro para cruzar — e repete o "sem registro" só para a linha não ficar
 * pela metade.
 */
import { registroVivo, type RenaveOperacaoValue, type RenaveStatusValue } from './renave';
import type { StatusDaNota } from './emissao-nfe';
import { saoIguais } from './dinheiro';

export interface NotaParaConferencia {
  id: string;
  status: StatusDaNota;
  chave: string | null;
  valorTotal: string;
  /** ISO. */
  autorizadaEm: string | null;
  /** ISO — para escolher a mais recente quando nenhuma foi autorizada. */
  criadaEm: string;
}

export interface RenaveParaConferencia {
  id: string;
  tipo: RenaveOperacaoValue;
  status: RenaveStatusValue;
  chaveNfe: string | null;
  valor: string | null;
  /** ISO — a data do fato, não a do registro. */
  dataOperacao: string;
}

export interface OperacaoParaConferir {
  tipo: 'saida' | 'entrada';
  /** O negócio (saída) ou a aquisição (entrada). */
  origemId: string;
  vehicleId: string;
  veiculo: string;
  /** ISO — fechamento do negócio ou entrada no estoque. */
  data: string;
  /** Valor de venda ou de compra, em decimal (`"82500.00"`). */
  valor: string;
  /**
   * A loja emite a nota desta operação? Na saída, sempre; na entrada, só quando
   * do outro lado não há quem emita (`entradaDaAquisicao`). Quando é o outro
   * lado, não há nota nossa para conferir — e não é divergência.
   */
  notaPropriaEsperada: boolean;
  notas: readonly NotaParaConferencia[];
  /** Registros do RENAVE deste veículo, já filtrados pelo lado (entrada/saída). */
  renave: readonly RenaveParaConferencia[];
}

export const CODIGOS_DE_DIVERGENCIA = [
  'sem_nota',
  'nota_nao_autorizada',
  'sem_renave',
  'renave_nao_confirmado',
  'valor_da_nota',
  'valor_no_renave',
  'chave_ausente_no_renave',
  'chave_diferente',
  'data_no_renave',
] as const;
export type CodigoDeDivergencia = (typeof CODIGOS_DE_DIVERGENCIA)[number];

export interface Divergencia {
  codigo: CodigoDeDivergencia;
  /** `divergencia` = os registros discordam; `aviso` = falta um passo. */
  gravidade: 'divergencia' | 'aviso';
  mensagem: string;
  /** O valor certo, quando a regra sabe qual é (a chave da nota autorizada). */
  sugestao?: string;
}

export interface OperacaoConferida {
  nota: NotaParaConferencia | null;
  renave: RenaveParaConferencia | null;
  divergencias: Divergencia[];
}

/** O dia de Brasília (UTC−3, sem horário de verão), como `AAAA-MM-DD`. */
function diaEmBrasilia(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

const formatar = (v: string) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A nota que conta: a autorizada; sem ela, a mais recente — para dizer por que não há. */
function notaQueConta(notas: readonly NotaParaConferencia[]): NotaParaConferencia | null {
  return notas.find((n) => n.status === 'autorizada')
    ?? [...notas].sort((a, b) => b.criadaEm.localeCompare(a.criadaEm))[0]
    ?? null;
}

/** O registro que conta: o vivo mais recente; sem vivo, o mais recente. */
function renaveQueConta(registros: readonly RenaveParaConferencia[]): RenaveParaConferencia | null {
  const porData = [...registros].sort((a, b) => b.dataOperacao.localeCompare(a.dataOperacao));
  return porData.find((r) => registroVivo(r)) ?? porData[0] ?? null;
}

export function conferirOperacao(op: OperacaoParaConferir): OperacaoConferida {
  const divergencias: Divergencia[] = [];
  const lado = op.tipo === 'saida' ? 'saída' : 'entrada';
  const nota = op.notaPropriaEsperada ? notaQueConta(op.notas) : null;
  const renave = renaveQueConta(op.renave);
  const notaAutorizada = nota?.status === 'autorizada' ? nota : null;
  const renaveVivo = renave && registroVivo(renave) ? renave : null;

  // ── A nota ────────────────────────────────────────────────
  if (op.notaPropriaEsperada) {
    if (!nota) {
      divergencias.push({ codigo: 'sem_nota', gravidade: 'aviso', mensagem: `Sem nota fiscal de ${lado}.` });
    } else if (!notaAutorizada) {
      divergencias.push({
        codigo: 'nota_nao_autorizada', gravidade: 'aviso',
        mensagem: `A nota de ${lado} mais recente está ${nota.status} — nenhuma autorizada.`,
      });
    } else if (!saoIguais(notaAutorizada.valorTotal, op.valor)) {
      divergencias.push({
        codigo: 'valor_da_nota', gravidade: 'divergencia',
        mensagem: `A nota diz ${formatar(notaAutorizada.valorTotal)}; o ${op.tipo === 'saida' ? 'negócio' : 'custo de compra'} diz ${formatar(op.valor)}.`,
      });
    }
  }

  // ── O RENAVE ──────────────────────────────────────────────
  if (!renave || !renaveVivo) {
    divergencias.push({
      codigo: 'sem_renave', gravidade: 'aviso',
      mensagem: renave
        ? `O registro de ${lado} no RENAVE está ${renave.status} — nenhum vivo.`
        : `Sem registro de ${lado} no RENAVE.`,
    });
  } else {
    if (renaveVivo.status === 'pendente') {
      divergencias.push({
        codigo: 'renave_nao_confirmado', gravidade: 'aviso',
        mensagem: `O registro de ${lado} no RENAVE ainda não foi confirmado.`,
      });
    }
    if (renaveVivo.valor !== null && !saoIguais(renaveVivo.valor, op.valor)) {
      divergencias.push({
        codigo: 'valor_no_renave', gravidade: 'divergencia',
        mensagem: `O RENAVE diz ${formatar(renaveVivo.valor)}; o ${op.tipo === 'saida' ? 'negócio' : 'custo de compra'} diz ${formatar(op.valor)}.`,
      });
    }
    if (diaEmBrasilia(renaveVivo.dataOperacao) !== diaEmBrasilia(op.data)) {
      // Aviso, não divergência: o negócio pode fechar no sistema um dia depois
      // da venda. Mas a data do RENAVE é a da transferência de responsabilidade,
      // e diferença grande merece um olhar.
      divergencias.push({
        codigo: 'data_no_renave', gravidade: 'aviso',
        mensagem: `O RENAVE registra ${diaEmBrasilia(renaveVivo.dataOperacao).split('-').reverse().join('/')}; ` +
          `o ${op.tipo === 'saida' ? 'negócio fechou' : 'carro entrou'} em ${diaEmBrasilia(op.data).split('-').reverse().join('/')}.`,
      });
    }
    // A chave só se cruza quando as duas pontas existem.
    if (notaAutorizada?.chave) {
      if (!renaveVivo.chaveNfe) {
        divergencias.push({
          codigo: 'chave_ausente_no_renave', gravidade: 'aviso',
          mensagem: `A nota de ${lado} está autorizada, mas a chave dela não foi informada no RENAVE.`,
          sugestao: notaAutorizada.chave,
        });
      } else if (renaveVivo.chaveNfe !== notaAutorizada.chave) {
        divergencias.push({
          codigo: 'chave_diferente', gravidade: 'divergencia',
          mensagem: `A chave informada no RENAVE não é a da nota autorizada.`,
          sugestao: notaAutorizada.chave,
        });
      }
    }
  }

  return { nota, renave, divergencias };
}
