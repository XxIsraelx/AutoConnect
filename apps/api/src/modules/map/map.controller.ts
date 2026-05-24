import { Controller, Get } from '@nestjs/common';
import { MapService } from './map.service';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@Controller('map')
export class MapController {
  constructor(private readonly map: MapService) {}

  @Get('dealerships')
  getDealerships() {
    return this.map.getDealerships();
  }
}
