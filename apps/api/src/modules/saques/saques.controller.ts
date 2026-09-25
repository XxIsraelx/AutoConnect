import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  MODOS_DE_VALOR, TIPOS_DE_SAQUE,
  VALIDADE_MAXIMA_DA_AUTORIZACAO_MIN, VALIDADE_PADRAO_DA_AUTORIZACAO_MIN,
} from '@autoconnect/shared';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { LiberadoNoBloqueio } from '../../common/guards/somente-leitura.guard';
import type { AuthenticatedRequest } from '../../common/middleware/tenant.middleware';
import { SaquesService } from './saques.service';
import type { RespostaDeValidacaoDeSaque } from './payload-asaas';

/**
 * Autorização prévia de saque. Corpo validado por Zod como todo o resto — um
 * `tipo` não previsto ou um prazo de um ano não podem chegar ao banco só
 * porque o TypeScript os anotou.
 */
export const autorizarSaqueSchema = z
  .object({
    tipo: z.enum(TIPOS_DE_SAQUE),
    modo: z.enum(MODOS_DE_VALOR).default('exato'),
    // Dinheiro atravessa a fronteira HTTP como string decimal, nunca `number`.
    valor: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, 'Use o formato 1234.56, sem separador de milhar.'),
    validadeMinutos: z
      .number()
      .int()
      .min(1)
      .max(VALIDADE_MAXIMA_DA_AUTORIZACAO_MIN)
      .default(VALIDADE_PADRAO_DA_AUTORIZACAO_MIN),
    observacao: z.string().trim().max(300).optional(),
  })
  .strict();

/**
 * Painel de validação de saque — só super admin.
 *
 * Quem autoriza a saída do dinheiro da plataforma é quem responde por ela. Não
 * existe papel de loja aqui: `tenant_admin` não tem o que ver nesta tela, e a
 * ausência dele na lista é a permissão inteira.
 */
@Controller('admin/saques')
@UseGuards(RolesGuard)
@Roles('super_admin')
export class SaquesAdminController {
  constructor(private readonly saques: SaquesService) {}

  @Get()
  painel(): Promise<unknown> {
    return this.saques.painel();
  }

  @Post('autorizacoes')
  autorizar(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<unknown> {
    const dados = autorizarSaqueSchema.parse(body ?? {});
    return this.saques.autorizar(dados, req.user!.id);
  }

  @Post('autorizacoes/:id/revogar')
  revogar(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.saques.revogar(id);
  }
}

/**
 * Entrada da validação de saque da Asaas.
 *
 * `POST /api/v1/webhooks/asaas/saque` — é esta URL que vai no painel da Asaas,
 * em *Integrações › Mecanismos de segurança*.
 *
 * **`@Public()`**: a Asaas não tem JWT. A autenticação é o token que ela
 * devolve no cabeçalho `asaas-access-token`, conferido em tempo constante pelo
 * serviço. `@LiberadoNoBloqueio()` está aqui junto por redundância deliberada:
 * rota pública já passa pelo guard de somente leitura, mas se um dia alguém
 * tirar o `@Public()`, o saque do dono não pode ficar refém de uma assinatura.
 *
 * **Sempre 200.** A Asaas cancela a operação quando o corpo não contém
 * `APPROVED` nem `REFUSED`, e cancela também depois de três falhas seguidas.
 * Um 401 ou um 500 aqui não seriam "recusa": seriam falha, e gastariam as três
 * chances sem dizer nada a quem pediu o saque. O `REFUSED` com motivo é a
 * recusa **e** a explicação, e é o que aparece no e-mail de erro da conta.
 *
 * O corpo chega cru (`Buffer`, ver `app.setup.ts`) — é o que vai inteiro para
 * a trilha de auditoria e o que vira chave de idempotência quando o pedido não
 * traz id confiável.
 */
@Controller('webhooks/asaas')
export class WebhookSaqueController {
  constructor(private readonly saques: SaquesService) {}

  @Public()
  @LiberadoNoBloqueio()
  @Post('saque')
  @HttpCode(200)
  validar(@Req() req: Request): Promise<RespostaDeValidacaoDeSaque> {
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return this.saques.validar(req.headers, corpo);
  }
}
