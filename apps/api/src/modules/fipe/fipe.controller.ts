import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { FipeService } from './fipe.service';

@Controller('fipe')
export class FipeController {
  constructor(private readonly svc: FipeService) {}

  /**
   * GET /fipe/estimate?brandName=Fiat&modelName=Argo&versionName=Drive 1.0&yearModel=2022&fuel=flex
   * Retorna { found: true, ...estimate } ou { found: false }.
   */
  @Get('estimate')
  async estimate(
    @Query('brandName') brandName?: string,
    @Query('modelName') modelName?: string,
    @Query('versionName') versionName?: string,
    @Query('yearModel') yearModel?: string,
    @Query('fuel') fuel?: string,
  ) {
    if (!brandName || !modelName || !yearModel) {
      throw new BadRequestException('brandName, modelName e yearModel são obrigatórios');
    }
    const year = Number(yearModel);
    if (!Number.isInteger(year) || year < 1950 || year > new Date().getFullYear() + 1) {
      throw new BadRequestException('yearModel inválido');
    }

    const estimate = await this.svc.estimate({
      brandName, modelName, versionName, yearModel: year, fuel,
    });
    return estimate ? { found: true, ...estimate } : { found: false };
  }
}
