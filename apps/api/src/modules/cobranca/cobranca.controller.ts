import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { MEIOS_DE_PAGAMENTO, PLANOS_PAGOS } from '@autoconnect/shared';
import { escopoDa } from '../../common/escopo';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { LiberadoNoBloqueio } from '../../common/guards/somente-leitura.guard';
import { CobrancaService } from './cobranca.service';

interface AuthRequest extends Request {
  user: { id: string; role: string; tenantId: string | null };
}

export const contratarSchema = z
  .object({
    plano: z.enum(PLANOS_PAGOS),
    // `indefinido` é o padrão de propósito: a fatura da Asaas deixa o cliente
    // escolher Pix, boleto ou cartão na hora de pagar, e 55,9% dos
    // compradores de SaaS no Brasil não usam cartão. Forçar o meio na
    // contratação é escolher por eles.
    meio: z.enum(MEIOS_DE_PAGAMENTO).default('indefinido'),
  })
  .strict();

export const simularCobrancaSchema = z
  .object({ acao: z.enum(['pagar', 'vencer', 'estornar', 'cancelar']) })
  .strict();

/**
 * Plano e cobrança da loja.
 *
 * **Só `tenant_admin`** (e o super admin, que entra em qualquer lugar):
 * escolher plano e pagar é decisão de quem responde pela empresa, não de
 * gerente nem de vendedor. `GET` do resumo segue a mesma regra — ele mostra o
 * que a loja paga.
 *
 * Tudo aqui é `@LiberadoNoBloqueio()`: é por estas rotas que se sai do
 * bloqueio, e uma tela de pagamento bloqueada pelo não pagamento seria uma
 * armadilha fechada.
 */
@Controller('cobranca')
@UseGuards(RolesGuard)
@Roles('tenant_admin', 'super_admin')
@LiberadoNoBloqueio()
export class CobrancaController {
  constructor(private readonly cobranca: CobrancaService) {}

  @Get()
  resumo(@Req() req: AuthRequest): Promise<unknown> {
    return this.cobranca.resumo(escopoDa(req.user));
  }

  @Post('contratar')
  contratar(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    const { plano, meio } = contratarSchema.parse(body ?? {});
    return this.cobranca.contratar(escopoDa(req.user), plano, meio);
  }

  /** Relê a fatura no gateway — o link de pagamento expira e se renova. */
  @Post('fatura/atualizar')
  atualizarFatura(@Req() req: AuthRequest): Promise<unknown> {
    return this.cobranca.atualizarFatura(escopoDa(req.user));
  }

  @Post('cancelar')
  cancelar(@Req() req: AuthRequest): Promise<unknown> {
    return this.cobranca.cancelar(escopoDa(req.user));
  }

  /** Só com o gateway simulado, fora de produção (404 no resto). */
  @Post('simular')
  simular(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    const { acao } = simularCobrancaSchema.parse(body);
    return this.cobranca.simular(escopoDa(req.user), acao);
  }
}

/**
 * Entrada do gateway. Pública porque quem chama é a Asaas, não um usuário: a
 * autenticação é o token que ela devolve no cabeçalho, conferido pelo
 * adaptador em tempo constante.
 *
 * O corpo chega **cru** (`Buffer`) — ver `app.setup.ts`. A Asaas não assina o
 * corpo, então aqui o cru não é exigência de HMAC; é o que permite guardar a
 * entrega byte a byte para auditoria e usar o SHA-256 dela como chave de
 * idempotência quando o evento vem sem id.
 */
@Controller('webhooks')
export class WebhookCobrancaController {
  constructor(private readonly cobranca: CobrancaService) {}

  @Public()
  @Post('cobranca')
  @HttpCode(200)
  receber(@Req() req: Request): Promise<unknown> {
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return this.cobranca.receberWebhook(req.headers, corpo);
  }
}
