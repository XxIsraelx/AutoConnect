import { Injectable, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import type { Escopo } from '../../common/escopo';
import { EmailService } from '../../common/email/email.service';
import { FipeService } from '../fipe/fipe.service';
import { normalizarTelefoneBr } from '@autoconnect/shared';
import { AtribuicaoDeLead } from '../crm/atribuicao.service';
import type { TradeInInput } from './trade-in.schema';

/**
 * O que está na vitrine pública.
 *
 * Duas condições, não uma: `available` é sobre o estoque ("a loja ainda tem
 * este carro?") e `published` é sobre o anúncio ("a loja mandou pôr no ar?").
 * Antes bastava a primeira, e por isso todo veículo cadastrado estreava sozinho
 * — sem foto, com o preço que o vendedor ainda ia conferir.
 *
 * Fica numa constante para que toda consulta pública use a mesma definição: o
 * modo como o rascunho volta a vazar é alguém escrever o filtro de novo, à mão,
 * numa consulta nova. A policy `leitura_publica` repete a mesma dupla no banco.
 */
const NA_VITRINE = {
  status: 'available',
  listingStatus: 'published',
} as const;

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly fipe: FipeService,
    /**
     * Dono e relógio do lead — o mesmo serviço que o formulário de interesse e
     * o cadastro manual usam. É o que tira o lead de troca da segunda classe.
     */
    private readonly atribuicao: AtribuicaoDeLead,
  ) {}

  findBrands() {
    return this.prisma.vehicleBrand.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, logoUrl: true },
    });
  }

  findModelsByBrand(brandId: string) {
    return this.prisma.vehicleModel.findMany({
      where: { brandId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, category: true },
    });
  }

  /**
   * Cria (ou reaproveita) uma marca pelo nome.
   *
   * Roda em `withTenant` porque a policy `catalogo_insercao` exige
   * `app.tenant_id`: o catálogo é compartilhado, e a inserção só é permitida a
   * concessionária autenticada. Sem contexto, o INSERT era recusado sob
   * `autoconnect_app` — ou seja, em produção — e a loja nova não conseguia
   * cadastrar o primeiro veículo de uma marca que ainda não existisse. Como
   * dono do banco, em desenvolvimento, passava.
   */
  async createBrand(escopo: Escopo, name: string) {
    const clean = name.trim();
    if (clean.length < 1) throw new NotFoundException('Nome da marca inválido');

    return this.comCatalogo(escopo, async (tx) => {
      const existing = await tx.vehicleBrand.findFirst({
        where: { name: { equals: clean, mode: 'insensitive' } },
        select: { id: true, name: true, logoUrl: true },
      });
      if (existing) return existing;

      return tx.vehicleBrand.create({
        data: { name: clean },
        select: { id: true, name: true, logoUrl: true },
      });
    });
  }

  /** Cria (ou reaproveita) um modelo dentro de uma marca. Mesma regra da marca. */
  async createModel(escopo: Escopo, brandId: string, name: string, category?: string) {
    const clean = name.trim();
    if (clean.length < 1) throw new NotFoundException('Nome do modelo inválido');

    return this.comCatalogo(escopo, async (tx) => {
      const brand = await tx.vehicleBrand.findUnique({ where: { id: brandId } });
      if (!brand) throw new NotFoundException('Marca não encontrada');

      const existing = await tx.vehicleModel.findFirst({
        where: { brandId, name: { equals: clean, mode: 'insensitive' } },
        select: { id: true, name: true, category: true },
      });
      if (existing) return existing;

      return tx.vehicleModel.create({
        data: { brandId, name: clean, category: category ?? null },
        select: { id: true, name: true, category: true },
      });
    });
  }

  /**
   * Contexto da escrita no catálogo compartilhado.
   *
   * Super admin não tem loja, e a policy pede uma: sem `tenant_id` não há o que
   * inserir. Quem administra o catálogo global tem o painel de admin para isso.
   */
  private comCatalogo<T>(escopo: Escopo, fn: (tx: ScopedClient) => Promise<T>): Promise<T> {
    if (escopo.tipo !== 'tenant') {
      throw new ForbiddenException(
        'Cadastro de marca e modelo é feito por uma concessionária.',
      );
    }
    return this.prisma.withTenant(escopo.tenantId, fn);
  }

  /** Perfil público de uma concessionária */
  findPublicDealer(tenantId: string): Promise<unknown> {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId, isActive: true },
      select: {
        id: true,
        tradeName: true,
        logoUrl: true,
        brandColor: true,
        websiteUrl: true,
        primaryPhone: true,
        acceptsTradeIn: true,
        branches: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: {
            id: true,
            name: true,
            city: true,
            state: true,
            addressLine: true,
            addressNumber: true,
            phone: true,
            email: true,
            latitude: true,
            longitude: true,
            // O modal de agendamento precisa dele para só oferecer horário em
            // que a loja abre — sem isso a tela oferecia 08:00–18:30 todo dia,
            // inclusive domingo.
            businessHours: true,
          },
        },
      },
    });
  }

  /** Detalhe completo de um veículo público */
  findPublicVehicle(vehicleId: string): Promise<unknown> {
    return this.prisma.withPublic((tx) =>
      tx.vehicle.findFirst({
      where: { id: vehicleId, ...NA_VITRINE },
      select: {
        id: true,
        versionName: true,
        yearModel: true,
        yearMake: true,
        price: true,
        promoPrice: true,
        mileageKm: true,
        condition: true,
        color: true,
        fuel: true,
        transmission: true,
        engine: true,
        doors: true,
        description: true,
        tenantId: true,
        brand: { select: { id: true, name: true, logoUrl: true } },
        model: { select: { id: true, name: true, category: true } },
        images: {
          orderBy: [{ isCover: 'desc' }, { position: 'asc' }],
          select: { id: true, url: true, altText: true, isCover: true, position: true },
        },
      },
      }),
    );
  }

  /** Catálogo público paginado — usado na página /catalogo/[id] e na busca global */
  async findPublicVehicles(opts: {
    tenantId?: string;
    q?: string;
    brandId?: string;
    condition?: string;
    fuel?: string;
    transmission?: string;
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    minYear?: number;
    maxYear?: number;
    maxKm?: number;
    sort?: string;
    limit?: number;
    skip?: number;
  }): Promise<unknown> {
    const {
      tenantId, q, brandId, condition, fuel, transmission, category,
      minPrice, maxPrice, minYear, maxYear, maxKm, sort,
      limit = 12, skip = 0,
    } = opts;

    const priceFilter =
      minPrice !== undefined || maxPrice !== undefined
        ? { price: { ...(minPrice !== undefined ? { gte: minPrice } : {}), ...(maxPrice !== undefined ? { lte: maxPrice } : {}) } }
        : {};
    const yearFilter =
      minYear !== undefined || maxYear !== undefined
        ? { yearModel: { ...(minYear !== undefined ? { gte: minYear } : {}), ...(maxYear !== undefined ? { lte: maxYear } : {}) } }
        : {};
    const kmFilter = maxKm !== undefined ? { mileageKm: { lte: maxKm } } : {};

    const where = {
      ...NA_VITRINE,
      ...(tenantId  ? { tenantId }  : {}),
      ...(brandId   ? { brandId }   : {}),
      ...(condition ? { condition: condition as 'new' | 'used' | 'semi_new' | 'demo' } : {}),
      ...(fuel         ? { fuel: fuel as never } : {}),
      ...(transmission ? { transmission: transmission as never } : {}),
      ...(category     ? { model: { is: { category } } } : {}),
      ...priceFilter,
      ...yearFilter,
      ...kmFilter,
      ...(q
        ? {
            OR: [
              { versionName: { contains: q, mode: 'insensitive' as const } },
              { brand: { name: { contains: q, mode: 'insensitive' as const } } },
              { model: { name: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const orderBy =
      sort === 'price_asc'  ? { price: 'asc' as const }
    : sort === 'price_desc' ? { price: 'desc' as const }
    : sort === 'year_desc'  ? { yearModel: 'desc' as const }
    : sort === 'km_asc'     ? { mileageKm: 'asc' as const }
    : { createdAt: 'desc' as const };

    const select = {
      id: true,
      versionName: true,
      yearModel: true,
      yearMake: true,
      price: true,
      promoPrice: true,
      mileageKm: true,
      condition: true,
      color: true,
      tenantId: true,
      brand: { select: { id: true, name: true, logoUrl: true } },
      fuel: true,
      transmission: true,
      model: { select: { id: true, name: true, category: true } },
      images: {
        where: { isCover: true },
        take: 1,
        select: { url: true },
      },
    };

    const [items, total] = await this.prisma.withPublic((tx) =>
      Promise.all([
        tx.vehicle.findMany({ where, take: limit, skip, orderBy, select }),
        tx.vehicle.count({ where }),
      ]),
    );

    return { items, total };
  }

  /* ── Buscas salvas ───────────────────────────────────────── */

  /** Monta o where de veículo a partir de um objeto de filtros salvo */
  private vehicleWhereFromFilters(f: Record<string, unknown>) {
    const num = (v: unknown) => (typeof v === 'number' ? v : v ? Number(v) : undefined);
    const minPrice = num(f.minPrice), maxPrice = num(f.maxPrice);
    const minYear  = num(f.minYear),  maxYear  = num(f.maxYear);
    const maxKm    = num(f.maxKm);

    return {
      ...NA_VITRINE,
      ...(f.brandId      ? { brandId: f.brandId as string } : {}),
      ...(f.condition    ? { condition: f.condition as never } : {}),
      ...(f.fuel         ? { fuel: f.fuel as never } : {}),
      ...(f.transmission ? { transmission: f.transmission as never } : {}),
      ...(f.category     ? { model: { is: { category: f.category as string } } } : {}),
      ...(minPrice !== undefined || maxPrice !== undefined
        ? { price: { ...(minPrice !== undefined ? { gte: minPrice } : {}), ...(maxPrice !== undefined ? { lte: maxPrice } : {}) } } : {}),
      ...(minYear !== undefined || maxYear !== undefined
        ? { yearModel: { ...(minYear !== undefined ? { gte: minYear } : {}), ...(maxYear !== undefined ? { lte: maxYear } : {}) } } : {}),
      ...(maxKm !== undefined ? { mileageKm: { lte: maxKm } } : {}),
      ...(f.q
        ? {
            OR: [
              { versionName: { contains: f.q as string, mode: 'insensitive' as const } },
              { brand: { name: { contains: f.q as string, mode: 'insensitive' as const } } },
              { model: { name: { contains: f.q as string, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
  }

  async listSavedSearches(userId: string): Promise<unknown> {
    const searches = await this.prisma.withUser(userId, (tx) =>
      tx.savedSearch.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
    );

    return Promise.all(
      searches.map(async (s) => {
        const where = this.vehicleWhereFromFilters((s.filters ?? {}) as Record<string, unknown>);
        const newCount = await this.prisma.withPublic((tx) =>
          tx.vehicle.count({ where: { ...where, createdAt: { gt: s.lastViewedAt } } }),
        );
        return {
          id: s.id,
          name: s.name,
          filters: s.filters,
          lastViewedAt: s.lastViewedAt,
          createdAt: s.createdAt,
          newCount,
        };
      }),
    );
  }

  async createSavedSearch(userId: string, name: string, filters: Record<string, unknown>): Promise<unknown> {
    return this.prisma.withUser(userId, (tx) =>
      tx.savedSearch.create({
        data: { userId, name: name.trim() || 'Busca sem nome', filters: filters as never },
      }),
    );
  }

  async deleteSavedSearch(userId: string, id: string): Promise<{ deleted: boolean }> {
    await this.prisma.withUser(userId, async (tx) => {
      const s = await tx.savedSearch.findFirst({ where: { id, userId } });
      if (!s) throw new NotFoundException('Busca não encontrada');
      await tx.savedSearch.delete({ where: { id } });
    });
    return { deleted: true };
  }

  async markSavedSearchViewed(userId: string, id: string): Promise<unknown> {
    return this.prisma.withUser(userId, async (tx) => {
      const s = await tx.savedSearch.findFirst({ where: { id, userId } });
      if (!s) throw new NotFoundException('Busca não encontrada');
      return tx.savedSearch.update({ where: { id }, data: { lastViewedAt: new Date() } });
    });
  }

  /* ── Favoritos ───────────────────────────────────────────── */

  async getFavoriteIds(userId: string): Promise<unknown> {
    const favs = await this.prisma.withUser(userId, (tx) =>
      tx.customerFavorite.findMany({ where: { userId }, select: { vehicleId: true } }),
    );
    return favs.map((f) => f.vehicleId);
  }

  async addFavorite(userId: string, vehicleId: string): Promise<unknown> {
    try {
      return await this.prisma.withUser(userId, (tx) =>
        tx.customerFavorite.create({ data: { userId, vehicleId } }),
      );
    } catch {
      // Ignora duplicate (já favoritado)
      return { userId, vehicleId };
    }
  }

  async removeFavorite(userId: string, vehicleId: string): Promise<{ deleted: boolean }> {
    await this.prisma.withUser(userId, (tx) =>
      tx.customerFavorite.deleteMany({ where: { userId, vehicleId } }),
    );
    return { deleted: true };
  }

  /** Favoritos completos com dados do veículo (para /perfil) */
  async getFavorites(userId: string): Promise<unknown> {
    return this.prisma.withUser(userId, (tx) =>
      tx.customerFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        vehicle: {
          select: {
            id: true, versionName: true, yearModel: true, price: true, promoPrice: true,
            condition: true, mileageKm: true, tenantId: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
            images: { where: { isCover: true }, take: 1, select: { url: true } },
          },
        },
      },
      }),
    );
  }

  /* ── Vistos recentemente ─────────────────────────────────── */

  /** Registra uma visualização de veículo por um usuário */
  async recordView(userId: string, vehicleId: string): Promise<{ ok: boolean }> {
    const v = await this.prisma.withPublic((tx) =>
      tx.vehicle.findUnique({ where: { id: vehicleId }, select: { tenantId: true } }),
    );
    if (!v) return { ok: false };

    // A visita pertence à loja do veículo e ao usuário que visitou: precisa dos
    // dois contextos para satisfazer `tenant_isolation` e `acesso_cliente`.
    await this.prisma.withTenantAndUser(v.tenantId, userId, (tx) =>
      tx.vehicleView.create({ data: { vehicleId, tenantId: v.tenantId, userId, source: 'web' } }),
    );
    return { ok: true };
  }

  /** Lista os veículos vistos recentemente (distintos, mais recentes primeiro) */
  async recentlyViewed(userId: string): Promise<unknown> {
    const views = await this.prisma.withUser(userId, (tx) =>
      tx.vehicleView.findMany({
        where: { userId },
        orderBy: { viewedAt: 'desc' },
        take: 60,
        select: { vehicleId: true },
      }),
    );
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const v of views) {
      if (!seen.has(v.vehicleId)) { seen.add(v.vehicleId); ids.push(v.vehicleId); }
      if (ids.length >= 12) break;
    }
    if (ids.length === 0) return [];

    const vehicles = await this.prisma.withPublic((tx) =>
      tx.vehicle.findMany({
      where: { id: { in: ids }, ...NA_VITRINE },
      select: {
        id: true, versionName: true, yearModel: true, price: true, promoPrice: true,
        condition: true, mileageKm: true, tenantId: true,
        brand: { select: { name: true } },
        model: { select: { name: true } },
        images: { where: { isCover: true }, take: 1, select: { url: true } },
      },
      }),
    );
    // preserva a ordem de visualização
    return ids.map((id) => vehicles.find((v) => v.id === id)).filter(Boolean);
  }

  /** Perfil público por slug */
  findPublicDealerBySlug(slug: string): Promise<unknown> {
    return this.prisma.tenant.findUnique({
      where: { slug, isActive: true },
      select: {
        id: true, slug: true,
        tradeName: true,
        logoUrl: true,
        brandColor: true,
        websiteUrl: true,
        primaryPhone: true,
        acceptsTradeIn: true,
        branches: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: {
            id: true, name: true,
            city: true, state: true,
            addressLine: true, addressNumber: true, neighborhood: true, postalCode: true,
            phone: true, email: true,
            latitude: true, longitude: true,
            businessHours: true,
          },
        },
      },
    });
  }

  /* ── Alertas de preço ──────────────────────────────────── */

  async getPriceAlerts(userId: string): Promise<unknown> {
    return this.prisma.withUser(userId, (tx) =>
      tx.priceAlert.findMany({
      where: { userId, isActive: true },
      include: {
        vehicle: {
          select: {
            id: true, versionName: true, yearModel: true, price: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
            images: { where: { isCover: true }, take: 1, select: { url: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async createPriceAlert(userId: string, vehicleId: string, targetPrice: number): Promise<unknown> {
    const vehicle = await this.prisma.withPublic((tx) =>
      tx.vehicle.findUnique({ where: { id: vehicleId } }),
    );
    if (!vehicle) throw new NotFoundException('Veículo não encontrado');

    return this.prisma.withUser(userId, (tx) =>
      tx.priceAlert.upsert({
        where: { userId_vehicleId: { userId, vehicleId } },
        update: { targetPrice, isActive: true, triggeredAt: null },
        create: { userId, vehicleId, targetPrice },
      }),
    );
  }

  async removePriceAlert(userId: string, vehicleId: string): Promise<{ deleted: boolean }> {
    await this.prisma.withUser(userId, (tx) =>
      tx.priceAlert.deleteMany({ where: { userId, vehicleId } }),
    );
    return { deleted: true };
  }

  /* ── Trade-in (oferta de veículo na troca) ────────────────── */

  /**
   * Cliente oferece um veículo próprio para abater o valor de uma compra.
   * Só funciona se a concessionária aceitar troca. Vira um Lead (source
   * trade_in) com os dados do carro na metadata, mais uma referência FIPE
   * automática para ajudar o vendedor na avaliação.
   */
  async createTradeIn(input: TradeInInput): Promise<{ ok: true }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId, isActive: true },
      select: {
        tradeName: true,
        acceptsTradeIn: true,
        branches: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { email: true },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Concessionária não encontrada');
    if (!tenant.acceptsTradeIn) {
      throw new ForbiddenException('Esta concessionária não aceita troca no momento');
    }

    // Referência FIPE automática do carro oferecido (não bloqueante se falhar)
    let fipeReference: number | null = null;
    try {
      const est = await this.fipe.estimate({
        brandName: input.vehicle.brandName,
        modelName: input.vehicle.modelName,
        versionName: input.vehicle.versionName,
        yearModel: input.vehicle.yearModel,
        fuel: input.vehicle.fuel,
      });
      fipeReference = est?.price ?? null;
    } catch (err) {
      this.logger.warn(`FIPE indisponível para trade-in: ${err}`);
    }

    // Veículo desejado (opcional) — para contextualizar o abatimento
    let desiredVehicleInfo: string | null = null;
    if (input.desiredVehicleId) {
      const v = await this.prisma.withPublic((tx) =>
        tx.vehicle.findUnique({
          where: { id: input.desiredVehicleId },
          select: {
            versionName: true, yearModel: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
          },
        }),
      );
      if (v) {
        desiredVehicleInfo = `${v.brand.name} ${v.model.name} ${v.versionName ?? ''} ${v.yearModel}`.replace(/\s+/g, ' ').trim();
      }
    }

    const tradeInMeta = {
      vehicle: input.vehicle,
      expectedValue: input.expectedValue ?? null,
      fipeReference,
      appraisal: { status: 'pending' as const },
    };

    /**
     * O lead de troca entra pelo mesmo caminho dos outros.
     *
     * Antes ele nascia sem responsável, sem prazo de primeira resposta, sem
     * consentimento e sem telefone canônico — um lead de segunda classe
     * justamente no pedido mais valioso de uma revenda. Sem prazo ele nunca
     * estourava, então o gerente nunca era avisado de que estava sendo
     * ignorado.
     *
     * **Não** passa pela deduplicação, e isso é decisão registrada: quem
     * oferece dois carros na troca fez duas propostas, cada uma com placa,
     * quilometragem e valor próprios. Fundi-las num lead só perderia a segunda
     * avaliação — o oposto do que a deduplicação existe para fazer no
     * formulário de interesse, onde o segundo envio é a mesma intenção
     * repetida.
     */
    await this.prisma.withTenant(input.tenantId, async (tx) => {
      const criadoEm = new Date();
      const distribuicao = await this.atribuicao.distribuirEAgendar(tx, input.tenantId, {
        criadoEm,
      });

      const lead = await tx.lead.create({
        data: {
          tenantId: input.tenantId,
          vehicleId: input.desiredVehicleId ?? null,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          contactPhoneNormalized: normalizarTelefoneBr(input.contactPhone),
          source: 'trade_in',
          status: 'new',
          message: input.message ?? null,
          assignedTo: distribuicao.assignedTo,
          firstResponseDueAt: distribuicao.firstResponseDueAt,
          consentedAt: criadoEm,
          consentText: input.consentText,
          metadata: { tradeIn: tradeInMeta } as Prisma.InputJsonValue,
        },
      });

      await this.atribuicao.registrarNaTimeline(tx, input.tenantId, lead.id, {
        // Sem ator: não há usuário da loja por trás do envio, e inventar um
        // atribuiria a alguém o que o visitante fez.
        actorUserId: null,
        comoChegou: 'formulário de troca do catálogo',
        criadoEm,
        distribuicao,
      });
    });

    const offered = `${input.vehicle.brandName} ${input.vehicle.modelName} ${input.vehicle.versionName ?? ''} ${input.vehicle.yearModel}`.replace(/\s+/g, ' ').trim();
    const dealerEmail = tenant.branches[0]?.email;
    if (dealerEmail) {
      this.email.sendTradeInReceived({
        to: dealerEmail,
        dealerName: tenant.tradeName,
        customerName: input.contactName,
        offeredVehicle: offered,
        desiredVehicle: desiredVehicleInfo,
        fipeReference,
        expectedValue: input.expectedValue ?? null,
      }).catch((err) => this.logger.warn(`Falha ao notificar troca: ${err}`));
    }

    return { ok: true };
  }
}
