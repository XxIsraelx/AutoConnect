import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { BOM, montarCsv } from '../../common/csv';
import { montarZip, type EntradaDoZip } from '../../common/zip/zip';
import {
  DEFINICAO_DAS_OPERACOES, ROTULO_DA_DIRECAO, ROTULO_DO_STATUS_DA_NOTA, resumoDasNotas,
  type NotaMontada, type NotaParaRelatorio, type OperacaoFiscal, type StatusDaNota,
} from '@autoconnect/shared';
import { EmissaoDeNotaService } from './emissao.service';

/**
 * Teto de notas num período. Uma revenda emite dezenas por mês; o teto existe
 * para o pacote não virar um download de minutos que trava a API. Passou? A
 * tela pede um período menor, em vez de cortar em silêncio — nota que falta no
 * pacote do contador é nota que ele não escritura.
 */
export const TETO_DE_NOTAS_DO_PERIODO = 1000;

/**
 * O dia é o de Brasília (UTC−3, sem horário de verão desde 2019): uma nota
 * autorizada às 22h de 31/10 é de outubro para a loja e para o contador, mesmo
 * sendo 1º/11 em UTC. O fim é **exclusivo** — o dia seguinte à meia-noite —,
 * senão o último dia do período ficava de fora inteiro.
 */
