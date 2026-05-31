import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '@autoconnect/db';

/* ── Haversine distance (km) ─────────────────────────────── */
function haversine(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Coordenadas aproximadas de cidades brasileiras ─────── */
const CITY_COORDS: Record<string, [number, number]> = {
  'São Paulo_SP': [-23.5505, -46.6333],
  'Rio de Janeiro_RJ': [-22.9068, -43.1729],
  'Brasília_DF': [-15.7797, -47.9297],
  'Salvador_BA': [-12.9714, -38.5014],
  'Fortaleza_CE': [-3.7319, -38.5267],
  'Belo Horizonte_MG': [-19.9167, -43.9345],
  'Manaus_AM': [-3.1019, -60.025],
  'Curitiba_PR': [-25.4297, -49.2711],
  'Recife_PE': [-8.0578, -34.8829],
  'Porto Alegre_RS': [-30.0277, -51.2287],
  'Belém_PA': [-1.4558, -48.4902],
  'Goiânia_GO': [-16.6864, -49.2643],
  'Guarulhos_SP': [-23.4534, -46.533],
  'Campinas_SP': [-22.9056, -47.0608],
  'São Luís_MA': [-2.5307, -44.3068],
  'Maceió_AL': [-9.6658, -35.735],
  'Natal_RN': [-5.7945, -35.211],
  'Campo Grande_MS': [-20.4697, -54.6201],
  'Teresina_PI': [-5.0892, -42.8016],
  'Sorocaba_SP': [-23.5017, -47.4573],
  'Uberlândia_MG': [-18.9186, -48.2772],
  'Aracaju_SE': [-10.9472, -37.0731],
  'Cuiabá_MT': [-15.5989, -56.0949],
  'Joinville_SC': [-26.3045, -48.8487],
  'Juiz de Fora_MG': [-21.7642, -43.3503],
  'Londrina_PR': [-23.3045, -51.1696],
  'Niterói_RJ': [-22.8832, -43.1036],
  'Florianópolis_SC': [-27.5935, -48.5585],
  'São José dos Campos_SP': [-23.1791, -45.8872],
  'Ribeirão Preto_SP': [-21.1775, -47.8103],
  'São José do Rio Preto_SP': [-20.8197, -49.3794],
  'Porto Velho_RO': [-8.7612, -63.9004],
  'Macapá_AP': [0.0349, -51.0694],
  'Boa Vista_RR': [2.8235, -60.6758],
  'Rio Branco_AC': [-9.9754, -67.8249],
  'Palmas_TO': [-10.184, -48.3337],
  'Vitória_ES': [-20.3155, -40.3128],
  'João Pessoa_PB': [-7.1195, -34.845],
  'Montes Claros_MG': [-16.7286, -43.8611],
  'Campina Grande_PB': [-7.2306, -35.8811],
  'Piracicaba_SP': [-22.7253, -47.6492],
  'Jundiaí_SP': [-23.1864, -46.8842],
  'Santos_SP': [-23.9537, -46.3329],
  'Franca_SP': [-20.5386, -47.4008],
  'Feira de Santana_BA': [-12.2664, -38.9663],
  'Aparecida de Goiânia_GO': [-16.8198, -49.2451],
  'Caxias do Sul_RS': [-29.1678, -51.1794],
  'Caruaru_PE': [-8.2763, -35.9761],
  'Caucaia_CE': [-3.7372, -38.6532],
  'Maringá_PR': [-23.4273, -51.9375],
  'Petrolina_PE': [-9.3986, -40.5016],
  'Juazeiro_BA': [-9.4303, -40.4969],
  'Camaçari_BA': [-12.6994, -38.3249],
  'Olinda_PE': [-8.0076, -34.8549],
  'Vitória da Conquista_BA': [-14.8667, -40.8393],
  'Cascavel_PR': [-24.9578, -53.4595],
  'Foz do Iguaçu_PR': [-25.5469, -54.5882],
  'Mossoró_RN': [-5.1875, -37.3441],
  'Diadema_SP': [-23.6859, -46.6205],
  'Betim_MG': [-19.968, -44.1983],
  'Contagem_MG': [-19.9317, -44.0536],
  'São Bernardo do Campo_SP': [-23.6939, -46.565],
  'Osasco_SP': [-23.5323, -46.7914],
  'Santo André_SP': [-23.6639, -46.5383],
  'Mogi das Cruzes_SP': [-23.5228, -46.1876],
  'Carapicuíba_SP': [-23.5226, -46.835],
  'Guarujá_SP': [-23.9928, -46.2561],
  'Suzano_SP': [-23.5417, -46.3108],
  'Praia Grande_SP': [-24.0056, -46.4028],
  'São Vicente_SP': [-23.9608, -46.3989],
  'Taubaté_SP': [-23.026, -45.5555],
  'Bauru_SP': [-22.3155, -49.0628],
  'Marília_SP': [-22.2139, -49.9464],
  'Presidente Prudente_SP': [-22.1253, -51.3886],
  'Araraquara_SP': [-21.7967, -48.1761],
  'São Carlos_SP': [-21.9799, -47.8978],
  'Limeira_SP': [-22.5647, -47.4017],
  'Americana_SP': [-22.7392, -47.3331],
  'Indaiatuba_SP': [-23.09, -47.2192],
  'Hortolândia_SP': [-22.8583, -47.2197],
  'Rio Claro_SP': [-22.415, -47.5597],
  'Anápolis_GO': [-16.3281, -48.9535],
  'Aparecida_GO': [-16.8198, -49.2451],
  'Novo Hamburgo_RS': [-29.6903, -51.1303],
  'São Leopoldo_RS': [-29.7601, -51.1478],
  'Pelotas_RS': [-31.7654, -52.3376],
  'Gravataí_RS': [-29.9432, -50.9908],
  'Canoas_RS': [-29.9173, -51.1838],
  'Chapecó_SC': [-27.1004, -52.6151],
  'Blumenau_SC': [-26.9194, -49.0661],
  'Itajaí_SC': [-26.9075, -48.6625],
  'Criciúma_SC': [-28.6775, -49.3697],
  'Uberaba_MG': [-19.7486, -47.9319],
  'Governador Valadares_MG': [-18.8549, -41.9494],
  'Ipatinga_MG': [-19.4683, -42.5376],
  'Divinópolis_MG': [-20.1389, -44.8834],
  'Imperatriz_MA': [-5.5253, -47.4925],
  'Caxias_MA': [-4.8608, -43.3556],
  'Macaé_RJ': [-22.3703, -41.7869],
  'Volta Redonda_RJ': [-22.5232, -44.1042],
  'Petrópolis_RJ': [-22.505, -43.1786],
  'Angra dos Reis_RJ': [-23.0068, -44.3178],
  'Ilhéus_BA': [-14.7889, -39.0311],
  'Juazeiro do Norte_CE': [-7.213, -39.3152],
  'Sobral_CE': [-3.6882, -40.3497],
  'Parnaíba_PI': [-2.9069, -41.7761],
  'Santarém_PA': [-2.4406, -54.7081],
  'Marabá_PA': [-5.3686, -49.1178],
  'Ananindeua_PA': [-1.3656, -48.3722],
  'Ji-Paraná_RO': [-10.8857, -61.9476],
  'Sinop_MT': [-11.8648, -55.5033],
  'Rondonópolis_MT': [-16.4714, -54.638],
  'Dourados_MS': [-22.2231, -54.8025],
  'Corumbá_MS': [-19.0078, -57.6547],
  'Ponta Grossa_PR': [-25.0963, -50.1653],
  'Apucarana_PR': [-23.5553, -51.4609],
};

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  findById(
    tenantId: string,
  ): Promise<
    Prisma.TenantGetPayload<{
      include: {
        subscription: true;
        branches: true;
      };
    }>
  > {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        include: { subscription: true, branches: true },
      }),
    );
  }

  /** Stats para o dashboard */
  async getStats(tenantId: string): Promise<unknown> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [vehiclesCount, leadsToday, leadsNew] = await Promise.all([
      this.prisma.vehicle.count({
        where: { tenantId, status: 'available' },
      }),
      this.prisma.lead.count({
        where: { tenantId, createdAt: { gte: todayStart } },
      }),
      this.prisma.lead.count({
        where: { tenantId, status: 'new' },
      }),
    ]);

    return { vehiclesCount, leadsToday, leadsNew };
  }

  /** Atualiza dados do tenant */
  async updateTenant(
    tenantId: string,
    data: {
      tradeName?: string;
      primaryPhone?: string;
      logoUrl?: string;
      brandColor?: string;
      websiteUrl?: string;
    },
  ): Promise<unknown> {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data,
      include: { subscription: true, branches: true },
    });
  }

  /** Relatórios — leads por período, taxa de conversão, top veículos, origens */
  async getReports(tenantId: string, days = 30): Promise<unknown> {
    const from = new Date(Date.now() - days * 86_400_000);

    const [
      leadsPerDay,
      byStatus,
      bySource,
      topVehicles,
      conversionStats,
    ] = await Promise.all([
      // Leads agrupados por dia
      this.prisma.$queryRaw<Array<{ day: string; count: bigint }>>`
        SELECT date_trunc('day', created_at AT TIME ZONE 'UTC')::date::text AS day,
               COUNT(*)::bigint AS count
        FROM leads
        WHERE tenant_id = ${tenantId}::uuid
          AND created_at >= ${from}
        GROUP BY 1
        ORDER BY 1
      `,
      // Por status
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { tenantId, createdAt: { gte: from } },
        _count: { _all: true },
      }),
      // Por fonte
      this.prisma.lead.groupBy({
        by: ['source'],
        where: { tenantId, createdAt: { gte: from } },
        _count: { _all: true },
      }),
      // Top 10 veículos mais vistos
      this.prisma.vehicleView.groupBy({
        by: ['vehicleId'],
        where: { tenantId, viewedAt: { gte: from } },
        _count: { _all: true },
        orderBy: { _count: { vehicleId: 'desc' } },
        take: 10,
      }),
      // Total leads / ganhos / perdidos para conversão
      this.prisma.lead.aggregate({
        where: { tenantId, createdAt: { gte: from } },
        _count: { _all: true },
      }),
    ]);

    // Enriquece top veículos com nome
    const vehicleIds = topVehicles.map((v) => v.vehicleId);
    const vehicles = vehicleIds.length
      ? await this.prisma.vehicle.findMany({
          where: { id: { in: vehicleIds } },
          select: {
            id: true,
            versionName: true,
            yearModel: true,
            brand: { select: { name: true } },
            model: { select: { name: true } },
            images: { where: { isCover: true }, take: 1, select: { url: true } },
          },
        })
      : [];

    const vehicleMap = Object.fromEntries(vehicles.map((v) => [v.id, v]));
    const topVehiclesEnriched = topVehicles.map((v) => ({
      vehicleId: v.vehicleId,
      views: Number(v._count._all),
      vehicle: vehicleMap[v.vehicleId],
    }));

    const wonCount  = byStatus.find((s) => s.status === 'won')?._count._all  ?? 0;
    const lostCount = byStatus.find((s) => s.status === 'lost')?._count._all ?? 0;
    const total     = conversionStats._count._all;

    return {
      period:  { days, from },
      leadsPerDay: leadsPerDay.map((r) => ({ day: r.day, count: Number(r.count) })),
      byStatus:    byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      bySource:    bySource.map((s) => ({ source: s.source, count: s._count._all })),
      topVehicles: topVehiclesEnriched,
      conversion:  {
        total, won: wonCount, lost: lostCount,
        rate: total > 0 ? Math.round((wonCount / total) * 100) : 0,
      },
    };
  }

  /** Proximidade de usuários em relação à concessionária */
  async getUsersProximity(tenantId: string): Promise<unknown> {
    const branch = await this.prisma.dealershipBranch.findFirst({
      where: { tenantId },
      select: { latitude: true, longitude: true, city: true, state: true },
      orderBy: { isHeadquarters: 'desc' },
    });

    type CustomerLike = {
      id: string;
      fullName: string;
      customerProfile: { city: string | null; state: string | null } | null;
    };

    // mapeia um cliente → ponto do galaxy map (com distância calculada)
    const toGalaxy = (c: CustomerLike) => {
      const profile = c.customerProfile;
      let distance: number | null = null;

      if (
        branch?.latitude &&
        branch?.longitude &&
        profile?.city &&
        profile?.state
      ) {
        const coords = CITY_COORDS[`${profile.city}_${profile.state}`];
        if (coords) {
          distance = haversine(
            branch.latitude,
            branch.longitude,
            coords[0],
            coords[1],
          );
        }
      }

      const nameParts = c.fullName.split(' ');
      const initials = nameParts
        .slice(0, 2)
        .map((part: string) => part[0])
        .join('')
        .toUpperCase();

      return {
        id: c.id,
        firstName: nameParts[0],
        initials,
        distance: distance !== null ? Math.round(distance) : null,
      };
    };

    const customerSelect = {
      id: true,
      fullName: true,
      customerProfile: { select: { city: true, state: true } },
    } as const;

    const [leads, registeredUsers] = await Promise.all([
      // Clientes que demonstraram interesse (lead nesta concessionária)
      this.prisma.lead.findMany({
        where: { tenantId, customerUserId: { not: null } },
        select: { customer: { select: customerSelect } },
        distinct: ['customerUserId'],
      }),
      // Todos os clientes cadastrados na plataforma
      this.prisma.user.findMany({
        where: { role: 'customer' },
        select: customerSelect,
      }),
    ]);

    const interested = leads
      .map((l) => l.customer)
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map(toGalaxy);

    const registered = registeredUsers.map(toGalaxy);

    return {
      interested,
      registered,
      dealerCity: branch?.city ?? null,
      dealerState: branch?.state ?? null,
    };
  }

  /** Atualiza dados de uma filial */
  async updateBranch(
    tenantId: string,
    branchId: string,
    data: {
      name?: string;
      phone?: string;
      email?: string;
      addressLine?: string;
      addressNumber?: string;
      complement?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      postalCode?: string;
    },
  ): Promise<unknown> {
    const branch = await this.prisma.dealershipBranch.findFirst({
      where: { id: branchId, tenantId },
    });
    if (!branch) throw new NotFoundException('Filial não encontrada');

    return this.prisma.dealershipBranch.update({
      where: { id: branchId },
      data,
    });
  }
}