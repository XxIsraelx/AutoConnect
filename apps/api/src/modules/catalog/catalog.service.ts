import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

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

  /** Cria (ou reaproveita) uma marca pelo nome */
  async createBrand(name: string) {
    const clean = name.trim();
    if (clean.length < 1) throw new NotFoundException('Nome da marca inválido');

    const existing = await this.prisma.vehicleBrand.findFirst({
      where: { name: { equals: clean, mode: 'insensitive' } },
      select: { id: true, name: true, logoUrl: true },
    });
    if (existing) return existing;

    return this.prisma.vehicleBrand.create({
      data: { name: clean },
      select: { id: true, name: true, logoUrl: true },
    });
  }

  /** Cria (ou reaproveita) um modelo dentro de uma marca */
  async createModel(brandId: string, name: string, category?: string) {
    const clean = name.trim();
    if (clean.length < 1) throw new NotFoundException('Nome do modelo inválido');

    const brand = await this.prisma.vehicleBrand.findUnique({ where: { id: brandId } });
    if (!brand) throw new NotFoundException('Marca não encontrada');

    const existing = await this.prisma.vehicleModel.findFirst({
      where: { brandId, name: { equals: clean, mode: 'insensitive' } },
      select: { id: true, name: true, category: true },
    });
    if (existing) return existing;

    return this.prisma.vehicleModel.create({
      data: { brandId, name: clean, category: category ?? null },
      select: { id: true, name: true, category: true },
    });
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
          },
        },
      },
    });
  }

  /** Detalhe completo de um veículo público */
  findPublicVehicle(vehicleId: string): Promise<unknown> {
    return this.prisma.vehicle.findFirst({
      where: { id: vehicleId, status: 'available' },
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
    });
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
      status: 'available' as const,
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

    const [items, total] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({ where, take: limit, skip, orderBy, select }),
      this.prisma.vehicle.count({ where }),
    ]);

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
      status: 'available' as const,
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
    const searches = await this.prisma.savedSearch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      searches.map(async (s) => {
        const where = this.vehicleWhereFromFilters((s.filters ?? {}) as Record<string, unknown>);
        const newCount = await this.prisma.vehicle.count({
          where: { ...where, createdAt: { gt: s.lastViewedAt } },
        });
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
    return this.prisma.savedSearch.create({
      data: { userId, name: name.trim() || 'Busca sem nome', filters: filters as never },
    });
  }

  async deleteSavedSearch(userId: string, id: string): Promise<{ deleted: boolean }> {
    const s = await this.prisma.savedSearch.findFirst({ where: { id, userId } });
    if (!s) throw new NotFoundException('Busca não encontrada');
    await this.prisma.savedSearch.delete({ where: { id } });
    return { deleted: true };
  }

  async markSavedSearchViewed(userId: string, id: string): Promise<unknown> {
    const s = await this.prisma.savedSearch.findFirst({ where: { id, userId } });
    if (!s) throw new NotFoundException('Busca não encontrada');
    return this.prisma.savedSearch.update({ where: { id }, data: { lastViewedAt: new Date() } });
  }

  /* ── Favoritos ───────────────────────────────────────────── */

  async getFavoriteIds(userId: string): Promise<unknown> {
    const favs = await this.prisma.customerFavorite.findMany({
      where: { userId },
      select: { vehicleId: true },
    });
    return favs.map((f) => f.vehicleId);
  }

  async addFavorite(userId: string, vehicleId: string): Promise<unknown> {
    try {
      return await this.prisma.customerFavorite.create({
        data: { userId, vehicleId },
      });
    } catch {
      // Ignora duplicate (já favoritado)
      return { userId, vehicleId };
    }
  }

  async removeFavorite(userId: string, vehicleId: string): Promise<{ deleted: boolean }> {
    await this.prisma.customerFavorite.deleteMany({
      where: { userId, vehicleId },
    });
    return { deleted: true };
  }

  /** Favoritos completos com dados do veículo (para /perfil) */
  async getFavorites(userId: string): Promise<unknown> {
    return this.prisma.customerFavorite.findMany({
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
    });
  }

  /* ── Vistos recentemente ─────────────────────────────────── */

  /** Registra uma visualização de veículo por um usuário */
  async recordView(userId: string, vehicleId: string): Promise<{ ok: boolean }> {
    const v = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId }, select: { tenantId: true },
    });
    if (!v) return { ok: false };
    await this.prisma.vehicleView.create({
      data: { vehicleId, tenantId: v.tenantId, userId, source: 'web' },
    });
    return { ok: true };
  }

  /** Lista os veículos vistos recentemente (distintos, mais recentes primeiro) */
  async recentlyViewed(userId: string): Promise<unknown> {
    const views = await this.prisma.vehicleView.findMany({
      where: { userId },
      orderBy: { viewedAt: 'desc' },
      take: 60,
      select: { vehicleId: true },
    });
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const v of views) {
      if (!seen.has(v.vehicleId)) { seen.add(v.vehicleId); ids.push(v.vehicleId); }
      if (ids.length >= 12) break;
    }
    if (ids.length === 0) return [];

    const vehicles = await this.prisma.vehicle.findMany({
      where: { id: { in: ids }, status: 'available' },
      select: {
        id: true, versionName: true, yearModel: true, price: true, promoPrice: true,
        condition: true, mileageKm: true, tenantId: true,
        brand: { select: { name: true } },
        model: { select: { name: true } },
        images: { where: { isCover: true }, take: 1, select: { url: true } },
      },
    });
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
          },
        },
      },
    });
  }

  /* ── Alertas de preço ──────────────────────────────────── */

  async getPriceAlerts(userId: string): Promise<unknown> {
    return this.prisma.priceAlert.findMany({
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
    });
  }

  async createPriceAlert(userId: string, vehicleId: string, targetPrice: number): Promise<unknown> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Veículo não encontrado');

    return this.prisma.priceAlert.upsert({
      where: { userId_vehicleId: { userId, vehicleId } },
      update: { targetPrice, isActive: true, triggeredAt: null },
      create: { userId, vehicleId, targetPrice },
    });
  }

  async removePriceAlert(userId: string, vehicleId: string): Promise<{ deleted: boolean }> {
    await this.prisma.priceAlert.deleteMany({ where: { userId, vehicleId } });
    return { deleted: true };
  }
}
