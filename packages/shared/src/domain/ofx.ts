/**
 * Conciliação bancária: ler o extrato e casar com os lançamentos.
 *
 * As duas regras deste arquivo são puras e moram aqui pelo mesmo motivo do resto
 * do financeiro — **é dinheiro, e é aqui que o erro é barato de pegar**. Um
 * parser que engole um campo ou um casamento que aceita o par errado só aparece
 * no extrato do lojista, semanas depois, se não houver teste.
 *
 * Por que OFX, e não Open Finance: todo banco brasileiro exporta OFX hoje, sem
 * certificado, sem homologação e sem contrato. Open Finance resolve 100% com
 * dez vezes o custo — entra quando houver cliente pedindo.
 */

import { emCentavos, deCentavos } from './dinheiro';

export interface TransacaoDoExtrato {
  /** Id da transação no banco. É por ele que a reimportação não duplica. */
  fitid: string;
  /** Data do lançamento no banco, meia-noite UTC. */
  data: Date;
  /** Sempre positivo; o sinal está em `direction`, como no lançamento. */
  valor: string;
  direction: 'entrada' | 'saida';
  descricao: string;
}

/** O que o arquivo trouxe, mais o que ele não trouxe. */
export interface ExtratoLido {
  transacoes: TransacaoDoExtrato[];
  /** Linhas que o parser não conseguiu ler — contadas, nunca escondidas. */
  ignoradas: number;
}

const BLOCO = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;

/** OFX é SGML: a tag pode não ter fechamento, e o valor vai até a quebra. */
function campo(bloco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}>\\s*([^<\\r\\n]*)`, 'i').exec(bloco);
  return m ? m[1]!.trim() : null;
}

/**
 * `20260928` ou `20260928120000[-3:BRT]` → meia-noite UTC do dia.
 *
 * A hora e o fuso do arquivo são descartados de propósito: o extrato diz o
 * **dia** em que o dinheiro se moveu, e guardar 03:00 de um fuso faria a
 * conciliação errar por um dia em metade dos casos.
 */
export function dataDoOfx(bruto: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(bruto.trim());
  if (!m) return null;
  const [, ano, mes, dia] = m;
  const d = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Lê o extrato.
 *
 * Não valida o arquivo inteiro nem exige cabeçalho: bancos brasileiros emitem
 * OFX com variações que nenhuma especificação prevê, e recusar o arquivo por
 * causa do cabeçalho seria recusar o extrato do cliente. O que não der para ler
 * é **contado** em `ignoradas` — silêncio aqui é transação sumida.
 */
export function lerOfx(conteudo: string): ExtratoLido {
  const transacoes: TransacaoDoExtrato[] = [];
  let ignoradas = 0;

  for (const [, bloco] of conteudo.matchAll(BLOCO)) {
    const fitid = campo(bloco, 'FITID');
    const bruto = campo(bloco, 'TRNAMT');
    const data = dataDoOfx(campo(bloco, 'DTPOSTED') ?? '');

    if (!fitid || !bruto || !data) { ignoradas += 1; continue; }

    // Vírgula decimal acontece em emissor brasileiro, apesar da especificação —
    // e quando ela aparece, o ponto é separador de milhar. É a mesma regra que a
    // tela usa para ler o que a pessoa digita.
    const limpo = bruto.replace(/\s/g, '');
    const normalizado = limpo.includes(',')
      ? limpo.replace(/\./g, '').replace(',', '.')
      : limpo;
    let centavos: bigint;
    try {
      centavos = emCentavos(normalizado);
    } catch {
      ignoradas += 1;
      continue;
    }
    if (centavos === 0n) { ignoradas += 1; continue; }

    transacoes.push({
      fitid,
      data,
      valor: deCentavos(centavos < 0n ? -centavos : centavos),
      direction: centavos < 0n ? 'saida' : 'entrada',
      descricao: (campo(bloco, 'MEMO') ?? campo(bloco, 'NAME') ?? '').slice(0, 200),
    });
  }

  return { transacoes, ignoradas };
}

/* ── Casamento ──────────────────────────────────────────────── */

export interface CandidatoParaConciliar {
  id: string;
  direction: 'entrada' | 'saida';
  valor: string;
  /** Vencimento do lançamento previsto, ou a data da baixa se já pago. */
  data: Date;
}

export interface Sugestao {
  fitid: string;
  lancamentoId: string;
  /** Diferença de dias entre o extrato e o lançamento — quanto menor, melhor. */
  distanciaEmDias: number;
  /** `alta` quando o valor bate e a data cai no mesmo dia. */
  confianca: 'alta' | 'media';
}

/** Dias de tolerância: boleto compensa em até 3 dias úteis. */
export const JANELA_DE_CONCILIACAO_DIAS = 5;

/**
 * Sugere o par extrato × lançamento.
 *
 * **Valor igual é condição, não preferência.** Conciliar por aproximação de
 * valor seria inventar que R$ 1.199,90 é R$ 1.200,00 — e uma vez aceito, o
 * lojista para de conferir.
 *
 * Empate de valor na mesma janela resolve pela data mais próxima, e cada
 * lançamento é sugerido **uma vez só**: duas sugestões para o mesmo lançamento
 * fariam o mesmo dinheiro ser baixado duas vezes se alguém aceitasse as duas.
 */
export function sugerirConciliacao(
  transacoes: readonly TransacaoDoExtrato[],
  candidatos: readonly CandidatoParaConciliar[],
  janelaEmDias = JANELA_DE_CONCILIACAO_DIAS,
): Sugestao[] {
  const usados = new Set<string>();
  const sugestoes: Sugestao[] = [];

  // O extrato manda: a ordem é a dele, e a primeira transação escolhe primeiro.
  for (const t of transacoes) {
    const possiveis = candidatos
      .filter((c) => !usados.has(c.id))
      .filter((c) => c.direction === t.direction)
      .filter((c) => emCentavos(c.valor) === emCentavos(t.valor))
      .map((c) => ({ c, dias: distanciaEmDias(c.data, t.data) }))
      .filter((x) => x.dias <= janelaEmDias)
      .sort((a, b) => a.dias - b.dias);

    const melhor = possiveis[0];
    if (!melhor) continue;

    usados.add(melhor.c.id);
    sugestoes.push({
      fitid: t.fitid,
      lancamentoId: melhor.c.id,
      distanciaEmDias: melhor.dias,
      confianca: melhor.dias === 0 ? 'alta' : 'media',
    });
  }

  return sugestoes;
}

function distanciaEmDias(a: Date, b: Date): number {
  const dia = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.abs(Math.round((dia(a) - dia(b)) / 86_400_000));
}