export function periodoEmBrasilia(from: string, to: string): { de: Date; ateExclusivo: Date; rotulo: string } {
  const dia = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00-03:00`);
  const ateExclusivo = dia(to);
  ateExclusivo.setUTCDate(ateExclusivo.getUTCDate() + 1);
  return { de: dia(from), ateExclusivo, rotulo: `${from.slice(0, 10)} a ${to.slice(0, 10)}` };
}

type Periodo = ReturnType<typeof periodoEmBrasilia>;

/** Quantos XMLs buscamos ao mesmo tempo (bucket ou emissor). */
const BUSCAS_EM_PARALELO = 5;

type LinhaDaNota = Prisma.FiscalDocumentGetPayload<{
  include: { vehicleAcquisition: { select: { vehicleId: true } } };
}>;

/**
 * A ponte com o contador — fase N4 do plano fiscal.
 *
 * O relatório do período (o que saiu, o que entrou, o que está pendente) e o
 * pacote do mês: os XMLs das notas, com um índice em CSV. É a contrapartida
 * fiscal do CSV do financeiro, que fica em *Levar seus dados*.
 *
 * **O período é o da emissão**: a data de autorização, ou a de criação da nota
 * que nunca foi autorizada. Uma nota autorizada em 31/10 e cancelada em 01/11
 * é de outubro — é lá que o contador a escritura, e o cancelamento vem junto.
 */
@Injectable()
export class RelatorioFiscalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emissao: EmissaoDeNotaService,
  ) {}

  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new ForbiddenException('Selecione uma concessionária para ver as notas fiscais dela.');
    }
    return escopo.tenantId;
  }

  private async notasDoPeriodo(tenantId: string, { de, ateExclusivo }: Periodo) {
    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const notas: LinhaDaNota[] = await tx.fiscalDocument.findMany({
        where: {
          tenantId,
          OR: [
            { autorizadaEm: { gte: de, lt: ateExclusivo } },
            { autorizadaEm: null, createdAt: { gte: de, lt: ateExclusivo } },
          ],
        },
        include: { vehicleAcquisition: { select: { vehicleId: true } } },
        orderBy: { createdAt: 'asc' },
        take: TETO_DE_NOTAS_DO_PERIODO + 1,
      });
      if (notas.length > TETO_DE_NOTAS_DO_PERIODO) {
        throw new UnprocessableEntityException(
          `O período tem mais de ${TETO_DE_NOTAS_DO_PERIODO} notas. Escolha um período menor — por mês, por exemplo.`,
        );
      }

      // A substituta de uma rejeição pode ter saído fora do período: para dizer
      // se a rejeição ainda está pendente, olhamos todas as notas das mesmas
      // origens — só as das origens rejeitadas, que são poucas.
      const origensRejeitadas = notas.filter((n) => n.status === 'rejeitada' || n.status === 'denegada');
      const dasOrigens = origensRejeitadas.length === 0 ? [] : await tx.fiscalDocument.findMany({
        where: {
          tenantId,
          OR: [
            { dealId: { in: origensRejeitadas.flatMap((n) => (n.dealId ? [n.dealId] : [])) } },
            {
              vehicleAcquisitionId: {
                in: origensRejeitadas.flatMap((n) => (n.vehicleAcquisitionId ? [n.vehicleAcquisitionId] : [])),
              },
            },
          ],
        },
        include: { vehicleAcquisition: { select: { vehicleId: true } } },
      });
      return { notas, dasOrigens };
    });
  }

  private paraRegra(n: LinhaDaNota): NotaParaRelatorio {
    return {
      id: n.id,
      status: n.status,
      operacao: n.operation,
      origemId: n.dealId ?? n.vehicleAcquisitionId!,
      valorTotal: (n.snapshot as unknown as NotaMontada).valorTotal,
      emitidaEm: (n.autorizadaEm ?? n.createdAt).toISOString(),
    };
  }

  async relatorio(escopo: Escopo, periodo: Periodo) {
    const tenantId = this.tenantDe(escopo);
    const { notas, dasOrigens } = await this.notasDoPeriodo(tenantId, periodo);
    const resumo = resumoDasNotas(notas.map((n) => this.paraRegra(n)), [...notas, ...dasOrigens].map((n) => this.paraRegra(n)));
    const pendentes = new Set(resumo.pendentes);

    return {
      periodo: { de: periodo.de.toISOString(), ateExclusivo: periodo.ateExclusivo.toISOString() },
      resumo,
      notas: notas.map((n) => {
        const snapshot = n.snapshot as unknown as NotaMontada;
        return {
          id: n.id,
          status: n.status,
          operacao: n.operation,
          rotulo: DEFINICAO_DAS_OPERACOES[n.operation].rotulo,
          direcao: DEFINICAO_DAS_OPERACOES[n.operation].direcao,
          numero: n.numero,
          serie: n.serie,
          chave: n.chave,
          cfop: snapshot.cfop,
          valorTotal: snapshot.valorTotal,
          contraparte: snapshot.contraparte.nome,
          emitidaEm: (n.autorizadaEm ?? n.createdAt).toISOString(),
          motivo: n.motivo,
          pendente: pendentes.has(n.id),
          // Para a tela levar ao lugar da nota: o negócio ou o veículo.
          origem: n.dealId
            ? { tipo: 'negocio' as const, id: n.dealId }
            : { tipo: 'veiculo' as const, id: n.vehicleAcquisition!.vehicleId },
        };
      }),
    };
  }

  private linhaDoIndice(n: LinhaDaNota, observacao = ''): unknown[] {
    const snapshot = n.snapshot as unknown as NotaMontada;
    const def = DEFINICAO_DAS_OPERACOES[n.operation as OperacaoFiscal];
    return [
      (n.autorizadaEm ?? n.createdAt).toISOString().slice(0, 10),
      ROTULO_DA_DIRECAO[def.direcao],
      def.rotulo,
      ROTULO_DO_STATUS_DA_NOTA[n.status as StatusDaNota],
      n.numero ?? '',
      n.serie ?? '',
      n.chave ?? '',
      n.protocolo ?? '',
      snapshot.cfop,
      snapshot.valorTotal,
      snapshot.contraparte.nome,
      snapshot.contraparte.documento,
      n.ambiente === 'producao' ? 'produção' : 'homologação (sem valor fiscal)',
      n.canceladaEm?.toISOString().slice(0, 10) ?? '',
      n.justificativaDoCancelamento ?? '',
      n.motivo ?? '',
      observacao,
    ];
  }

  private static readonly CABECALHO = [
    'Data', 'Tipo', 'Operação', 'Situação', 'Número', 'Série', 'Chave de acesso', 'Protocolo',
    'CFOP', 'Valor', 'Destinatário ou remetente', 'CPF/CNPJ', 'Ambiente', 'Cancelada em',
    'Justificativa do cancelamento', 'Motivo (rejeição/denegação)', 'Observação',
  ];

  async csv(escopo: Escopo, periodo: Periodo): Promise<string> {
    const tenantId = this.tenantDe(escopo);
    const { notas } = await this.notasDoPeriodo(tenantId, periodo);
    return BOM + montarCsv(RelatorioFiscalService.CABECALHO, notas.map((n) => this.linhaDoIndice(n)));
  }

  /**
   * O pacote do mês: `notas.csv` (todas as notas do período), o XML de cada
   * autorizada e cancelada em `xml/saida/` e `xml/entrada/`, e um `LEIA-ME.txt`
   * que diz o que ficou de fora e por quê. Nomes só em ASCII: há leitor de ZIP
   * que ainda mostra acento como lixo.
   */
  async pacote(escopo: Escopo, periodo: Periodo): Promise<Buffer> {
    const tenantId = this.tenantDe(escopo);
    const { notas } = await this.notasDoPeriodo(tenantId, periodo);

    const comXml = notas.filter((n) => n.status === 'autorizada' || n.status === 'cancelada');
    const xmls = new Map<string, { xml: Buffer } | { falha: string }>();
    for (let i = 0; i < comXml.length; i += BUSCAS_EM_PARALELO) {
      const lote = comXml.slice(i, i + BUSCAS_EM_PARALELO);
      const resultados = await Promise.all(lote.map((n) => this.emissao.xmlParaPacote(n)));
      lote.forEach((n, j) => xmls.set(n.id, resultados[j]!));
    }

    const entradas: EntradaDoZip[] = [];
    const faltas: string[] = [];
    const indice: unknown[][] = [];
    for (const n of notas) {
      const r = xmls.get(n.id);
      if (r && 'xml' in r) {
        const pasta = DEFINICAO_DAS_OPERACOES[n.operation].direcao === 'entrada' ? 'entrada' : 'saida';
        entradas.push({ nome: `xml/${pasta}/${n.chave}-nfe.xml`, conteudo: r.xml });
        indice.push(this.linhaDoIndice(n));
      } else if (r && 'falha' in r) {
        faltas.push(`- Nota ${n.numero ?? '?'} (chave ${n.chave}): ${r.falha}`);
        indice.push(this.linhaDoIndice(n, 'XML fora do pacote — ver LEIA-ME'));
      } else {
        indice.push(this.linhaDoIndice(n, 'sem XML: a nota não foi autorizada'));
      }
    }

    const leiaMe = [
      `Notas fiscais (NF-e) da loja — ${periodo.rotulo}`,
      '',
      'notas.csv     todas as notas do período, inclusive rejeitadas e canceladas',
      'xml/saida/    XML das notas de venda autorizadas ou canceladas',
      'xml/entrada/  XML das notas de entrada (compra de particular, troca, consignação)',
      '',
      'O período é o da autorização: nota autorizada no mês e cancelada depois está aqui,',
      'com a data e a justificativa do cancelamento no notas.csv.',
      'Notas em homologação aparecem marcadas no notas.csv e não têm valor fiscal.',
      '',
      faltas.length === 0
        ? 'Todas as notas autorizadas e canceladas do período estão com o XML no pacote.'
        : `ATENÇÃO — ${faltas.length} nota(s) sem XML no pacote:\n${faltas.join('\n')}\n` +
          'Gere o pacote de novo mais tarde; se continuar, fale com o suporte.',
      '',
    ].join('\n');

    return montarZip([
      { nome: 'LEIA-ME.txt', conteudo: Buffer.from(leiaMe, 'utf8') },
      { nome: 'notas.csv', conteudo: Buffer.from(BOM + montarCsv(RelatorioFiscalService.CABECALHO, indice), 'utf8') },
      ...entradas,
    ]);
  }
}
