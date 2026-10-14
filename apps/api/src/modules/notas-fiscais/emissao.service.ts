import {
  ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
  ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { DocumentosStorage } from '../../common/armazenamento/documentos.storage';
import { ehGlobal, type Escopo } from '../../common/escopo';
import {
  aplicarRetorno, podeCancelar,
  type CabecalhosDoEmissor, type NotaMontada, type ProvedorDeNotaFiscal,
  type RetornoDoEmissor, type StatusDaNota,
} from '@autoconnect/shared';
import { PerfilFiscalService } from './perfil-fiscal.service';
import { PROVEDOR_DE_NOTA_FISCAL } from './emissor/provedor';
import { ProvedorDeNotaSimulado, type AcaoSimuladaDaNota } from './emissor/provedor-simulado';

interface QuemPede { id: string }

/** De onde veio o retorno — fica no evento, para a trilha. */
type OrigemDoRetorno = 'emissao' | 'consulta' | 'cancelamento' | 'webhook';

/**
 * A nota sai a partir da assinatura do contrato. Antes disso o preço ainda
 * muda; depois de cancelado ou distratado, não há venda para faturar.
 */
const STATUS_DO_NEGOCIO_QUE_EMITE = ['signed', 'invoiced', 'documentation', 'delivered'];

/** Texto do cancelamento que chega sem ter passado por nós (painel do emissor). */
const CANCELADA_FORA = 'Cancelada fora do AutoConnect, pelo painel do emissor.';

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

const ehDuplicidade = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Emissão da NF-e de saída do negócio — fase N2 do plano fiscal.
 *
 * Três regras, nesta ordem de importância:
 *
 *  1. **O banco grava antes de o emissor ouvir.** A nota nasce `processando`
 *     numa transação, e só então o emissor é chamado, com o id dela como
 *     referência. Se a chamada cair no meio, a linha existe e a consulta
 *     resolve — o contrário (emissor autorizou, banco não sabe) seria uma
 *     nota autorizada que nenhuma tela mostra.
 *  2. **Todo retorno passa por `aplicarRetorno`** (shared), venha da resposta
 *     da emissão, da consulta, do cancelamento ou do webhook — e cada um vira
 *     linha em `fiscal_document_events`, idempotente por `(provider, eventKey)`.
 *  3. **Rede fora da transação.** A API está a ~0,6 s do banco; uma transação
 *     aberta esperando o emissor seguraria conexão e lock à toa.
 */
@Injectable()
export class EmissaoDeNotaService {
  private readonly logger = new Logger(EmissaoDeNotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly perfil: PerfilFiscalService,
    private readonly storage: DocumentosStorage,
    private readonly config: ConfigService,
    @Inject(PROVEDOR_DE_NOTA_FISCAL)
    private readonly provedor: ProvedorDeNotaFiscal,
  ) {}

  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new ForbiddenException('Selecione uma concessionária para operar as notas fiscais dela.');
    }
    return escopo.tenantId;
  }

  private exigirEmissor(): void {
    if (!this.provedor.disponivel) {
      throw new ServiceUnavailableException(
        'Nenhum emissor de NF-e está configurado nesta instalação. ' +
          'Use os dados da prévia no emissor que a loja já usa.',
      );
    }
  }

  get simulado(): boolean {
    return this.provedor instanceof ProvedorDeNotaSimulado &&
      this.config.get<string>('NODE_ENV') !== 'production';
  }

  capacidade() {
    return {
      disponivel: this.provedor.disponivel,
      provedor: this.provedor.disponivel ? this.provedor.nome : null,
      homologacao: this.provedor.disponivel && this.provedor.homologacao,
      simulado: this.simulado,
    };
  }

  /* ── Leitura ─────────────────────────────────────────────── */

  private publica(d: {
    id: string; status: StatusDaNota; operation: string; ambiente: string; serie: number | null;
    numero: number | null; chave: string | null; protocolo: string | null; motivo: string | null;
    snapshot: Prisma.JsonValue; autorizadaEm: Date | null; canceladaEm: Date | null;
    justificativaDoCancelamento: string | null; createdAt: Date;
  }) {
    const snapshot = d.snapshot as unknown as NotaMontada;
    const cancelavel = podeCancelar(
      { status: d.status, autorizadaEm: d.autorizadaEm?.toISOString() ?? null },
      new Date(),
    );
    return {
      id: d.id,
      status: d.status,
      operacao: d.operation,
      ambiente: d.ambiente,
      serie: d.serie,
      numero: d.numero,
      chave: d.chave,
      protocolo: d.protocolo,
      motivo: d.motivo,
      cfop: snapshot.cfop,
      valorTotal: snapshot.valorTotal,
      destinatario: snapshot.contraparte.nome,
      autorizadaEm: d.autorizadaEm?.toISOString() ?? null,
      canceladaEm: d.canceladaEm?.toISOString() ?? null,
      justificativaDoCancelamento: d.justificativaDoCancelamento,
      emitidaEm: d.createdAt.toISOString(),
      cancelamento: cancelavel.pode ? { pode: true as const } : { pode: false as const, motivo: cancelavel.motivo },
    };
  }

  async listarDoNegocio(escopo: Escopo, dealId: string) {
    const tenantId = this.tenantDe(escopo);
    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const negocio = await tx.deal.findFirst({ where: { id: dealId, tenantId }, select: { id: true } });
      if (!negocio) throw new NotFoundException('Negócio não encontrado.');
      const notas = await tx.fiscalDocument.findMany({
        where: { tenantId, dealId }, orderBy: { createdAt: 'desc' },
      });
      return notas.map((n) => this.publica(n));
    });
  }

  private async umaNota(tenantId: string, notaId: string) {
    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const nota = await tx.fiscalDocument.findFirst({ where: { id: notaId, tenantId } });
      if (!nota) throw new NotFoundException('Nota fiscal não encontrada.');
      return nota;
    });
  }

  /* ── Emissão ─────────────────────────────────────────────── */

  async emitir(escopo: Escopo, quem: QuemPede, dealId: string, presencial: boolean) {
    const tenantId = this.tenantDe(escopo);
    this.exigirEmissor();

    const nota = await this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const montada = await this.perfil.montarDoNegocio(tx, tenantId, dealId, presencial);
      if (!STATUS_DO_NEGOCIO_QUE_EMITE.includes(montada.statusDoNegocio)) {
        throw new ConflictException(
          'A nota sai a partir da assinatura do contrato — e não sai de negócio cancelado ou distratado.',
        );
      }
      if (!montada.nota) {
        throw new UnprocessableEntityException({
          message: 'Faltam dados para emitir a nota.',
          faltas: montada.faltas,
        });
      }
      if (montada.nota.ambiente === 'producao' && this.provedor.homologacao) {
        throw new ConflictException(
          'O perfil fiscal está em produção, mas o emissor desta instalação é de homologação: ' +
            'a nota sairia sem valor fiscal. Volte o perfil para homologação ou fale com o suporte.',
        );
      }

      try {
        const criada = await tx.fiscalDocument.create({
          data: {
            tenantId,
            dealId,
            operation: montada.operacao,
            provider: this.provedor.nome,
            ambiente: montada.nota.ambiente,
            serie: montada.nota.serie,
            snapshot: montada.nota as unknown as Prisma.InputJsonValue,
            emittedBy: quem.id,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId, actorUserId: quem.id, action: 'nota_fiscal_emitida',
            entityType: 'fiscal_document', entityId: criada.id,
            diff: { dealId, operacao: montada.operacao, cfop: montada.nota.cfop, valor: montada.nota.valorTotal },
          },
        });
        return criada;
      } catch (e) {
        if (ehDuplicidade(e)) {
          throw new ConflictException('Este negócio já tem uma nota em processamento ou autorizada.');
        }
        throw e;
      }
    });

    try {
      const retorno = await this.provedor.emitir({
        referencia: nota.id,
        nota: nota.snapshot as unknown as NotaMontada,
      });
      await this.aplicar(tenantId, nota.id, retorno, 'emissao', JSON.stringify(retorno));
    } catch (e) {
      // A nota existe e está `processando`: a consulta resolve. Repetir a
      // emissão aqui poderia mandar a mesma nota duas vezes à SEFAZ.
      this.logger.warn(`Emissor não respondeu à nota ${nota.id}: ${(e as Error).message}`);
    }

    return this.publica(await this.umaNota(tenantId, nota.id));
  }

  /* ── Retorno ─────────────────────────────────────────────── */

  /**
   * Aplica um retorno do emissor. Idempotente por `(provider, eventKey)`: a
   * reentrega do mesmo webhook encontra o evento gravado e não faz nada.
   */
  private async aplicar(
    tenantId: string,
    notaId: string,
    retorno: RetornoDoEmissor,
    origem: OrigemDoRetorno,
    corpo: string,
    eventKey = `${origem}:${sha256(corpo)}`,
  ): Promise<{ aplicado: boolean; status: StatusDaNota; motivo?: string }> {
    const transacao = () => this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const atual = await tx.fiscalDocument.findFirst({ where: { id: notaId, tenantId } });
      if (!atual) throw new NotFoundException('Nota fiscal não encontrada.');

      // Consulta antes do INSERT: a violação de unicidade abortaria a
      // transação inteira. A corrida entre duas entregas simultâneas ainda
      // bate no índice, e é tratada fora daqui.
      const jaVisto = await tx.fiscalDocumentEvent.findUnique({
        where: { provider_eventKey: { provider: atual.provider, eventKey } },
        select: { id: true },
      });
      if (jaVisto) return { aplicado: false, status: atual.status, motivo: 'reentrega' };

      const r = aplicarRetorno({ status: atual.status, chave: atual.chave }, retorno);
      await tx.fiscalDocumentEvent.create({
        data: {
          tenantId, documentId: notaId, provider: atual.provider, eventKey, origem,
          situacao: retorno.situacao, corpo, aviso: r.aviso ?? null,
        },
      });

      if (r.aviso) this.logger.warn(`Nota ${notaId}: ${r.aviso}`);

      if (retorno.situacao === 'cancelamento_rejeitado') {
        await tx.fiscalDocument.update({
          where: { id: notaId },
          data: { motivo: `Cancelamento recusado: ${retorno.motivo ?? 'sem motivo informado'}` },
        });
      }
      if (!r.mudou) return { aplicado: false, status: atual.status, motivo: r.aviso };

      const quando = new Date(retorno.ocorridoEm);
      const data: Prisma.FiscalDocumentUpdateInput =
        r.status === 'autorizada'
          ? {
            status: 'autorizada', chave: retorno.chave!, protocolo: retorno.protocolo!,
            numero: retorno.numero ?? null, serie: retorno.serie ?? atual.serie,
            autorizadaEm: Number.isNaN(quando.getTime()) ? new Date() : quando, motivo: null,
          }
          : r.status === 'cancelada'
            ? {
              status: 'cancelada', canceladaEm: Number.isNaN(quando.getTime()) ? new Date() : quando,
              justificativaDoCancelamento: atual.justificativaDoCancelamento ?? CANCELADA_FORA,
            }
            : { status: r.status, motivo: retorno.motivo || 'Sem motivo informado pelo emissor' };

      await tx.fiscalDocument.update({ where: { id: notaId }, data });
      return { aplicado: true, status: r.status };
    });

    let resultado: { aplicado: boolean; status: StatusDaNota; motivo?: string };
    try {
      resultado = await transacao();
    } catch (e) {
      if (!ehDuplicidade(e)) throw e;
      const atual = await this.umaNota(tenantId, notaId);
      resultado = { aplicado: false, status: atual.status, motivo: 'reentrega' };
    }

    if (resultado.aplicado && resultado.status === 'autorizada') {
      await this.arquivar(tenantId, notaId);
    }
    return resultado;
  }

  /**
   * Guarda o XML e o DANFE no bucket privado e o hash do XML na nota.
   *
   * Nunca derruba quem chamou: a nota autorizada está autorizada com ou sem
   * arquivo, e o download busca no emissor quando falta. O hash é guardado
   * mesmo sem bucket — é ele que confere o XML que vier do emissor depois.
   */
  private async arquivar(tenantId: string, notaId: string): Promise<void> {
    try {
      const xml = Buffer.from(await this.provedor.baixarXml(notaId));
      const danfe = this.storage.configurado ? Buffer.from(await this.provedor.baixarDanfe(notaId)) : null;
      const [xmlGuardado, danfeGuardado] = this.storage.configurado
        ? await Promise.all([
          this.storage.guardar(tenantId, `notas/${notaId}.xml`, xml, 'application/xml'),
          this.storage.guardar(tenantId, `notas/${notaId}-danfe.pdf`, danfe!),
        ])
        : [null, null];

      await this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
        tx.fiscalDocument.updateMany({
          where: { id: notaId, tenantId, xmlSha256: null },
          data: {
            xmlSha256: sha256(xml),
            xmlKey: xmlGuardado?.chave ?? null,
            danfeKey: danfeGuardado?.chave ?? null,
          },
        }),
      );
    } catch (e) {
      this.logger.warn(`Nota ${notaId} autorizada, mas o XML/DANFE não foi arquivado: ${(e as Error).message}`);
    }
  }

  async consultar(escopo: Escopo, notaId: string) {
    const tenantId = this.tenantDe(escopo);
    this.exigirEmissor();
    const nota = await this.umaNota(tenantId, notaId);
    if (nota.status !== 'processando' && nota.status !== 'autorizada') {
      return this.publica(nota);
    }
    const retorno = await this.provedor.consultar(notaId);
    await this.aplicar(tenantId, notaId, retorno, 'consulta', JSON.stringify(retorno));
    return this.publica(await this.umaNota(tenantId, notaId));
  }

  /* ── Cancelamento ────────────────────────────────────────── */

  async cancelar(escopo: Escopo, quem: QuemPede, notaId: string, justificativa: string) {
    const tenantId = this.tenantDe(escopo);
    this.exigirEmissor();

    await this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const nota = await tx.fiscalDocument.findFirst({ where: { id: notaId, tenantId } });
      if (!nota) throw new NotFoundException('Nota fiscal não encontrada.');
      const pode = podeCancelar(
        { status: nota.status, autorizadaEm: nota.autorizadaEm?.toISOString() ?? null },
        new Date(),
      );
      if (!pode.pode) throw new ConflictException(pode.motivo);

      // A justificativa é gravada antes do pedido: é o texto que a SEFAZ vai
      // receber, e o webhook do cancelamento pode chegar antes da resposta.
      await tx.fiscalDocument.update({
        where: { id: notaId },
        data: { justificativaDoCancelamento: justificativa, canceladaPor: quem.id },
      });
      await tx.auditLog.create({
        data: {
          tenantId, actorUserId: quem.id, action: 'nota_fiscal_cancelamento_pedido',
          entityType: 'fiscal_document', entityId: notaId, diff: { justificativa },
        },
      });
    });

    const retorno = await this.provedor.cancelar(notaId, justificativa);
    await this.aplicar(tenantId, notaId, retorno, 'cancelamento', JSON.stringify(retorno));
    const depois = await this.umaNota(tenantId, notaId);
    if (depois.status !== 'cancelada' && retorno.situacao === 'cancelamento_rejeitado') {
      throw new ConflictException(`A SEFAZ recusou o cancelamento: ${retorno.motivo ?? 'sem motivo informado'}.`);
    }
    return this.publica(depois);
  }

  /* ── Webhook ─────────────────────────────────────────────── */

  async receberWebhook(cabecalhos: CabecalhosDoEmissor, corpo: Buffer) {
    // Lança 401 se o token não conferir — antes de qualquer acesso ao banco.
    const { idDaEntrega, retorno } = this.provedor.interpretarWebhook(cabecalhos, corpo);
    if (!retorno) return { recebido: true, aplicado: false, motivo: 'ignorado' };

    // ── A única leitura sem contexto de tenant ──────────────────────
    //
    // O webhook chega sem usuário e sem loja; o que ele traz é a referência
    // que nós demos à nota (o id dela), e o token acabou de provar que veio
    // do emissor. Achar a loja dona atravessa concessionárias, então usa a
    // conexão privilegiada — por chave primária, devolvendo só o `tenantId`.
    // Tudo o que vem depois roda em `withTenant`, sob RLS.
    const ehUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(retorno.referencia);
    const alvo = ehUuid
      ? await this.privilegiado.fiscalDocument.findUnique({
        where: { id: retorno.referencia }, select: { tenantId: true },
      })
      : null;
    if (!alvo) {
      // 2xx: a entrega é autêntica, então a nota é de outra instalação na
      // mesma conta do emissor. Repetir não a faz aparecer.
      this.logger.warn(`Webhook de nota fiscal para referência desconhecida: ${retorno.referencia}`);
      return { recebido: true, aplicado: false, motivo: 'nota-desconhecida' };
    }

    const r = await this.aplicar(
      alvo.tenantId, retorno.referencia, retorno, 'webhook', corpo.toString('utf8'), idDaEntrega,
    );
    return { recebido: true, aplicado: r.aplicado, status: r.status, motivo: r.motivo };
  }

  /* ── Arquivos ────────────────────────────────────────────── */

  /**
   * XML ou DANFE da nota autorizada (ou cancelada — a loja guarda as duas).
   *
   * Do bucket quando arquivado, do emissor quando não. O XML é conferido
   * contra o hash gravado na autorização em qualquer dos dois caminhos.
   */
  async arquivo(escopo: Escopo, notaId: string, tipo: 'xml' | 'danfe') {
    const tenantId = this.tenantDe(escopo);
    const nota = await this.umaNota(tenantId, notaId);
    if (nota.status !== 'autorizada' && nota.status !== 'cancelada') {
      throw new ConflictException('A nota ainda não foi autorizada: não há XML nem DANFE.');
    }

    const chave = tipo === 'xml' ? nota.xmlKey : nota.danfeKey;
    let conteudo = chave ? await this.storage.baixar(chave) : null;
    if (!conteudo) {
      this.exigirEmissor();
      conteudo = Buffer.from(
        tipo === 'xml' ? await this.provedor.baixarXml(notaId) : await this.provedor.baixarDanfe(notaId),
      );
    }

    if (tipo === 'xml' && nota.xmlSha256 && sha256(conteudo) !== nota.xmlSha256) {
      this.logger.error(`XML da nota ${notaId} não confere com o hash da autorização.`);
      throw new ConflictException(
        'O XML recebido não confere com o da autorização. Nada foi entregue — fale com o suporte.',
      );
    }

    return {
      conteudo,
      nome: `nfe-${nota.chave ?? notaId}${tipo === 'xml' ? '.xml' : '-danfe.pdf'}`,
      tipo: tipo === 'xml' ? 'application/xml' : 'application/pdf',
    };
  }

  /* ── Simulação ───────────────────────────────────────────── */

  /**
   * Só com o emissor simulado, fora de produção (404 no resto): gera o webhook
   * que o emissor mandaria e o entrega pelo caminho real.
   */
  async simular(escopo: Escopo, notaId: string, acao: AcaoSimuladaDaNota) {
    if (!this.simulado) throw new NotFoundException();
    const tenantId = this.tenantDe(escopo);
    await this.umaNota(tenantId, notaId);
    const entrega = (this.provedor as ProvedorDeNotaSimulado).simular(notaId, acao);
    await this.receberWebhook(entrega.cabecalhos, entrega.corpo);
    return this.publica(await this.umaNota(tenantId, notaId));
  }
}
