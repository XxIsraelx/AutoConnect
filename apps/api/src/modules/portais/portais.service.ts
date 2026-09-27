import { createHash, randomBytes } from 'crypto';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@autoconnect/db';
import {
  BYTES_DO_TOKEN_DE_PORTAL,
  CHAVES_DE_PORTAL,
  PORTAIS,
  TOKEN_DE_PORTAL,
  mensagemDoLeadDePortal,
  tokenDoDestinatario,
  type ChaveDoPortal,
  type EmailDeEntrada,
  type SimularLeadDePortalInput,
  type SituacaoDeEntregaDePortal,
} from '@autoconnect/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { LimitePorIp } from '../../common/limite-por-ip';
import { LeadsService, type AvisoDeLeadNovo } from '../leads/leads.service';
import { PROVEDOR_DE_EMAIL_DE_ENTRADA, type ProvedorDeEmailDeEntrada } from './email-de-entrada';
import { lerEmail, lerWebhook, type Leitura } from './leitores';

export type Transporte = 'webhook' | 'email';

/** Teto por endereço de entrada: um token vazado não vira despejo de lead. */
export const LIMITE_POR_CONEXAO = 60;
export const JANELA_POR_CONEXAO_MS = 10 * 60 * 1000;
export const LIMITE_DE_PORTAL = Symbol('LimiteDePortal');

