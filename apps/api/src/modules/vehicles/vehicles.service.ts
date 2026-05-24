import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
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
    const { featureIds, ...data } = input;
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.vehicle.create({
        data: {
          ...data,
          tenantId,
          price: data.price,
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
    await this.findOne(tenantId, id);
    const { featureIds, ...data } = input;
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (featureIds !== undefined) {
        await tx.vehicleFeatureLink.deleteMany({ where: { vehicleId: id } });
      }
      return tx.vehicle.update({
        where: { id },
        data: {
          ...data,
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
}
