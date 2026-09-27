import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  GeocodificacaoService,
  type FilialLocalizavel,
  type PrecisaoDeGeocodificacao,
} from './geocodificacao.service';

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
  /** De onde vem o pino — o balão do mapa avisa quando é aproximado. */
  geocodePrecision: PrecisaoDeGeocodificacao | null;
  vehiclesCount: number;
  businessHours: unknown;
  tenant: {
    id: string;
    tradeName: string;
    logoUrl: string | null;
  };
}

@Injectable()
export class MapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeocodificacaoService,
  ) {}

  async getDealerships(): Promise<DealershipPin[]> {
    const { branches, semFilialPorLoja } = await this.prisma.withPublic(async (tx) => {
      const branches = await tx.dealershipBranch.findMany({
        where: { isActive: true, tenant: { isActive: true } },
        select: {
          id: true,
          tenantId: true,
          name: true,
          isHeadquarters: true,
          city: true,
          state: true,
          addressLine: true,
          addressNumber: true,
          neighborhood: true,
          postalCode: true,
          phone: true,
          email: true,
          latitude: true,
          longitude: true,
          geocodePrecision: true,
          geocodedAt: true,
          businessHours: true,
          createdAt: true,
          tenant: {
            select: { id: true, tradeName: true, logoUrl: true },
          },
          _count: {
            select: {
              // Contagem do pin: o que o visitante encontraria ao clicar. Com
              // rascunho aqui, o mapa anunciaria 12 carros e a loja abriria com 3.
              vehicles: { where: { status: 'available', listingStatus: 'published' } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      /**
       * B7 — o estoque que não está em filial nenhuma.
       *
       * A contagem era `branch._count.vehicles`, e o assistente de cadastro
       * nunca gravava `branch_id`: **toda** loja anunciava "0 veíc." com o
       * estoque publicado. Atribuir a filial no cadastro resolve o caso novo;
       * isto resolve o caso geral, e é o que impede a contagem de voltar a
       * mentir por causa de uma coluna vazia — importação de planilha, rota de
       * API, dado antigo.
       *
       * O veículo sem filial é somado numa filial só (a de recepção da loja,
       * abaixo), senão uma loja com duas filiais contaria o mesmo carro duas
       * vezes e o mapa passaria a mentir para cima.
       */
      const semFilial = await tx.vehicle.groupBy({
        by: ['tenantId'],
        where: { branchId: null, status: 'available', listingStatus: 'published' },
        _count: { _all: true },
      });

      return {
        branches,
        semFilialPorLoja: new Map(semFilial.map((l) => [l.tenantId, l._count._all])),
      };
    });

    /**
     * A filial que recebe o estoque sem filial: a matriz, e na falta dela a mais
     * antiga. É a mesma escolha do backfill da migration e do cadastro de
     * veículo — três lugares, uma regra.
     */
    const recepcaoPorLoja = new Map<string, string>();
    for (const b of branches) {
      const atual = recepcaoPorLoja.get(b.tenantId);
      if (!atual) { recepcaoPorLoja.set(b.tenantId, b.id); continue; }
      const anterior = branches.find((x) => x.id === atual)!;
      if (b.isHeadquarters && !anterior.isHeadquarters) recepcaoPorLoja.set(b.tenantId, b.id);
    }

    const result: DealershipPin[] = [];

    for (const branch of branches) {
      const localizacao = await this.geo.localizar(branch as FilialLocalizavel);

      const orfaos =
        recepcaoPorLoja.get(branch.tenantId) === branch.id
          ? (semFilialPorLoja.get(branch.tenantId) ?? 0)
          : 0;

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
        latitude: localizacao?.latitude ?? null,
        longitude: localizacao?.longitude ?? null,
        geocodePrecision: localizacao?.precisao ?? null,
        vehiclesCount: branch._count.vehicles + orfaos,
        businessHours: branch.businessHours,
        tenant: branch.tenant,
      });
    }

    return result;
  }
}
