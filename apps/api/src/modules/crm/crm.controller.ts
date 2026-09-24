import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { updateCrmSettingsSchema } from '@autoconnect/shared';
import { CrmService } from './crm.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { escopoDa } from '../../common/escopo';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

/**
 * Ajustes de CRM da loja.
 *
 * Rota própria, e não `PATCH /tenant/me`: a mesma linha guarda o estado do
 * rodízio, que é escrito a cada lead e travado com `SELECT … FOR UPDATE` —
 * travar o cadastro da loja a cada lead prenderia tudo atrás da fila. E o
 * `updateTenantSchema` é deliberadamente estreito desde o conserto de mass
 * assignment.
 */
@Controller('crm')
@UseGuards(RolesGuard)
@Roles('tenant_admin', 'manager')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('settings')
  ler(@Req() req: AuthRequest): Promise<unknown> {
    return this.crm.ler(escopoDa(req.user));
  }

  @Patch('settings')
  salvar(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    // Zod, e não o tipo anotado: `PATCH /tenant/me` já provou aqui que
    // anotação não valida nada em tempo de execução.
    return this.crm.salvar(escopoDa(req.user), updateCrmSettingsSchema.parse(body));
  }
}
