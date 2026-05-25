import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('brands')
  findBrands() {
    return this.catalog.findBrands();
  }

  @Get('brands/:id/models')
  findModels(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.findModelsByBrand(id);
  }

  /** GET /catalog/vehicles?tenantId=xxx&q=corolla&limit=8 */
  @Get('vehicles')
  async findVehicles(
    @Query('tenantId') tenantId?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.catalog.findPublicVehicles({
      tenantId,
      q,
      limit: limit ? Math.min(parseInt(limit, 10), 50) : undefined,
    });
  }
}
