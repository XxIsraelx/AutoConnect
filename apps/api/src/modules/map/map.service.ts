import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface DealershipPin {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  addressLine: string | null;
  phone: string | null;
  email: string | null;
  latitude: number | null;
  longitude: number | null;
  vehiclesCount: number;
  tenant: {
    id: string;
    tradeName: string;
    logoUrl: string | null;
  };
}

@Injectable()
export class MapService {
  private readonly logger = new Logger(MapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getDealerships(): Promise<DealershipPin[]> {
    const branches = await this.prisma.dealershipBranch.findMany({
      where: { isActive: true, tenant: { isActive: true } },
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
        tenant: {
          select: { id: true, tradeName: true, logoUrl: true },
        },
        _count: {
          select: {
            vehicles: { where: { status: 'available' } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const result: DealershipPin[] = [];

    for (const branch of branches) {
      let lat = branch.latitude;
      let lng = branch.longitude;

      // Se não tem coordenadas, tenta geocodificar pelo município
      if (!lat || !lng) {
        const coords = await this.geocodeCity(branch.city, branch.state);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
          // Persiste para não geocodificar toda vez
          await this.prisma.dealershipBranch.update({
            where: { id: branch.id },
            data: { latitude: lat, longitude: lng },
          }).catch(() => {});
        }
      }

      result.push({
        id: branch.id,
        name: branch.name,
        city: branch.city,
        state: branch.state,
        addressLine: branch.addressLine
          ? `${branch.addressLine}${branch.addressNumber ? ', ' + branch.addressNumber : ''}`
          : null,
        phone: branch.phone,
        email: branch.email,
        latitude: lat,
        longitude: lng,
        vehiclesCount: branch._count.vehicles,
        tenant: branch.tenant,
      });
    }

    return result;
  }

  private async geocodeCity(
    city: string | null,
    state: string | null,
  ): Promise<{ lat: number; lng: number } | null> {
    if (!city) return null;
    const query = [city, state, 'Brasil'].filter(Boolean).join(', ');
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'AutoConnect/1.0' },
      });
      const data = (await res.json()) as { lat: string; lon: string }[];
      if (data[0]) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    } catch (err) {
      this.logger.warn(`Geocoding falhou para "${query}": ${err}`);
    }
    return null;
  }
}
