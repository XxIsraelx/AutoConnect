import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '@autoconnect/db';
import type { CreateVehicleInput, UpdateVehicleInput, VehicleQuery } from '@autoconnect/shared';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

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

  async update(tenantId: string, id: string, input: UpdateVehicleInput): Promise<unknown> {
    const existing = await this.findOne(tenantId, id);
    const {
      featureIds,
      previousOwners,
      firstRegistration,
      singleOwner,
      ...data
    } = input;

    // Mescla histórico de uso com metadata existente
    const prevMeta =
      (existing as { metadata?: Record<string, unknown> } | null)?.metadata ?? {};
    const metadata: Record<string, unknown> = { ...prevMeta };
    if (previousOwners !== undefined) metadata.previousOwners = previousOwners;
    if (firstRegistration !== undefined) metadata.firstRegistration = firstRegistration;
    if (singleOwner !== undefined) metadata.singleOwner = singleOwner;
    const metaChanged =
      previousOwners !== undefined ||
      firstRegistration !== undefined ||
      singleOwner !== undefined;

    return this.prisma.withTenant(tenantId, async (tx) => {
      if (featureIds !== undefined) {
        await tx.vehicleFeatureLink.deleteMany({ where: { vehicleId: id } });
      }
      return tx.vehicle.update({
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
    });
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
