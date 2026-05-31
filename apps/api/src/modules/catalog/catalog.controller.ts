import {
  Body, Controller, Delete, Get, Param,
  ParseUUIDPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/public.decorator';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('brands')
  findBrands() {
    return this.catalog.findBrands();
  }

  @Public()
  @Get('brands/:id/models')
  findModels(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.findModelsByBrand(id);
  }

  /** POST /catalog/brands — cria nova marca (lojista) */
  @Post('brands')
  createBrand(@Body() body: { name: string }) {
    return this.catalog.createBrand(body.name);
  }

  /** POST /catalog/brands/:id/models — cria novo modelo (lojista) */
  @Post('brands/:id/models')
  createModel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name: string; category?: string },
  ) {
    return this.catalog.createModel(id, body.name, body.category);
  }

  /** GET /catalog/dealer/:tenantId — perfil público da concessionária */
  @Public()
  @Get('dealer/:tenantId')
  async findDealer(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.catalog.findPublicDealer(tenantId);
  }

  /** GET /catalog/vehicles/:id — detalhe de um veículo */
  @Public()
  @Get('vehicles/:id')
  async findVehicle(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.findPublicVehicle(id);
  }

  /**
   * GET /catalog/vehicles
   * ?tenantId  filtra por loja
   * ?q         busca textual (marca / modelo / versão)
   * ?brandId   filtra por marca
   * ?condition new | used | semi_new | demo
   * ?limit     máx 50  (default 12)
   * ?skip      offset  (default 0)
   *
   * Retorna { items: Vehicle[], total: number }
   */
  @Public()
  @Get('vehicles')
  async findVehicles(
    @Query('tenantId')     tenantId?: string,
    @Query('q')            q?: string,
    @Query('brandId')      brandId?: string,
    @Query('condition')    condition?: string,
    @Query('fuel')         fuel?: string,
    @Query('transmission') transmission?: string,
    @Query('category')     category?: string,
    @Query('minPrice')     minPrice?: string,
    @Query('maxPrice')     maxPrice?: string,
    @Query('minYear')      minYear?: string,
    @Query('maxYear')      maxYear?: string,
    @Query('maxKm')        maxKm?: string,
    @Query('sort')         sort?: string,
    @Query('limit')        limit?: string,
    @Query('skip')         skip?: string,
  ) {
    const num = (v?: string) => (v !== undefined && v !== '' ? Number(v) : undefined);
    return this.catalog.findPublicVehicles({
      tenantId,
      q,
      brandId,
      condition,
      fuel,
      transmission,
      category,
      minPrice: num(minPrice),
      maxPrice: num(maxPrice),
      minYear:  num(minYear),
      maxYear:  num(maxYear),
      maxKm:    num(maxKm),
      sort,
      limit: limit ? Math.min(parseInt(limit, 10), 50) : undefined,
      skip:  skip  ? parseInt(skip, 10) : undefined,
    });
  }

  /* ── Favoritos (requer autenticação) ────────────────────── */

  /** GET /catalog/favorites/ids — IDs de veículos favoritados pelo cliente */
  @Get('favorites/ids')
  getFavoriteIds(@Req() req: AuthRequest): Promise<unknown> {
    return this.catalog.getFavoriteIds(req.user.id);
  }

  /** POST /catalog/favorites/:vehicleId — favorita */
  @Post('favorites/:vehicleId')
  addFavorite(
    @Req() req: AuthRequest,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ): Promise<unknown> {
    return this.catalog.addFavorite(req.user.id, vehicleId);
  }

  /** DELETE /catalog/favorites/:vehicleId — desfavorita */
  @Delete('favorites/:vehicleId')
  removeFavorite(
    @Req() req: AuthRequest,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ): Promise<{ deleted: boolean }> {
    return this.catalog.removeFavorite(req.user.id, vehicleId);
  }

  /** GET /catalog/favorites — favoritos completos com dados */
  @Get('favorites')
  getFavorites(@Req() req: AuthRequest): Promise<unknown> {
    return this.catalog.getFavorites(req.user.id);
  }

  /** GET /catalog/slug/:slug — perfil público por slug */
  @Public()
  @Get('slug/:slug')
  findDealerBySlug(@Param('slug') slug: string): Promise<unknown> {
    return this.catalog.findPublicDealerBySlug(slug);
  }

  /* ── Buscas salvas ──────────────────────────────────── */

  /** GET /catalog/saved-searches — lista buscas salvas + contador de novos */
  @Get('saved-searches')
  listSavedSearches(@Req() req: AuthRequest): Promise<unknown> {
    return this.catalog.listSavedSearches(req.user.id);
  }

  /** POST /catalog/saved-searches — salva uma busca */
  @Post('saved-searches')
  createSavedSearch(
    @Req() req: AuthRequest,
    @Body() body: { name: string; filters: Record<string, unknown> },
  ): Promise<unknown> {
    return this.catalog.createSavedSearch(req.user.id, body.name, body.filters ?? {});
  }

  /** PATCH /catalog/saved-searches/:id/viewed — marca como vista (zera contador) */
  @Patch('saved-searches/:id/viewed')
  markSavedSearchViewed(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.catalog.markSavedSearchViewed(req.user.id, id);
  }

  /** DELETE /catalog/saved-searches/:id — remove busca salva */
  @Delete('saved-searches/:id')
  deleteSavedSearch(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean }> {
    return this.catalog.deleteSavedSearch(req.user.id, id);
  }

  /* ── Alertas de preço ───────────────────────────────── */

  /** GET /catalog/price-alerts — lista alertas do usuário */
  @Get('price-alerts')
  getPriceAlerts(@Req() req: AuthRequest): Promise<unknown> {
    return this.catalog.getPriceAlerts(req.user.id);
  }

  /** POST /catalog/price-alerts — cria ou atualiza alerta */
  @Post('price-alerts')
  createPriceAlert(
    @Req() req: AuthRequest,
    @Body() body: { vehicleId: string; targetPrice: number },
  ): Promise<unknown> {
    return this.catalog.createPriceAlert(req.user.id, body.vehicleId, body.targetPrice);
  }

  /** DELETE /catalog/price-alerts/:vehicleId — remove alerta */
  @Delete('price-alerts/:vehicleId')
  removePriceAlert(
    @Req() req: AuthRequest,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ): Promise<{ deleted: boolean }> {
    return this.catalog.removePriceAlert(req.user.id, vehicleId);
  }
}
