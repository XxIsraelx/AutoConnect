import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { createVehicleSchema, updateVehicleSchema, vehicleQuerySchema } from '@autoconnect/shared';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
  tenantId?: string;
}

@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  findAll(@Req() req: AuthRequest, @Query() query: Record<string, string>): Promise<unknown> {
    const tenantId = req.user.tenantId!;
    const parsed = vehicleQuerySchema.parse(query);
    return this.vehicles.findAll(tenantId, parsed);
  }

  @Get(':id')
  findOne(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.vehicles.findOne(req.user.tenantId!, id);
  }

  @Post()
  create(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    const parsed = createVehicleSchema.parse(body);
    return this.vehicles.create(req.user.tenantId!, parsed);
  }

  @Patch(':id')
  update(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = updateVehicleSchema.parse(body);
    return this.vehicles.update(req.user.tenantId!, id, parsed);
  }

  @Delete(':id')
  remove(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<{ deleted: boolean }> {
    return this.vehicles.remove(req.user.tenantId!, id);
  }
}
