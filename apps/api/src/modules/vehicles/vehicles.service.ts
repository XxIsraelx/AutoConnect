import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { EmailService } from '../../common/email/email.service';
import { Prisma } from '@autoconnect/db';
import { listarPendencias, pendenciasParaPublicar } from '@autoconnect/shared';
import type { CreateVehicleInput, UpdateVehicleInput, VehicleQuery } from '@autoconnect/shared';
import type { ImportRow } from './import.schema';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    private readonly prisma: PrismaService,
    /**
     * Alerta de preço atravessa usuários: a loja baixa o preço e o sistema
     * notifica todos os clientes que pediram aviso. Não existe um `app.user_id`
     * único para essa varredura — é travessia declarada, não descuido.
     */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly email: EmailService,
  ) {}

  async findAll(escopo: Escopo, query: VehicleQuery): Promise<unknown> {
    const {
      q, brandId, modelId, minPrice, maxPrice, minYear,
      condition, status, listingStatus, page, perPage,
    } = query;
    const skip = (page - 1) * perPage;

    const where = {
      ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }),
      ...(brandId && { brandId }),
      ...(modelId && { modelId }),
      ...(condition && { condition }),
      ...(status && { status }),
      ...(listingStatus && { listingStatus }),
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

    const consultar = (tx: ScopedClient) =>
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
            // A lista mostra o que falta para publicar; sem a contagem de
            // fotos ela teria de adivinhar a partir da capa, que é uma só.
            _count: { select: { images: true } },
          },
        }),
        tx.vehicle.count({ where }),
      ]);

    const [items, total] = await (ehGlobal(escopo)
      ? consultar(this.privilegiado)
      : this.prisma.withTenant(escopo.tenantId, consultar));

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

    const alerts = await this.privilegiado.priceAlert.findMany({
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
        await this.privilegiado.priceAlert.update({
          where: { id: alert.id },
          data: { triggeredAt: new Date() },
        });
      } catch (err) {
        this.logger.warn(`Falha ao notificar alerta ${alert.id}: ${err}`);
      }
    }
  }

  /* ── Publicação do anúncio ───────────────────────────────── */

  /**
   * Põe o anúncio no ar.
   *
   * A conferência do mínimo acontece **aqui**, e não só na tela: a tela usa a
   * mesma função do shared para avisar antes, mas quem decide é a API — senão
   * bastaria um `curl` para publicar um carro sem foto.
   *
   * Recusa com 422 e diz o que falta. 400 seria "seu pedido está malformado",
   * e não está: o pedido é legítimo, o cadastro é que não está pronto.
   */
  async publicar(tenantId: string, id: string, actorUserId?: string): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const veiculo = await tx.vehicle.findFirst({
        where: { id, tenantId },
        select: {
          id: true, price: true, color: true, fuel: true, transmission: true,
          status: true, listingStatus: true, publishedAt: true,
          _count: { select: { images: true } },
        },
      });
      if (!veiculo) throw new NotFoundException('Veículo não encontrado');

      // Vitrine é para carro que a loja tem para vender. Vendido, reservado ou
      // em manutenção não vai ao ar nem que tenha foto — e o catálogo público
      // filtra por `available` de qualquer forma, então publicar aqui criaria
      // um "publicado" que não aparece em lugar nenhum.
      if (veiculo.status !== 'available') {
        throw new UnprocessableEntityException(
          'Só é possível publicar veículo com status "Disponível". ' +
            'Ajuste o status do estoque antes de anunciar.',
        );
      }

      const faltando = pendenciasParaPublicar({
        price: veiculo.price,
        totalDeFotos: veiculo._count.images,
        color: veiculo.color,
        fuel: veiculo.fuel,
        transmission: veiculo.transmission,
      });
      if (faltando.length > 0) {
        throw new UnprocessableEntityException(
          `Para publicar, o anúncio precisa de ${listarPendencias(faltando)}.`,
        );
      }

      const atualizado = await tx.vehicle.update({
        where: { id },
        data: {
          listingStatus: 'published',
          // Só na estreia. Republicar depois de despublicar não zera o giro de
          // estoque — o carro não voltou a ser novo por ter saído do ar.
          ...(veiculo.publishedAt ? {} : { publishedAt: new Date() }),
        },
        include: {
          brand: { select: { id: true, name: true } },
          model: { select: { id: true, name: true } },
        },
      });

      await tx.vehicleHistory.create({
        data: {
          vehicleId: id,
          tenantId,
          eventType: 'listing_published',
          actorUserId: actorUserId ?? null,
          payload: { de: veiculo.listingStatus, para: 'published' },
        },
      });

      return atualizado;
    });
  }

  /**
   * Tira o anúncio do ar sem mexer no estoque.
   *
   * O carro continua na lista da loja, contando dias parados e carregando
   * custo e margem — despublicar é decisão de vitrine, não de inventário.
   */
  async despublicar(tenantId: string, id: string, actorUserId?: string): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const veiculo = await tx.vehicle.findFirst({
        where: { id, tenantId },
        select: { id: true, listingStatus: true },
      });
      if (!veiculo) throw new NotFoundException('Veículo não encontrado');

      const atualizado = await tx.vehicle.update({
        where: { id },
        data: { listingStatus: 'unpublished' },
        include: {
          brand: { select: { id: true, name: true } },
          model: { select: { id: true, name: true } },
        },
      });

      await tx.vehicleHistory.create({
        data: {
          vehicleId: id,
          tenantId,
          eventType: 'listing_unpublished',
          actorUserId: actorUserId ?? null,
          payload: { de: veiculo.listingStatus, para: 'unpublished' },
        },
      });

      return atualizado;
    });
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
    // withTenant, não $transaction: sem `app.tenant_id` o RLS recusa o INSERT
    // em `vehicles` e também o de marca nova (`catalogo_insercao` exige loja
    // autenticada). A importação inteira falhava para o papel da aplicação.
    return this.prisma.withTenant(tenantId, async (tx) => {
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

    return this.prisma.withTenant(tenantId, async (tx) => {
    // Se for capa, desmarca as anteriores
    if (data.isCover) {
      await tx.vehicleImage.updateMany({
        where: { vehicleId, tenantId },
        data: { isCover: false },
      });
    }

    // Calcula próxima posição
    const lastImg = await tx.vehicleImage.findFirst({
      where: { vehicleId, tenantId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const nextPosition = data.position ?? (lastImg ? lastImg.position + 1 : 0);

    return tx.vehicleImage.create({
      data: {
        vehicleId,
        tenantId,
        url: data.url,
        altText: data.altText ?? null,
        isCover: data.isCover ?? false,
        position: nextPosition,
      },
    });
    });
  }

  async removeImage(tenantId: string, vehicleId: string, imageId: string): Promise<{ deleted: boolean }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const img = await tx.vehicleImage.findFirst({
        where: { id: imageId, vehicleId, tenantId },
      });
      if (!img) throw new NotFoundException('Imagem não encontrada');
      await tx.vehicleImage.delete({ where: { id: imageId } });
    });
    return { deleted: true };
  }

  async setCoverImage(tenantId: string, vehicleId: string, imageId: string): Promise<unknown> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const img = await tx.vehicleImage.findFirst({
        where: { id: imageId, vehicleId, tenantId },
      });
      if (!img) throw new NotFoundException('Imagem não encontrada');

      await tx.vehicleImage.updateMany({
        where: { vehicleId, tenantId },
        data: { isCover: false },
      });
      return tx.vehicleImage.update({
        where: { id: imageId },
        data: { isCover: true },
      });
    });
  }
}
