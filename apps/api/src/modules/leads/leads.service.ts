import {
  Injectable, Logger, NotFoundException, BadRequestException, ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { EmailService } from '../../common/email/email.service';
import {
  limiteDeAlertaSegundos,
  normalizarTelefoneBr,
  rotuloDoMotivo,
  type CreateLeadInput,
  type ExportLeadsInput,
  type ListLeadsInput,
  type SlaStatsInput,
  type UpdateLeadInput,
  type LeadPublicoInput,
  type LeadManualInput,
  type LeadInteractionKind,
} from '@autoconnect/shared';
import { acharLeadDuplicado, registrarContatoRepetido } from './deduplicacao';
import { LimitePorIp, chaveDoEnvio } from './limite-por-ip';
import { CrmSettingsService, type AjustesDeCrm } from '../crm/crm-settings.service';
import { RodizioService } from '../crm/rodizio.service';
import { SlaService } from '../crm/sla.service';
import { AtribuicaoDeLead, type LeadDistribuido } from '../crm/atribuicao.service';
import { carteiraDe, type Ator } from './carteira';

/** Dados do e-mail de "lead novo", montados dentro da transação e enviados fora. */
interface AvisoDeLeadNovo {
  dealerEmail: string | null;
  dealerName: string;
  customerName: string;
  vehicleInfo: string;
  message: string | null;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    /** Consolidado da plataforma para o super admin. */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly email: EmailService,
    /**
     * Teto de envios do formulário público. Em memória, de processo — ver o
     * arquivo do limite para o porquê de não haver Redis nem CAPTCHA.
     */
    private readonly limitePublico: LimitePorIp,
    private readonly ajustes: CrmSettingsService,
    private readonly rodizio: RodizioService,
    private readonly sla: SlaService,
    private readonly atribuicao: AtribuicaoDeLead,
  ) {}

  /* ── Rodízio e prazo, na criação do lead ───────────────── */

  /**
   * Decide responsável e prazo de primeiro contato de um lead que vai nascer.
   *
   * A conta mora em `AtribuicaoDeLead` (módulo CRM) desde que o formulário de
   * troca revelou que ela valia só para quem passava por aqui: o lead de troca
   * nascia órfão e sem relógio porque o `CatalogService` não tinha como chamar
   * um método privado. Este atalho fica para não reescrever as três chamadas.
   */
  private distribuirEAgendar(
    tx: ScopedClient,
    tenantId: string,
    opcoes: { branchId?: string | null; responsavelFixo?: string | null; criadoEm: Date },
  ): Promise<LeadDistribuido> {
    return this.atribuicao.distribuirEAgendar(tx, tenantId, opcoes);
  }

  /** Cria um lead. O userId vem do token JWT (customer logado). */
  async create(
    userId: string,
    tenantId: string,
    input: CreateLeadInput,
  ): Promise<unknown> {
    const { lead, deduplicado, aviso } = await this.prisma.withTenantAndUser(
      tenantId,
      userId,
      async (tx) => {
    // Busca dados do cliente
    const customer = await tx.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true, phone: true },
    });
    if (!customer) throw new NotFoundException('Usuário não encontrado');

    // Busca dados da concessionária (para o e-mail)
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { tradeName: true, primaryPhone: true, branches: {
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { email: true },
      }},
    });
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');

    const vehicleInfo = await this.descreverVeiculo(tx, input.vehicleId ?? null);

    const contactEmail = input.contactEmail ?? customer.email;
    const contactPhone = input.contactPhone ?? customer.phone ?? null;

    // Mesmo o cliente logado passa pela deduplicação: é justamente ele que
    // clica em "tenho interesse" três vezes esperando resposta.
    const existente = await acharLeadDuplicado(tx, tenantId, { contactPhone, contactEmail });
    if (existente) {
      await registrarContatoRepetido(tx, {
        tenantId,
        leadId: existente.id,
        actorUserId: userId,
        vehicleId: input.vehicleId ?? null,
        vehicleIdAtual: existente.vehicleId,
        source: input.source,
        message: input.message ?? null,
        origem: 'cliente',
      });

      const lead = await tx.lead.findUniqueOrThrow({ where: { id: existente.id } });
      // Sem e-mail: a loja já foi avisada deste lead. Um aviso por clique
      // repetido treinaria o lojista a ignorar a caixa de entrada.
      return { lead, deduplicado: true, aviso: null };
    }

    const criadoEm = new Date();
    const { assignedTo, firstResponseDueAt, viaRodizio } =
      await this.distribuirEAgendar(tx, tenantId, { branchId: input.branchId, criadoEm });

    const lead = await tx.lead.create({
      data: {
        tenantId,
        customerUserId: userId,
        vehicleId: input.vehicleId ?? null,
        branchId: input.branchId ?? null,
        contactName: input.contactName ?? customer.fullName,
        contactEmail,
        contactPhone,
        contactPhoneNormalized: normalizarTelefoneBr(contactPhone),
        source: input.source,
        message: input.message ?? null,
        status: 'new',
        assignedTo,
        firstResponseDueAt,
      },
    });

    await this.registrarCriacao(tx, tenantId, lead.id, userId, 'formulário do site', criadoEm);
    if (viaRodizio) {
      await this.rodizio.registrarNaTimeline(
        tx, tenantId, lead.id, assignedTo, new Date(criadoEm.getTime() + 1),
      );
    }

    return {
      lead,
      deduplicado: false,
      aviso: {
        dealerEmail: tenant.branches[0]?.email ?? null,
        dealerName: tenant.tradeName,
        customerName: customer.fullName,
        vehicleInfo,
        message: input.message ?? null,
      } satisfies AvisoDeLeadNovo,
    };
      },
    );

    this.avisarLojaDeLeadNovo(aviso);

    return { ...lead, deduplicado };
  }

  /* ── Lead anônimo (formulário público) ─────────────────── */

  /**
   * Captura de lead **sem conta**: o visitante preenche o formulário do
   * catálogo ou da página da loja e vira lead.
   *
   * Sobre o contexto de RLS — é a decisão mais delicada desta rota:
   *
   *  1. a resolução da loja roda em `withPublic`, **sem** `app.tenant_id`.
   *     Sobra a policy `leitura_publica`, que é o que já está na vitrine:
   *     veículo `available` e loja ativa. É de onde o `tenantId` sai;
   *  2. a gravação roda em `withTenant(tenantId)`, porque `leads` só tem
   *     `tenant_isolation` — em `withPublic` o INSERT seria recusado pelo
   *     `WITH CHECK`, e essa recusa é a proteção, não um obstáculo.
   *
   * O `tenantId` usado no passo 2 **nunca** é o do corpo quando há veículo: é o
   * do veículo, lido do banco. Se o corpo trouxer outro, a requisição é
   * recusada com 404 — confirmar "esse veículo não é dessa loja" já é contar
   * mais do que um visitante precisa saber.
   */
  async criarPublico(
    input: LeadPublicoInput,
    ip: string,
  ): Promise<{ ok: true; deduplicado: boolean; leadId: string | null }> {
    // Honeypot: campo escondido que só um robô preenche. A resposta é a mesma
    // de sucesso, de propósito — dizer "detectei" ensina a contornar.
    if (input.website && input.website.trim() !== '') {
      this.logger.warn(`Formulário público descartado pelo honeypot (ip ${ip})`);
      return { ok: true, deduplicado: false, leadId: null };
    }

    const { tenantId, vehicleId } = await this.resolverLojaPublica(input);

    if (!this.limitePublico.permitir(chaveDoEnvio(ip, tenantId, vehicleId))) {
      throw new ConflictException(
        'Recebemos seu contato há pouco. A loja já foi avisada e vai responder em breve.',
      );
    }

    const contactEmail = input.contactEmail?.trim() || null;

    const { deduplicado, leadId, aviso } = await this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: {
          tradeName: true,
          branches: {
            where: { isActive: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { email: true },
          },
        },
      });
      if (!tenant) throw new NotFoundException('Concessionária não encontrada');

      const existente = await acharLeadDuplicado(tx, tenantId, {
        contactPhone: input.contactPhone,
        contactEmail,
      });

      if (existente) {
        await registrarContatoRepetido(tx, {
          tenantId,
          leadId: existente.id,
          // Sem ator: não há usuário por trás do clique, e inventar um seria
          // atribuir a alguém da loja o que o visitante fez.
          actorUserId: null,
          vehicleId,
          vehicleIdAtual: existente.vehicleId,
          source: 'website',
          message: input.message ?? null,
          origem: 'publico',
        });
        return { deduplicado: true, leadId: existente.id, aviso: null };
      }

      const vehicleInfo = await this.descreverVeiculo(tx, vehicleId);

      const criadoEm = new Date();
      const { assignedTo, firstResponseDueAt, viaRodizio } =
        await this.distribuirEAgendar(tx, tenantId, { criadoEm });

      const lead = await tx.lead.create({
        data: {
          tenantId,
          assignedTo,
          firstResponseDueAt,
          // Sempre nulo aqui: esta rota é a do visitante sem conta. Quem está
          // logado continua indo por `POST /leads`, que vincula o usuário — a
          // tela escolhe a rota pelo token que tem em mãos.
          customerUserId: null,
          vehicleId,
          contactName: input.contactName,
          contactEmail,
          contactPhone: input.contactPhone,
          contactPhoneNormalized: normalizarTelefoneBr(input.contactPhone),
          source: 'website',
          status: 'new',
          message: input.message ?? null,
          consentedAt: new Date(),
          consentText: input.consentText,
        },
      });

      await this.registrarCriacao(
        tx, tenantId, lead.id, null, 'formulário público do site', criadoEm,
      );
      if (viaRodizio) {
        await this.rodizio.registrarNaTimeline(
          tx, tenantId, lead.id, assignedTo, new Date(criadoEm.getTime() + 1),
        );
      }

      return {
        deduplicado: false,
        leadId: lead.id,
        aviso: {
          dealerEmail: tenant.branches[0]?.email ?? null,
          dealerName: tenant.tradeName,
          customerName: input.contactName,
          vehicleInfo,
          message: input.message ?? null,
        } satisfies AvisoDeLeadNovo,
      };
    });

    this.avisarLojaDeLeadNovo(aviso);

    // O id do lead não é segredo (quem o criou sabe o que enviou), mas nada da
    // loja volta para a página pública além disso.
    return { ok: true, deduplicado, leadId };
  }

  /**
   * De qual loja é este formulário.
   *
   * Roda em `withPublic` — sem contexto de tenant, exatamente como o catálogo.
   * É a única leitura possível aqui: o visitante não tem loja, e confiar no
   * `tenantId` do corpo sem conferir deixaria qualquer um criar lead em
   * qualquer concessionária.
   */
  private async resolverLojaPublica(
    input: LeadPublicoInput,
  ): Promise<{ tenantId: string; vehicleId: string | null }> {
    if (input.vehicleId) {
      const vehicleId = input.vehicleId;
      const veiculo = await this.prisma.withPublic((tx) =>
        tx.vehicle.findFirst({
          where: { id: vehicleId, status: 'available' },
          select: { id: true, tenantId: true },
        }),
      );
      // 404 também quando o veículo existe mas está fora da vitrine: a policy
      // `leitura_publica` já não o devolveria, e a mensagem é a mesma.
      if (!veiculo) throw new NotFoundException('Veículo não encontrado');

      if (input.tenantId && input.tenantId !== veiculo.tenantId) {
        throw new NotFoundException('Veículo não encontrado');
      }
      return { tenantId: veiculo.tenantId, vehicleId: veiculo.id };
    }

    const tenantId = input.tenantId!;
    const loja = await this.prisma.withPublic((tx) =>
      tx.tenant.findFirst({ where: { id: tenantId, isActive: true }, select: { id: true } }),
    );
    if (!loja) throw new NotFoundException('Concessionária não encontrada');

    return { tenantId: loja.id, vehicleId: null };
  }

  /* ── Lead manual (vendedor cadastrando quem chegou por fora) ── */

  /**
   * O cliente ligou, mandou mensagem ou apareceu no balcão.
   *
   * Passa pela mesma deduplicação da rota pública: é comum a pessoa preencher o
   * formulário e ligar em seguida, e o vendedor não tem como saber disso antes
   * de cadastrar.
   */
  async criarManual(
    escopo: Escopo,
    criador: Ator,
    input: LeadManualInput,
  ): Promise<unknown> {
    const criadorId = criador.id;
    if (ehGlobal(escopo)) {
      // Super admin sem loja selecionada não tem a qual loja cadastrar. Falha
      // alto em vez de escolher uma.
      throw new ForbiddenException(
        'Selecione uma concessionária para cadastrar um lead.',
      );
    }
    const tenantId = escopo.tenantId;
    const contactEmail = input.contactEmail?.trim() || null;

    const { lead, deduplicado } = await this.prisma.withTenant(tenantId, async (tx) => {
      if (input.vehicleId) {
        const veiculo = await tx.vehicle.findFirst({
          where: { id: input.vehicleId, tenantId },
          select: { id: true },
        });
        if (!veiculo) throw new NotFoundException('Veículo não encontrado');
      }

      // Quem cadastra à mão é quem já está atendendo: o vendedor fica com o
      // próprio lead, e só aí não há rodízio a aplicar. Gerente e
      // administrador cadastram o que chegou por fora e **não** ficam com ele —
      // esse vai para o rodízio, que é o caminho pelo qual o lead do balcão
      // chega ao vendedor da vez.
      const responsavelPedido =
        input.assignedTo ?? (criador.role === 'salesperson' ? criadorId : null);

      if (responsavelPedido) {
        const vendedor = await tx.user.findFirst({
          where: { id: responsavelPedido, tenantId, status: 'active' },
          select: { id: true },
        });
        if (!vendedor) throw new NotFoundException('Vendedor não encontrado');
      }

      const existente = await acharLeadDuplicado(tx, tenantId, {
        contactPhone: input.contactPhone,
        contactEmail,
      });

      if (existente) {
        await registrarContatoRepetido(tx, {
          tenantId,
          leadId: existente.id,
          actorUserId: criadorId,
          vehicleId: input.vehicleId ?? null,
          vehicleIdAtual: existente.vehicleId,
          source: input.source,
          message: input.message ?? null,
          origem: 'manual',
        });
        const lead = await tx.lead.findUniqueOrThrow({ where: { id: existente.id } });
        return { lead, deduplicado: true };
      }

      const criadoEm = new Date();
      const { assignedTo, firstResponseDueAt, viaRodizio } =
        await this.distribuirEAgendar(tx, tenantId, {
          branchId: input.branchId,
          responsavelFixo: responsavelPedido,
          criadoEm,
        });

      const lead = await tx.lead.create({
        data: {
          tenantId,
          vehicleId: input.vehicleId ?? null,
          branchId: input.branchId ?? null,
          assignedTo,
          firstResponseDueAt,
          contactName: input.contactName,
          contactEmail,
          contactPhone: input.contactPhone,
          contactPhoneNormalized: normalizarTelefoneBr(input.contactPhone),
          source: input.source,
          status: 'new',
          message: input.message ?? null,
        },
      });

      await this.registrarCriacao(tx, tenantId, lead.id, criadorId, 'cadastro manual', criadoEm);
      if (viaRodizio) {
        await this.rodizio.registrarNaTimeline(
          tx, tenantId, lead.id, assignedTo, new Date(criadoEm.getTime() + 1),
        );
      }

      return { lead, deduplicado: false };
    });

    return { ...lead, deduplicado };
  }

  /* ── Auxiliares compartilhados ─────────────────────────── */

  /** Primeira linha da timeline: sem ela, o lead novo nasce com histórico vazio. */
  private async registrarCriacao(
    tx: ScopedClient,
    tenantId: string,
    leadId: string,
    actorUserId: string | null,
    comoChegou: string,
    /** Explícito: dentro da transação, `now()` é igual para todas as linhas. */
    ocorridoEm: Date = new Date(),
  ): Promise<void> {
    await tx.leadInteraction.create({
      data: {
        leadId,
        tenantId,
        actorUserId,
        occurredAt: ocorridoEm,
        kind: 'created' satisfies LeadInteractionKind,
        content: `Lead criado — ${comoChegou}`,
      },
    });
  }

  /** "Marca Modelo Versão Ano", ou "veículo" quando não há carro no lead. */
  private async descreverVeiculo(tx: ScopedClient, vehicleId: string | null): Promise<string> {
    if (!vehicleId) return 'veículo';

    const vehicle = await tx.vehicle.findUnique({
      where: { id: vehicleId },
      select: {
        versionName: true,
        yearModel: true,
        brand: { select: { name: true } },
        model: { select: { name: true } },
      },
    });
    if (!vehicle) return 'veículo';

    return `${vehicle.brand.name} ${vehicle.model.name} ${vehicle.versionName ?? ''} ${vehicle.yearModel}`
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** E-mail de "lead novo" para a loja. Fora da transação e não bloqueante. */
  private avisarLojaDeLeadNovo(aviso: AvisoDeLeadNovo | null): void {
    if (!aviso?.dealerEmail) return;

    this.email
      .sendLeadNotification({
        to: aviso.dealerEmail,
        dealerName: aviso.dealerName,
        customerName: aviso.customerName,
        vehicleInfo: aviso.vehicleInfo,
        message: aviso.message,
        leadUrl: `${process.env.WEB_URL ?? 'http://localhost:3000'}/dashboard/leads`,
      })
      .catch((err) => this.logger.warn(`Falha ao notificar a loja do lead novo: ${err}`));
  }

  /* ── Filtros da lista ──────────────────────────────────── */

  /**
   * O recorte do prazo, em SQL.
   *
   * "Vencendo" usa o **mesmo** limite de alerta que a etiqueta da tela
   * (`limiteDeAlertaSegundos` sobre o prazo configurado pela loja). Se cada
   * ponta usasse a própria conta, o filtro traria leads que a etiqueta chama
   * de "no prazo" — e a lista perderia a credibilidade justamente na tela em
   * que o gerente cobra.
   */
  private whereDoSla(
    filtro: ListLeadsInput['sla'],
    agora: Date,
    alertaSegundos: number,
  ): Prisma.LeadWhereInput {
    const beiraDoPrazo = new Date(agora.getTime() + alertaSegundos * 1000);

    switch (filtro) {
      case 'estourado':
        return { firstRespondedAt: null, firstResponseDueAt: { lte: agora } };
      case 'vencendo':
        return { firstRespondedAt: null, firstResponseDueAt: { gt: agora, lte: beiraDoPrazo } };
      case 'no_prazo':
        return { firstRespondedAt: null, firstResponseDueAt: { gt: beiraDoPrazo } };
      default:
        return {};
    }
  }

  /**
   * O `where` da lista, da contagem e do CSV — um só, de propósito.
   *
   * A carteira precisa valer nas quatro superfícies (lista, contadores, CSV e
   * detalhe). Montar o filtro em cada método é como uma delas fica de fora e
   * o CSV exporta o que a tela esconde.
   *
   * Os recortes entram em `AND` e não espalhados no objeto: a carteira e o
   * filtro de responsável produzem `OR`, e dois `OR` no mesmo nível fariam o
   * segundo apagar o primeiro em silêncio.
   */
  private whereDaLista(
    escopo: Escopo,
    ator: Ator | null,
    ajustes: AjustesDeCrm | null,
    opts: {
      status?: string;
      vehicleId?: string;
      responsavel?: ListLeadsInput['responsavel'];
      sla?: ListLeadsInput['sla'];
      criadoDe?: Date;
      criadoAte?: Date;
      agora?: Date;
    },
  ): Prisma.LeadWhereInput {
    const agora = opts.agora ?? new Date();
    const partes: Prisma.LeadWhereInput[] = [];

    if (opts.responsavel === 'meus' && ator) partes.push({ assignedTo: ator.id });
    if (opts.responsavel === 'sem_responsavel') partes.push({ assignedTo: null });

    if (opts.sla && opts.sla !== 'todos') {
      partes.push(
        this.whereDoSla(
          opts.sla,
          agora,
          limiteDeAlertaSegundos(ajustes?.slaPrimeiroContatoMinutos ?? 15),
        ),
      );
    }

    // Super admin no consolidado não tem carteira a aplicar: `ajustes` é nulo
    // e a função devolve `{}` — o `true` aqui é o padrão, não uma permissão.
    const carteira = carteiraDe(ator, ajustes?.vendedorVeTodosOsLeads ?? true);
    if (Object.keys(carteira).length > 0) partes.push(carteira);

    return {
      ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }),
      ...(opts.status ? { status: opts.status as Prisma.LeadWhereInput['status'] } : {}),
      ...(opts.vehicleId ? { vehicleId: opts.vehicleId } : {}),
      ...(opts.criadoDe || opts.criadoAte
        ? {
            createdAt: {
              ...(opts.criadoDe ? { gte: opts.criadoDe } : {}),
              ...(opts.criadoAte ? { lte: opts.criadoAte } : {}),
            },
          }
        : {}),
      ...(partes.length > 0 ? { AND: partes } : {}),
    };
  }

  /** Lista leads da concessionária autenticada (dealer/admin) */
  async findAll(
    escopo: Escopo,
    ator: Ator,
    opts: ListLeadsInput & { vehicleId?: string },
  ): Promise<unknown> {
    const { page, perPage } = opts;
    const skip = (page - 1) * perPage;

    const consultar = async (tx: ScopedClient, ajustes: AjustesDeCrm | null) => {
      const where = this.whereDaLista(escopo, ator, ajustes, opts);
      const [items, total] = await Promise.all([
        tx.lead.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          vehicle: {
            select: {
              id: true,
              versionName: true,
              yearModel: true,
              price: true,
              brand: { select: { name: true } },
              model: { select: { name: true } },
              images: { where: { isCover: true }, take: 1, select: { url: true } },
            },
          },
          customer: {
            select: { id: true, fullName: true, email: true, phone: true },
          },
          // Quem é o responsável precisa vir na listagem: é onde o gerente
          // distribui a fila, e sem isto o botão de atribuir não teria o que
          // exibir nem como saber se já há alguém.
          assignee: {
            select: { id: true, fullName: true, email: true, role: true },
          },
        },
      }),
        tx.lead.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        perPage,
        /**
         * Quantos segundos antes do prazo a etiqueta deve avisar. Vai junto da
         * lista para a tela não precisar de uma rota a mais — e para a etiqueta
         * usar exatamente o número que o filtro "vencendo" usou.
         */
        slaAlertaSegundos: limiteDeAlertaSegundos(ajustes?.slaPrimeiroContatoMinutos ?? 15),
      };
    };

    if (ehGlobal(escopo)) return consultar(this.privilegiado, null);

    return this.prisma.withTenant(escopo.tenantId, async (tx) => {
      const ajustes = await this.ajustes.ler(tx, escopo.tenantId);
      return consultar(tx, ajustes);
    });
  }

  /**
   * Move o status e/ou corrige o veículo de interesse (dealer/admin).
   *
   * O veículo é a metade que faltava: o lead de balcão e o de telefone nascem
   * sem carro — quem chega no balcão ainda está escolhendo —, e um lead sem
   * veículo não ganha botão de negócio. Sem esta rota ele morria no card.
   */
  async atualizar(
    tenantId: string,
    leadId: string,
    ator: Ator,
    input: UpdateLeadInput,
  ): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const ajustes = await this.ajustes.ler(tx, tenantId);
      const lead = await tx.lead.findFirst({
        where: {
          id: leadId, tenantId,
          // A carteira vale igual para vincular veículo: o lead do colega
          // responde 404, não 403 — confirmar que ele existe já entrega que
          // há um cliente com aquele id do outro lado, e o id circula por link.
          ...carteiraDe(ator, ajustes.vendedorVeTodosOsLeads),
        },
      });
      if (!lead) throw new NotFoundException('Lead não encontrado');

      // O veículo tem de ser desta loja. O `withTenant` já limita a consulta,
      // e o `where` explícito repete o filtro porque a aplicação ainda conecta
      // como dona das tabelas em parte dos ambientes.
      if (input.vehicleId) {
        const veiculo = await tx.vehicle.findFirst({
          where: { id: input.vehicleId, tenantId },
          select: { id: true },
        });
        if (!veiculo) throw new NotFoundException('Veículo não encontrado');
      }

      // `won` deixou de ser o fim do lead e passou a significar "gerou
      // negócio". Sem esta checagem o funil de leads e o de negócios divergem:
      // a tela mostra a venda ganha e não há negócio nenhum por trás dela,
      // nem margem, nem contrato. A regra vive aqui, e não só na tela, porque
      // a rota é pública para o painel inteiro.
      if (input.status === 'won') {
        const negocios = await tx.deal.count({ where: { leadId, tenantId } });
        if (negocios === 0) {
          throw new ConflictException(
            'Para marcar o lead como ganho, abra o negócio correspondente — ' +
              'é ele que carrega valor, pagamento e margem.',
          );
        }
      }

      // Perder exige motivo, e o Zod da rota já garantiu que ele veio. Aqui
      // ele é gravado; e voltar de "perdido" para qualquer outro status
      // **limpa** o motivo, senão o relatório contaria como perda por preço um
      // lead que está em negociação. Sem mudança de status, o motivo fica como
      // está: vincular um veículo não é sair da perda.
      const motivo = input.status === undefined
        ? {}
        : input.status === 'lost'
          ? { lostReasonCode: input.lostReasonCode ?? null, lostReason: input.lostReason ?? null }
          : { lostReasonCode: null, lostReason: null };

      const atualizado = await tx.lead.update({
        where: { id: leadId },
        data: {
          ...(input.status !== undefined && { status: input.status }),
          ...(input.vehicleId !== undefined && { vehicleId: input.vehicleId }),
          ...motivo,
          lastActivityAt: new Date(),
        },
        // A tela substitui o lead da lista pelo que volta daqui — foi assim
        // que o motivo da perda aparecia como "sem motivo informado" logo
        // depois de salvo, com o valor certo no banco. Sem as relações, o card
        // perderia foto e nome do veículo recém-vinculado.
        include: {
          vehicle: {
            select: {
              id: true, versionName: true, yearModel: true, price: true,
              brand: { select: { name: true } },
              model: { select: { name: true } },
              images: { where: { isCover: true }, take: 1, select: { url: true } },
            },
          },
          customer: { select: { id: true, fullName: true, email: true, phone: true } },
          assignee: { select: { id: true, fullName: true, email: true, role: true } },
        },
      });

      // A mudança de status não deixava rastro nenhum na timeline: o lead
      // aparecia "Perdido" e o histórico não dizia quem, quando nem por quê.
      if (input.status !== undefined) {
        const detalhe = input.status === 'lost'
          ? ` — ${rotuloDoMotivo(input.lostReasonCode)}${input.lostReason ? `: ${input.lostReason}` : ''}`
          : input.reason ? ` — ${input.reason}` : '';

        await tx.leadInteraction.create({
          data: {
            leadId,
            tenantId,
            actorUserId: ator.id,
            kind: 'status_change' satisfies LeadInteractionKind,
            content: `Status: ${lead.status} → ${input.status}${detalhe}`,
            payload: {
              de: lead.status,
              para: input.status,
              lostReasonCode: input.lostReasonCode ?? null,
            } as never,
          },
        });
      }

      // Vincular e desvincular veículo também deixam rastro: é o histórico que
      // responde "por que este lead virou negócio do Corolla se ele ligou
      // perguntando do Onix?".
      if (input.vehicleId !== undefined && input.vehicleId !== lead.vehicleId) {
        const de = await this.descreverVeiculo(tx, lead.vehicleId);
        const para = await this.descreverVeiculo(tx, input.vehicleId);

        await tx.leadInteraction.create({
          data: {
            leadId,
            tenantId,
            actorUserId: ator.id,
            kind: 'other' satisfies LeadInteractionKind,
            content: lead.vehicleId
              ? input.vehicleId
                ? `Veículo de interesse: ${de} → ${para}`
                : `Veículo de interesse removido (era ${de})`
              : `Veículo de interesse: ${para}`,
            payload: { de: lead.vehicleId, para: input.vehicleId } as never,
          },
        });
      }

      return atualizado;
    });
  }

  /**
   * Contagem por status e por motivo de perda.
   *
   * O formato mudou de `{ new: 3, lost: 1 }` para `{ porStatus, porMotivoDePerda }`:
   * a forma antiga era um mapa aberto, e acrescentar a contagem por motivo
   * dentro dele faria `Object.values(stats).reduce(soma)` — que é como a tela
   * calcula o total — somar um objeto.
   */
  async getStats(escopo: Escopo, ator: Ator): Promise<unknown> {
    const contar = async (tx: ScopedClient, ajustes: AjustesDeCrm | null) => {
      const where = this.whereDaLista(escopo, ator, ajustes, {});

      const [porStatus, porMotivo] = await Promise.all([
        tx.lead.groupBy({ by: ['status'], where, _count: { _all: true } }),
        tx.lead.groupBy({
          by: ['lostReasonCode'],
          where: { ...where, status: 'lost' },
          _count: { _all: true },
        }),
      ]);

      const stats: Record<string, number> = {};
      for (const g of porStatus) stats[g.status] = g._count._all;

      const motivos: Record<string, number> = {};
      for (const g of porMotivo) {
        // Lead perdido antes desta funcionalidade não tem código. Agrupar como
        // "sem_motivo" é honesto; jogá-lo em "outro" inventaria um dado.
        motivos[g.lostReasonCode ?? 'sem_motivo'] = g._count._all;
      }

      return { porStatus: stats, porMotivoDePerda: motivos };
    };

    if (ehGlobal(escopo)) return contar(this.privilegiado, null);

    return this.prisma.withTenant(escopo.tenantId, async (tx) => {
      const ajustes = await this.ajustes.ler(tx, escopo.tenantId);
      return contar(tx, ajustes);
    });
  }

  /**
   * Prazo de primeiro contato por vendedor, para o relatório.
   *
   * Contrato de cada linha: `{ userId, nome, leads, respondidos,
   * tempoMedioSegundos, estourados }`. `userId` é `null` na linha da fila — os
   * leads que ninguém pegou são justamente os que mais estouram, e escondê-los
   * faria o relatório parecer melhor do que a loja é.
   *
   * Só entram leads **com prazo**: os criados antes desta funcionalidade têm
   * `firstResponseDueAt` nulo e não são cobráveis.
   */
  async slaStats(escopo: Escopo, input: SlaStatsInput): Promise<unknown> {
    if (ehGlobal(escopo)) {
      throw new ForbiddenException(
        'Selecione uma concessionária para ver o prazo de primeiro contato.',
      );
    }
    const tenantId = escopo.tenantId;
    const desde = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
    const agora = new Date();

    return this.prisma.withTenant(tenantId, async (tx) => {
      const leads = await tx.lead.findMany({
        where: { tenantId, createdAt: { gte: desde }, firstResponseDueAt: { not: null } },
        select: {
          assignedTo: true,
          createdAt: true,
          firstResponseDueAt: true,
          firstRespondedAt: true,
          assignee: { select: { fullName: true } },
        },
      });

      const porVendedor = new Map<string, {
        userId: string | null; nome: string;
        leads: number; respondidos: number; somaSegundos: number; estourados: number;
      }>();

      for (const l of leads) {
        const chave = l.assignedTo ?? '';
        const linha = porVendedor.get(chave) ?? {
          userId: l.assignedTo,
          nome: l.assignee?.fullName ?? 'Sem responsável',
          leads: 0, respondidos: 0, somaSegundos: 0, estourados: 0,
        };

        linha.leads++;
        if (l.firstRespondedAt) {
          linha.respondidos++;
          linha.somaSegundos +=
            (l.firstRespondedAt.getTime() - l.createdAt.getTime()) / 1000;
        }

        // Estourou quem respondeu depois do prazo E quem ainda não respondeu
        // com o prazo já vencido. Contar só o segundo caso premiaria quem
        // responde tarde.
        const prazo = l.firstResponseDueAt!;
        if (l.firstRespondedAt ? l.firstRespondedAt > prazo : prazo <= agora) {
          linha.estourados++;
        }

        porVendedor.set(chave, linha);
      }

      return [...porVendedor.values()]
        .map((v) => ({
          userId: v.userId,
          nome: v.nome,
          leads: v.leads,
          respondidos: v.respondidos,
          tempoMedioSegundos: v.respondidos > 0
            ? Math.round(v.somaSegundos / v.respondidos)
            : null,
          estourados: v.estourados,
        }))
        .sort((a, b) => b.leads - a.leads || a.nome.localeCompare(b.nome));
    });
  }

  /** Deleta / arquiva um lead (dealer/admin) */
  async remove(tenantId: string, leadId: string, ator: Ator): Promise<{ deleted: boolean }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const ajustes = await this.ajustes.ler(tx, tenantId);
      const lead = await tx.lead.findFirst({
        where: { id: leadId, tenantId, ...carteiraDe(ator, ajustes.vendedorVeTodosOsLeads) },
      });
      if (!lead) throw new NotFoundException('Lead não encontrado');
      await tx.lead.delete({ where: { id: leadId } });
    });
    return { deleted: true };
  }

  /**
   * Atribui lead a um vendedor.
   *
   * Passa pela carteira: sem isso um vendedor com a carteira ligada não
   * enxergaria o lead do colega na tela, mas conseguiria puxá-lo para si com
   * uma chamada direta à rota.
   */
  async assign(
    tenantId: string,
    leadId: string,
    ator: Ator,
    salesPersonId: string | null,
  ): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const ajustes = await this.ajustes.ler(tx, tenantId);
      const lead = await tx.lead.findFirst({
        where: { id: leadId, tenantId, ...carteiraDe(ator, ajustes.vendedorVeTodosOsLeads) },
      });
      if (!lead) throw new NotFoundException('Lead não encontrado');

      if (salesPersonId) {
        const sp = await tx.user.findFirst({
          where: { id: salesPersonId, tenantId, status: 'active' },
        });
        if (!sp) throw new NotFoundException('Vendedor não encontrado');
      }

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: { assignedTo: salesPersonId },
        include: { assignee: { select: { id: true, fullName: true, email: true } } },
      });

      await tx.leadInteraction.create({
        data: {
          leadId,
          tenantId,
          kind: 'assignment',
          content: salesPersonId ? `Lead atribuído` : 'Atribuição removida',
          payload: { salesPersonId } as never,
        },
      });

      return updated;
    });
  }

  /**
   * Histórico completo de um lead (timeline).
   *
   * Com a carteira ligada, o lead de outro vendedor responde **404** — e não
   * 403: confirmar que o lead existe já entrega que o colega tem um cliente
   * com aquele id, e o id circula por link.
   */
  async getHistory(tenantId: string, leadId: string, ator: Ator): Promise<unknown> {
    const lead = await this.prisma.withTenant(tenantId, async (tx) => {
      const ajustes = await this.ajustes.ler(tx, tenantId);
      return tx.lead.findFirst({
      where: { id: leadId, tenantId, ...carteiraDe(ator, ajustes.vendedorVeTodosOsLeads) },
      include: {
        vehicle: {
          select: {
            id: true, versionName: true, yearModel: true, price: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
            images: { where: { isCover: true }, take: 1, select: { url: true } },
          },
        },
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
        assignee:  { select: { id: true, fullName: true, email: true } },
        interactions: {
          orderBy: { occurredAt: 'asc' },
          include: { actor: { select: { id: true, fullName: true } } },
        },
        appointments: {
          orderBy: { scheduledStart: 'asc' },
          select: { id: true, scheduledStart: true, scheduledEnd: true, status: true, type: true, notes: true },
        },
      },
      });
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    return lead;
  }

  /**
   * Adiciona interação manual a um lead.
   *
   * `kind` chega validado pelo Zod contra `LEAD_INTERACTION_KINDS_MANUAIS` —
   * antes era `string` livre, e qualquer palavra entrava na timeline sem
   * rótulo na tela. É por aqui que o clique no WhatsApp e no telefone vira
   * registro.
   */
  async addInteraction(
    tenantId: string,
    leadId: string,
    ator: Ator,
    kind: string,
    content: string | null,
  ): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const ajustes = await this.ajustes.ler(tx, tenantId);
      const lead = await tx.lead.findFirst({
        where: { id: leadId, tenantId, ...carteiraDe(ator, ajustes.vendedorVeTodosOsLeads) },
        select: { id: true, firstRespondedAt: true },
      });
      if (!lead) throw new NotFoundException('Lead não encontrado');

      const agora = new Date();
      const interaction = await tx.leadInteraction.create({
        data: {
          leadId, tenantId, actorUserId: ator.id, kind, content,
        },
      });

      // É aqui que o prazo para de correr: a primeira interação de **saída**
      // do vendedor. Nota interna não conta — escrever sobre o cliente não é
      // falar com ele, e contá-la mediria quem digita mais. A regra vive no
      // shared (`INTERACOES_DE_PRIMEIRA_RESPOSTA`) porque a tela também a usa.
      const respondeu = await this.sla.registrarPrimeiraResposta(tx, lead, kind, agora);

      await tx.lead.update({
        where: { id: leadId },
        data: { lastActivityAt: agora },
      });

      return { ...interaction, primeiraResposta: respondeu };
    });
  }

  /**
   * Avaliação de um lead de troca: o vendedor informa quanto vale o veículo
   * oferecido. Guarda na metadata, registra na timeline e avisa o cliente.
   */
  async setTradeInAppraisal(
    tenantId: string,
    leadId: string,
    actorUserId: string,
    input: { value: number; note?: string; status?: 'offered' | 'rejected' },
  ): Promise<unknown> {
    const { lead, updated, offered } = await this.prisma.withTenant(tenantId, async (tx) => {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, tenantId },
      include: {
        tenant:  { select: { tradeName: true } },
        vehicle: {
          select: {
            price: true, versionName: true, yearModel: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
          },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (lead.source !== 'trade_in') throw new BadRequestException('Este lead não é uma proposta de troca');

    const meta = (lead.metadata && typeof lead.metadata === 'object' ? lead.metadata : {}) as Record<string, unknown>;
    const tradeIn = (meta.tradeIn && typeof meta.tradeIn === 'object' ? meta.tradeIn : {}) as Record<string, unknown>;
    const offered = (tradeIn.vehicle ?? {}) as { brandName?: string; modelName?: string; versionName?: string; yearModel?: number };

    const appraisal = {
      value: input.value,
      note: input.note ?? null,
      status: input.status ?? 'offered',
      evaluatedBy: actorUserId,
      evaluatedAt: new Date().toISOString(),
    };
    const newMeta = { ...meta, tradeIn: { ...tradeIn, appraisal } };

    const updated = await tx.lead.update({
      where: { id: leadId },
      data: {
        metadata: newMeta as Prisma.InputJsonValue,
        lastActivityAt: new Date(),
      },
    });

    await tx.leadInteraction.create({
      data: {
        leadId, tenantId, actorUserId,
        kind: 'trade_in_appraisal',
        content: input.status === 'rejected'
          ? 'Proposta de troca recusada'
          : `Veículo avaliado em R$ ${input.value.toLocaleString('pt-BR')}`,
        payload: { value: input.value, status: appraisal.status } as never,
      },
    });

      return { lead, updated, offered };
    });

    // Avisa o cliente (e-mail de contato do lead)
    if (lead.contactEmail && input.status !== 'rejected') {
      const offeredInfo = `${offered.brandName ?? ''} ${offered.modelName ?? ''} ${offered.versionName ?? ''} ${offered.yearModel ?? ''}`.replace(/\s+/g, ' ').trim();
      const desiredInfo = lead.vehicle
        ? `${lead.vehicle.brand.name} ${lead.vehicle.model.name} ${lead.vehicle.versionName ?? ''} ${lead.vehicle.yearModel}`.replace(/\s+/g, ' ').trim()
        : null;
      this.email.sendTradeInAppraisal({
        to: lead.contactEmail,
        customerName: lead.contactName ?? 'cliente',
        dealerName: lead.tenant.tradeName,
        offeredVehicle: offeredInfo || 'seu veículo',
        value: input.value,
        desiredVehicle: desiredInfo,
        desiredPrice: lead.vehicle ? Number(lead.vehicle.price) : null,
        note: input.note ?? null,
      }).catch(() => {/* silencia erros de e-mail */});
    }

    return updated;
  }

  /**
   * Exporta leads como CSV.
   *
   * Passa pelo **mesmo** `whereDaLista` da tela: um CSV que traz o que a lista
   * esconde não é um detalhe de relatório, é a carteira sendo contornada por
   * um botão.
   */
  async exportCsv(
    escopo: Escopo,
    ator: Ator,
    opts: ExportLeadsInput,
  ): Promise<string> {
    if (ehGlobal(escopo)) {
      throw new ForbiddenException('Selecione uma concessionária para exportar os leads.');
    }
    const tenantId = escopo.tenantId;

    const leads = await this.prisma.withTenant(tenantId, async (tx) => {
      const ajustes = await this.ajustes.ler(tx, tenantId);
      const where = this.whereDaLista(escopo, ator, ajustes, {
        status: opts.status,
        responsavel: opts.responsavel,
        criadoDe: opts.from ? new Date(opts.from) : undefined,
        criadoAte: opts.to ? new Date(opts.to) : undefined,
      });

      return tx.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        vehicle: { select: { versionName: true, yearModel: true, price: true, brand: { select: { name: true } }, model: { select: { name: true } } } },
        customer: { select: { fullName: true, email: true, phone: true } },
        assignee:  { select: { fullName: true } },
      },
      take: 5000,
      });
    });

    const header = [
      'ID', 'Nome', 'E-mail', 'Telefone', 'Veículo', 'Preço', 'Fonte', 'Status',
      'Vendedor', 'Motivo da perda', 'Prazo de 1º contato', 'Respondido em',
      'Mensagem', 'Criado em',
    ];
    const rows = leads.map((l) => [
      l.id,
      l.contactName ?? l.customer?.fullName ?? '',
      l.contactEmail ?? l.customer?.email ?? '',
      l.contactPhone ?? l.customer?.phone ?? '',
      l.vehicle ? `${l.vehicle.brand.name} ${l.vehicle.model.name} ${l.vehicle.versionName ?? ''} ${l.vehicle.yearModel}` : '',
      l.vehicle?.price?.toString() ?? '',
      l.source,
      l.status,
      l.assignee?.fullName ?? '',
      l.status === 'lost'
        ? `${rotuloDoMotivo(l.lostReasonCode)}${l.lostReason ? ` — ${l.lostReason}` : ''}`
        : '',
      l.firstResponseDueAt?.toISOString() ?? '',
      l.firstRespondedAt?.toISOString() ?? '',
      (l.message ?? '').replace(/[\r\n,]/g, ' '),
      l.createdAt.toISOString(),
    ]);

    return [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  }
}
