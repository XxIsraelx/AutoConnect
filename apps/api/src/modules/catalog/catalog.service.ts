import { Injectable } from '@nestjs/common';
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

  /** Catálogo público: veículos disponíveis de uma ou mais concessionárias */
  findPublicVehicles(opts: { tenantId?: string; q?: string; limit?: number }): Promise<unknown> {
    const { tenantId, q, limit = 8 } = opts;
    return this.prisma.vehicle.findMany({
      where: {
        status: 'available',
        ...(tenantId ? { tenantId } : {}),
        ...(q
          ? {
              OR: [
                { versionName: { contains: q, mode: 'insensitive' as const } },
                { brand: { name: { contains: q, mode: 'insensitive' as const } } },
                { model: { name: { contains: q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        versionName: true,
        yearModel: true,
        yearMake: true,
        price: true,
        promoPrice: true,
        mileageKm: true,
        condition: true,
        tenantId: true,
        brand: { select: { id: true, name: true, logoUrl: true } },
        model: { select: { id: true, name: true, category: true } },
        images: {
          where: { isCover: true },
          take: 1,
          select: { url: true },
        },
      },
    });
  }
}