function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function ehUnicidade(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

interface Conexao {
  id: string;
  tenantId: string;
  portal: ChaveDoPortal;
}

/**
 * Leads dos portais: o endereço de entrada de cada loja, a chegada e o
 * reprocessamento.
 *
 * O fluxo de uma entrega: acha a conexão pelo hash do token (o único passo
 * privilegiado — antes dele não há loja) → lê (função pura sobre o cru) →
 * dentro de `withTenant`: grava a entrega (idempotência por
 * `(conexão, event_key)`) → cada lead utilizável vai por
 * `LeadsService.criarDeCanal` (deduplicação, rodízio, prazo) → o e-mail de
 * "lead novo" sai depois do commit.
 *
 * O porquê de cada regra: `docs/decisoes/2026-09-27 leads dos portais.md`.
 */
@Injectable()
export class PortaisService {
  private readonly logger = new Logger(PortaisService.name);

  constructor(
    private readonly prisma: PrismaService,
    /** Um uso só: achar a conexão pelo hash do token, na chegada. */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly config: ConfigService,
    private readonly leads: LeadsService,
    @Inject(PROVEDOR_DE_EMAIL_DE_ENTRADA)
    private readonly email: ProvedorDeEmailDeEntrada,
    @Inject(LIMITE_DE_PORTAL)
    private readonly limite: LimitePorIp,
  ) {}

  private get simulavel(): boolean {
    return this.config.get<string>('NODE_ENV') !== 'production';
  }

  /* ── Conexões ─────────────────────────────────────────────── */

  async listar(tenantId: string): Promise<unknown> {
    const inicio = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const [conexoes, contagem, recentes] = await Promise.all([
        tx.portalConnection.findMany({
          where: { tenantId, active: true },
          select: { id: true, portal: true, createdAt: true, lastReceivedAt: true },
        }),
        tx.portalDelivery.groupBy({
          by: ['portal', 'status'],
          where: { tenantId, receivedAt: { gte: inicio } },
          _count: { _all: true },
        }),
        tx.portalDelivery.findMany({
          where: { tenantId },
          orderBy: { receivedAt: 'desc' },
          take: 40,
          select: {
            id: true, portal: true, status: true, summary: true, transport: true,
            receivedAt: true, leadIds: true,
          },
        }),
      ]);

      return {
        emailDisponivel: this.email.disponivel,
        simulavel: this.simulavel,
        portais: CHAVES_DE_PORTAL.map((chave) => {
          const c = conexoes.find((x) => x.portal === chave);
          const mes = Object.fromEntries(
            contagem.filter((g) => g.portal === chave).map((g) => [g.status, g._count._all]),
          );
          return {
            chave,
            nome: PORTAIS[chave].nome,
            conexao: c ? { id: c.id, conectadaEm: c.createdAt, ultimoRecebimento: c.lastReceivedAt } : null,
            mes,
            recentes: recentes
              .filter((r) => r.portal === chave)
              .slice(0, 8)
              .map((r) => ({
                id: r.id, situacao: r.status, resumo: r.summary, transporte: r.transport,
                recebidaEm: r.receivedAt, leads: r.leadIds.length,
              })),
          };
        }),
      };
    });
  }

  /**
   * O endereço sai daqui **uma vez**: o banco guarda o hash. Pedir outro
   * (`regenerar`) invalida o anterior — a tela avisa antes, porque o
   * encaminhamento já configurado para de funcionar.
   */
  async conectar(tenantId: string, usuarioId: string, portal: ChaveDoPortal) {
    const token = randomBytes(BYTES_DO_TOKEN_DE_PORTAL).toString('hex');
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        const ativa = await tx.portalConnection.findFirst({
          where: { tenantId, portal, active: true },
          select: { id: true },
        });
        if (ativa) {
          throw new ConflictException(
            `A ${PORTAIS[portal].nome} já está conectada. Gere um endereço novo se perdeu o anterior.`,
          );
        }
        await tx.portalConnection.create({
          data: { tenantId, portal, tokenHash: hashDoToken(token), createdBy: usuarioId },
        });
      });
    } catch (err) {
      if (ehUnicidade(err)) throw new ConflictException(`A ${PORTAIS[portal].nome} já está conectada.`);
      throw err;
    }
    return { token, email: this.email.endereco(token) };
  }

  async regenerar(tenantId: string, portal: ChaveDoPortal) {
    const token = randomBytes(BYTES_DO_TOKEN_DE_PORTAL).toString('hex');
    await this.prisma.withTenant(tenantId, async (tx) => {
      const r = await tx.portalConnection.updateMany({
        where: { tenantId, portal, active: true },
        data: { tokenHash: hashDoToken(token) },
      });
      if (r.count === 0) throw new NotFoundException(`A ${PORTAIS[portal].nome} não está conectada.`);
    });
    return { token, email: this.email.endereco(token) };
  }

  /** Desconectar não apaga as entregas: elas são a trilha do que chegou. */
  async desconectar(tenantId: string, portal: ChaveDoPortal): Promise<{ ok: true }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const r = await tx.portalConnection.updateMany({
        where: { tenantId, portal, active: true },
        data: { active: false },
      });
      if (r.count === 0) throw new NotFoundException(`A ${PORTAIS[portal].nome} não está conectada.`);
    });
    return { ok: true };
  }

  /* ── Chegada ──────────────────────────────────────────────── */

  private async conexaoDoToken(token: string): Promise<Conexao | null> {
    if (!TOKEN_DE_PORTAL.test(token)) return null;
    const c = await this.privilegiado.portalConnection.findFirst({
      where: { tokenHash: hashDoToken(token), active: true },
      select: { id: true, tenantId: true, portal: true },
    });
    return c ? { ...c, portal: c.portal as ChaveDoPortal } : null;
  }

  private exigirLimite(conexao: Conexao): void {
    if (!this.limite.permitir(conexao.id)) {
      throw new HttpException(
        'Muitas entregas em pouco tempo neste endereço. Tente de novo em alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** `POST /webhooks/portais/:token`. Token que não existe é 404. */
  async receberWebhook(token: string, corpo: Buffer) {
    const conexao = await this.conexaoDoToken(token.toLowerCase());
    if (!conexao) throw new NotFoundException('Endereço de entrada não encontrado.');
    this.exigirLimite(conexao);

    const raw = corpo.toString('utf8');
    return this.processar(conexao, 'webhook', createHash('sha256').update(corpo).digest('hex'), raw);
  }

  /**
   * `POST /webhooks/email-de-entrada`. Destinatário que não é de loja nenhuma
   * responde 200 e é descartado com aviso: o e-mail é autêntico (passou pela
   * autenticação do provedor), e insistir não o faria achar dono.
   */
  async receberEmail(cabecalhos: Record<string, string | string[] | undefined>, corpo: Buffer) {
    const email = this.email.interpretar(cabecalhos, corpo);
    const token = tokenDoDestinatario(email.para);
    const conexao = token ? await this.conexaoDoToken(token) : null;
    if (!conexao) {
      this.logger.warn(`E-mail de entrada sem loja: ${email.para.join(', ') || '(sem destinatário)'}`);
      return { recebido: true, descartado: 'destinatario-desconhecido' };
    }
    this.exigirLimite(conexao);

    const chave = email.idExterno || createHash('sha256').update(corpo).digest('hex');
    return this.processar(conexao, 'email', chave, JSON.stringify(email));
  }

  private ler(portal: ChaveDoPortal, transporte: Transporte, raw: string): Leitura {
    if (transporte === 'email') {
      try {
        return lerEmail(portal, JSON.parse(raw) as EmailDeEntrada);
      } catch {
        return { tipo: 'nao_entendido', resumo: 'E-mail guardado ilegível' };
      }
    }
    return lerWebhook(portal, raw);
  }

  /**
   * Grava a entrega e aplica a leitura, numa transação só. A leitura é feita
   * antes (é pura); o que ela produz entra junto com a linha da entrega — ou
   * nada entra.
   */
  private async processar(conexao: Conexao, transporte: Transporte, eventKey: string, raw: string) {
    const leitura = this.ler(conexao.portal, transporte, raw);
    const avisos: AvisoDeLeadNovo[] = [];

    const r = await this.prisma.withTenant(conexao.tenantId, async (tx) => {
      let entregaId: string;
      try {
        const e = await tx.portalDelivery.create({
          data: {
            tenantId: conexao.tenantId,
            connectionId: conexao.id,
            portal: conexao.portal,
            transport: transporte,
            eventKey,
            status: 'nao_entendido' satisfies SituacaoDeEntregaDePortal,
            summary: leitura.resumo,
            rawBody: raw,
          },
          select: { id: true },
        });
        entregaId = e.id;
      } catch (err) {
        // Idempotência: a mesma entrega (mesmo e-mail, mesmo corpo) de novo.
        if (ehUnicidade(err)) return null;
        throw err;
      }

      const aplicado = await this.aplicar(tx, conexao, entregaId, leitura, avisos);
      await tx.portalConnection.update({ where: { id: conexao.id }, data: { lastReceivedAt: new Date() } });
      return { entregaId, ...aplicado };
    });

    if (!r) return { recebido: true, duplicada: true };
    for (const a of avisos) this.leads.avisarDeLeadDeCanal(a);
    return { recebido: true, duplicada: false, situacao: r.situacao, leads: r.leadIds.length };
  }

  private async aplicar(
    tx: Parameters<Parameters<PrismaService['withTenant']>[1]>[0],
    conexao: Conexao,
    entregaId: string,
    leitura: Leitura,
    avisos: AvisoDeLeadNovo[],
  ): Promise<{ situacao: SituacaoDeEntregaDePortal; leadIds: string[] }> {
    let situacao: SituacaoDeEntregaDePortal = leitura.tipo === 'ignorado' ? 'ignorado' : 'nao_entendido';
    const leadIds: string[] = [];

    if (leitura.tipo === 'leads') {
      let algumNovo = false;
      for (const l of leitura.leads) {
        const criado = await this.leads.criarDeCanal(tx, conexao.tenantId, {
          source: 'portal',
          contactName: l.nome,
          contactPhone: l.telefone,
          contactEmail: l.email,
          message: mensagemDoLeadDePortal(l, conexao.portal),
          comoChegou: PORTAIS[conexao.portal].nome,
          metadata: {
            portal: conexao.portal,
            anuncio: l.anuncio,
            idNoPortal: l.idExterno ?? null,
            entregaId,
          } as Record<string, unknown>,
        });
        leadIds.push(criado.leadId);
        if (!criado.deduplicado) algumNovo = true;
        if (criado.aviso) avisos.push(criado.aviso);
      }
      situacao = algumNovo ? 'aplicado' : 'duplicado';
    }

    await tx.portalDelivery.update({
      where: { id: entregaId },
      data: { status: situacao, summary: leitura.resumo, leadIds, processedAt: new Date() },
    });
    return { situacao, leadIds };
  }

  /**
   * Relê uma entrega "não entendida" com o leitor de hoje. É o que faz o lead
   * que chegou antes do leitor da OLX existir não se perder.
   */
  async reprocessar(tenantId: string, entregaId: string) {
    const avisos: AvisoDeLeadNovo[] = [];
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const e = await tx.portalDelivery.findFirst({
        where: { id: entregaId, tenantId },
        select: { id: true, status: true, transport: true, rawBody: true, connectionId: true, portal: true },
      });
      if (!e) throw new NotFoundException('Entrega não encontrada.');
      if (e.status !== 'nao_entendido') {
        throw new ConflictException('Só a entrega não entendida é reprocessada.');
      }
      const conexao: Conexao = { id: e.connectionId, tenantId, portal: e.portal as ChaveDoPortal };
      const leitura = this.ler(conexao.portal, e.transport as Transporte, e.rawBody);
      return this.aplicar(tx, conexao, e.id, leitura, avisos);
    });
    for (const a of avisos) this.leads.avisarDeLeadDeCanal(a);
    return r;
  }

  /* ── Simulação ────────────────────────────────────────────── */

  /**
   * Só fora de produção (404 em produção). Monta a entrega que o portal
   * mandaria e a processa pelo mesmo caminho — o leitor, a idempotência, a
   * criação do lead. Não passa pelo HTTP porque o token não existe em claro
   * depois de conectar; o teste de integração cobre a rota.
   */
  async simular(tenantId: string, portal: ChaveDoPortal, dados: SimularLeadDePortalInput) {
    if (!this.simulavel) throw new NotFoundException();
    const c = await this.prisma.withTenant(tenantId, (tx) =>
      tx.portalConnection.findFirst({ where: { tenantId, portal, active: true }, select: { id: true } }),
    );
    if (!c) throw new NotFoundException(`Conecte a ${PORTAIS[portal].nome} antes de simular.`);
    const conexao: Conexao = { id: c.id, tenantId, portal };
    const id = `sim-${Date.now()}-${randomBytes(4).toString('hex')}`;

    if (dados.via === 'webhook') {
      const raw = JSON.stringify({
        id, nome: dados.nome, telefone: dados.telefone, mensagem: dados.mensagem ?? null,
        anuncio: dados.anuncio ? { titulo: dados.anuncio } : null,
      });
      return this.processar(conexao, 'webhook', id, raw);
    }

    const email: EmailDeEntrada = {
      idExterno: id,
      de: `notificacoes@${PORTAIS[portal].dominios[0] ?? 'portal.exemplo'}`,
      para: [],
      assunto: `Nova mensagem sobre o seu anúncio${dados.anuncio ? ` ${dados.anuncio}` : ''}`,
      texto: [
        'Você recebeu uma nova mensagem.',
        '',
        `Nome: ${dados.nome}`,
        `Telefone: ${dados.telefone}`,
        dados.mensagem ? `Mensagem: ${dados.mensagem}` : '',
        dados.anuncio ? `Anúncio: ${dados.anuncio}` : '',
      ].filter((l) => l !== null).join('\n'),
      html: null,
    };
    return this.processar(conexao, 'email', id, JSON.stringify(email));
  }
}
