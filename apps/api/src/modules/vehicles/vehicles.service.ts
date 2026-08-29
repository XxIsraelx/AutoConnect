import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { Prisma } from '@autoconnect/db';
import type { CreateVehicleInput, UpdateVehicleInput, VehicleQuery } from '@autoconnect/shared';
import type { ImportRow } from './import.schema';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async findAll(tenantId: string, query: VehicleQuery): Promise<unknown> {
    const { q, brandId, modelId, minPrice, maxPrice, minYear, condition, status, page, perPage } = query;
    const skip = (page - 1) * perPage;

    const where = {
      tenantId,
      ...(brandId && { brandId }),
      ...(modelId && { modelId }),
      ...(condition && { condition }),
      ...(status && { status }),
      ...(minPrice !== undefined || maxPrice !== undefined
        ? { price: { ...(minPrice !== undefined ? { gte: minPrice } : {}), ...(maxPrice !== undefined ? { lte: maxPrice } : {}) } }
        : {}),
      ...(minYear !== undefined ? { yearModel: { gte: minYear } } : {}),
      ...(q
        ? {
            OR: [
              { versionName: { contains: q, mode: 'insensitive' as const } },
              { description: { contains: q, mode: 'insensitive' as const } },
              { brand: { name: { contains: q, mode: 'insensitive' as const } } },
              { model: { name: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        tx.vehicle.findMany({
          where,
          skip,
          take: perPage,
          orderBy: { createdAt: 'desc' },
          include: {
            brand: { select: { id: true, name: true, logoUrl: true } },
            model: { select: { id: true, name: true, category: true } },
            images: { where: { isCover: true }, take: 1, select: { url: true } },
          },
        }),
        tx.vehicle.count({ where }),
      ]),
    );

    return {
      items,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const vehicle = await this.prisma.withTenant(tenantId, (tx) =>
      tx.vehicle.findFirst({
        where: { id, tenantId },
        include: {
          brand: true,
          model: true,
          images: { orderBy: { position: 'asc' } },
          featureLinks: { include: { feature: true } },
        },
      }),
    );
    if (!vehicle) throw new NotFoundException('Veículo não encontrado');
    return vehicle;
  }

  async create(tenantId: string, input: CreateVehicleInput): Promise<unknown> {
    const {
      featureIds,
      previousOwners,
      firstRegistration,
      singleOwner,
      ...data
    } = input;

    // Campos de histórico de uso vão para metadata (JSON)
    const metadata: Record<string, unknown> = {};
    if (previousOwners !== undefined) metadata.previousOwners = previousOwners;
    if (firstRegistration) metadata.firstRegistration = firstRegistration;
    if (singleOwner !== undefined) metadata.singleOwner = singleOwner;

    return this.prisma.withTenant(tenantId, (tx) =>
      tx.vehicle.create({
        data: {
          ...data,
          tenantId,
          price: data.price,
          ...(Object.keys(metadata).length
            ? { metadata: metadata as Prisma.InputJsonValue }
            : {}),
          ...(featureIds.length
            ? { featureLinks: { create: featureIds.map((featureId) => ({ featureId })) } }
            : {}),
        },
        include: {
          brand: { select: { id: true, name: true } },
          model: { select: { id: true, name: true } },
        },
      }),
    );
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateVehicleInput,
    actorUserId?: string,
  ): Promise<unknown> {
    const existing = (await this.findOne(tenantId, id)) as {
      metadata?: Record<string, unknown>;
      price: Prisma.Decimal;
      promoPrice: Prisma.Decimal | null;
    };
    const {
      featureIds,
      previousOwners,
      firstRegistration,
      singleOwner,
      ...data
    } = input;

    // Mescla histórico de uso com metadata existente
    const prevMeta = existing?.metadata ?? {};
    const metadata: Record<string, unknown> = { ...prevMeta };
    if (previousOwners !== undefined) metadata.previousOwners = previousOwners;
    if (firstRegistration !== undefined) metadata.firstRegistration = firstRegistration;
    if (singleOwner !== undefined) metadata.singleOwner = singleOwner;
    const metaChanged =
      previousOwners !== undefined ||
      firstRegistration !== undefined ||
      singleOwner !== undefined;

    // Snapshot do preço anterior para histórico/alertas
    const prevPrice = Number(existing.price);
    const prevPromo = existing.promoPrice != null ? Number(existing.promoPrice) : null;

    const updated = await this.prisma.withTenant(tenantId, async (tx) => {
      if (featureIds !== undefined) {
        await tx.vehicleFeatureLink.deleteMany({ where: { vehicleId: id } });
      }
      const v = await tx.vehicle.update({
        where: { id },
        data: {
          ...data,
          ...(metaChanged ? { metadata: metadata as Prisma.InputJsonValue } : {}),
          ...(featureIds?.length
            ? { featureLinks: { create: featureIds.map((featureId) => ({ featureId })) } }
            : {}),
        },
        include: {
          brand: { select: { id: true, name: true } },
          model: { select: { id: true, name: true } },
        },
      });

      // Histórico de preço: grava quando preço ou promocional mudam
      const newPrice = Number(v.price);
      const newPromo = v.promoPrice != null ? Number(v.promoPrice) : null;
      if (newPrice !== prevPrice || newPromo !== prevPromo) {
        await tx.vehicleHistory.create({
          data: {
            vehicleId: id,
            tenantId,
            eventType: 'price_change',
            actorUserId: actorUserId ?? null,
            payload: { fromPrice: prevPrice, toPrice: newPrice, fromPromo: prevPromo, toPromo: newPromo },
          },
        });
      }
      return v;
    });

    // Alertas de preço (fora da transação por tenant — PriceAlert é do cliente)
    await this.triggerPriceAlerts(tenantId, updated).catch((err) =>
      this.logger.warn(`Falha ao disparar alertas de preço do veículo ${id}: ${err}`),
    );

    return updated;
  }

  /**
   * Notifica clientes que criaram alerta para este veículo quando o preço
   * efetivo (promocional, se houver) cai até o valor-alvo. Marca triggeredAt
   * para não reenviar o mesmo alerta.
   */
  private async triggerPriceAlerts(
    tenantId: string,
    vehicle: {
      id: string;
      price: Prisma.Decimal;
      promoPrice: Prisma.Decimal | null;
      versionName: string | null;
      brand: { name: string };
      model: { name: string };
    },
  ): Promise<void> {
    const effective = vehicle.promoPrice != null ? Number(vehicle.promoPrice) : Number(vehicle.price);

    const alerts = await this.prisma.priceAlert.findMany({
      where: {
        vehicleId: vehicle.id,
        isActive: true,
        triggeredAt: null,
        targetPrice: { gte: effective },
      },
      include: { user: { select: { email: true, fullName: true } } },
    });
    if (alerts.length === 0) return;

    const info = `${vehicle.brand.name} ${vehicle.model.name}${vehicle.versionName ? ` ${vehicle.versionName}` : ''}`;
    const link = `${process.env.WEB_URL ?? 'http://localhost:3000'}/catalogo/${tenantId}?v=${vehicle.id}`;

    for (const alert of alerts) {
      try {
        await this.email.sendPriceDropAlert({
          to: alert.user.email,
          name: alert.user.fullName ?? 'cliente',
          vehicleInfo: info,
          price: effective,
          target: Number(alert.targetPrice),
          link,
        });
        await this.prisma.priceAlert.update({
          where: { id: alert.id },
          data: { triggeredAt: new Date() },
        });
      } catch (err) {
        this.logger.warn(`Falha ao notificar alerta ${alert.id}: ${err}`);
      }
    }
  }

  /** Linha do tempo de eventos do veículo (ex: mudanças de preço) */
  async getHistory(tenantId: string, id: string): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.vehicleHistory.findMany({
        where: { vehicleId: id, tenantId },
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { fullName: true } } },
      }),
    );
  }

  /**
   * Importação em lote: resolve marca/modelo por nome (criando quando não
   * existem, case-insensitive) e insere os veículos numa única transação.
   */
  async importMany(tenantId: string, rows: ImportRow[]) {
    return this.prisma.$transaction(async (tx) => {
      // Resolve marcas únicas por nome normalizado
      const brandIdByKey = new Map<string, string>();
      for (const name of new Set(rows.map((r) => r.brandName.trim()))) {
        const key = name.toLowerCase();
        const existing = await tx.vehicleBrand.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        });
        brandIdByKey.set(
          key,
          existing?.id ?? (await tx.vehicleBrand.create({ data: { name }, select: { id: true } })).id,
        );
      }

      // Resolve modelos únicos por (marca, nome)
      const modelIdByKey = new Map<string, string>();
      const modelPairs = new Set(rows.map((r) => `${r.brandName.trim().toLowerCase()}|${r.modelName.trim()}`));
      for (const pair of modelPairs) {
        const [brandKey, modelName] = pair.split('|');
        const brandId = brandIdByKey.get(brandKey)!;
        const existing = await tx.vehicleModel.findFirst({
          where: { brandId, name: { equals: modelName, mode: 'insensitive' } },
          select: { id: true },
        });
        modelIdByKey.set(
          `${brandKey}|${modelName.toLowerCase()}`,
          existing?.id ?? (await tx.vehicleModel.create({ data: { brandId, name: modelName }, select: { id: true } })).id,
        );
      }

      const created = await tx.vehicle.createMany({
        data: rows.map(({ brandName, modelName, ...rest }) => ({
          ...rest,
          tenantId,
          brandId: brandIdByKey.get(brandName.trim().toLowerCase())!,
          modelId: modelIdByKey.get(`${brandName.trim().toLowerCase()}|${modelName.trim().toLowerCase()}`)!,
        })),
      });

      return { imported: created.count };
    }, { timeout: 30_000 });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.vehicle.delete({ where: { id } }),
    );
    return { deleted: true };
  }

  /* ── Imagens ─────────────────────────────────────────────── */

  async addImage(
    tenantId: string,
    vehicleId: string,
    data: { url: string; altText?: string; isCover?: boolean; position?: number },
  ): Promise<unknown> {
    await this.findOne(tenantId, vehicleId);

    // Se for capa, desmarca as anteriores
    if (data.isCover) {
      await this.prisma.vehicleImage.updateMany({
        where: { vehicleId, tenantId },
        data: { isCover: false },
      });
    }

    // Calcula próxima posição
    const lastImg = await this.prisma.vehicleImage.findFirst({
      where: { vehicleId, tenantId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const nextPosition = data.position ?? (lastImg ? lastImg.position + 1 : 0);

    return this.prisma.vehicleImage.create({
      data: {
        vehicleId,
        tenantId,
        url: data.url,
        altText: data.altText ?? null,
        isCover: data.isCover ?? false,
        position: nextPosition,
      },
    });
  }

  async removeImage(tenantId: string, vehicleId: string, imageId: string): Promise<{ deleted: boolean }> {
    const img = await this.prisma.vehicleImage.findFirst({
      where: { id: imageId, vehicleId, tenantId },
    });
    if (!img) throw new NotFoundException('Imagem não encontrada');
    await this.prisma.vehicleImage.delete({ where: { id: imageId } });
    return { deleted: true };
  }

  async setCoverImage(tenantId: string, vehicleId: string, imageId: string): Promise<unknown> {
    const img = await this.prisma.vehicleImage.findFirst({
      where: { id: imageId, vehicleId, tenantId },
    });
    if (!img) throw new NotFoundException('Imagem não encontrada');

    await this.prisma.vehicleImage.updateMany({
      where: { vehicleId, tenantId },
      data: { isCover: false },
    });
    return this.prisma.vehicleImage.update({
      where: { id: imageId },
      data: { isCover: true },
    });
  }
}
