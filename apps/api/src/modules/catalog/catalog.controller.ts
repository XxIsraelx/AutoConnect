import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
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
}
