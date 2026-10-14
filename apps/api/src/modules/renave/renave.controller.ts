import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { escopoDa } from '../../common/escopo';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  cancelarRenaveSchema, chaveNfeRenaveSchema, confirmarRenaveSchema, credencialDaIntegradoraSchema,
  enviarRenaveSchema,
  recusarRenaveSchema, registrarRenaveSchema, simularRenaveSchema,
} from '@autoconnect/shared';
import { PAPEIS_DA_EQUIPE, PAPEIS_FISCAIS, RenaveService } from './renave.service';
import { RenaveIntegracaoService } from './renave-integracao.service';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

/**
 * RENAVE — registro manual (R1) e envio pela integradora (R2).
 *
 * Ler é da equipe: o vendedor precisa saber que "falta registrar a saída" para
 * não prometer a documentação ao cliente. Escrever é da gerência, como o
 * financeiro (regra 6 do plano fiscal).
 *
 * Toda escrita passa pelo `SomenteLeituraGuard` global, sem exceção nova: a
 * loja bloqueada continua vendo as pendências, e registra quando voltar.
 */
@Controller('renave')
@UseGuards(RolesGuard)
@Roles(...PAPEIS_FISCAIS)
export class RenaveController {
  constructor(
    private readonly renave: RenaveService,
    private readonly integracao: RenaveIntegracaoService,
  ) {}

  /** GET /renave/pendencias — a lista da gerência. */
  @Get('pendencias')
  pendencias(@Req() req: AuthRequest): Promise<unknown> {
    return this.renave.pendencias(escopoDa(req.user));
  }

  /**
   * GET /renave/veiculos/:id — o cartão do veículo e do negócio, com o que a
   * integradora configurada permite (a tela esconde o envio sem ela).
   */
  @Get('veiculos/:id')
  @Roles(...PAPEIS_DA_EQUIPE)
  async doVeiculo(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    const escopo = escopoDa(req.user);
    // Em paralelo: são duas transações, e a API está a ~0,6 s do banco.
    const [cartao, chave] = await Promise.all([
      this.renave.doVeiculo(escopo, id),
      this.integracao.credencial(escopo),
    ]);
    return {
      ...cartao,
      integradora: { ...this.integracao.capacidade(), credencialCadastrada: chave.credencial !== null },
    };
  }

  /** GET /renave/credencial — os 4 últimos caracteres da chave da loja, nunca ela. */
  @Get('credencial')
  credencial(@Req() req: AuthRequest): Promise<unknown> {
    return this.integracao.credencial(escopoDa(req.user));
  }

  /**
   * POST /renave/credencial — só o dono da loja (o service recusa o gerente):
   * a chave gasta o dinheiro dela. Conferida na integradora antes de gravar.
   */
  @Post('credencial')
  guardarCredencial(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    const { chave } = credencialDaIntegradoraSchema.parse(body);
    return this.integracao.guardarCredencial(escopoDa(req.user), chave, req.user);
  }

  @Post('credencial/revogar')
  revogarCredencial(@Req() req: AuthRequest): Promise<unknown> {
    return this.integracao.revogarCredencial(escopoDa(req.user), req.user);
  }

  /** POST /renave/registros — anotação manual: com protocolo nasce confirmado; sem, aguardando. */
  @Post('registros')
  registrar(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    return this.renave.registrar(escopoDa(req.user), registrarRenaveSchema.parse(body), req.user);
  }

  /** POST /renave/envios — pela integradora. Reenviar o mesmo pedido não duplica. */
  @Post('envios')
  enviar(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    return this.integracao.enviar(escopoDa(req.user), enviarRenaveSchema.parse(body), req.user);
  }

  @Post('registros/:id/confirmar')
  confirmar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.renave.confirmar(escopoDa(req.user), id, confirmarRenaveSchema.parse(body));
  }

  @Post('registros/:id/recusar')
  recusar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { motivo } = recusarRenaveSchema.parse(body);
    return this.renave.recusar(escopoDa(req.user), id, motivo);
  }

  /** Manual: anota. Da integradora: pede a ela primeiro. */
  @Post('registros/:id/cancelar')
  cancelar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.integracao.cancelar(escopoDa(req.user), id, cancelarRenaveSchema.parse(body));
  }

  @Post('registros/:id/nfe')
  informarNfe(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { chaveNfe } = chaveNfeRenaveSchema.parse(body);
    return this.integracao.informarNfe(escopoDa(req.user), id, chaveNfe);
  }

  /** Para integradora sem webhook: pergunta o estado e aplica. */
  @Post('registros/:id/atualizar')
  atualizar(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.integracao.atualizar(escopoDa(req.user), id);
  }

  /** O ATPV-e — documento com CPF: sai pela API, nunca por URL pública. */
  @Get('registros/:id/atpv')
  @Roles(...PAPEIS_DA_EQUIPE)
  async atpv(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.integracao.atpv(escopoDa(req.user), id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="atpv-${id.slice(0, 8)}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(pdf);
  }

  /** Só com a integradora simulada, fora de produção (404 no resto). */
  @Post('registros/:id/simular')
  simular(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { acao } = simularRenaveSchema.parse(body);
    return this.integracao.simular(escopoDa(req.user), id, acao);
  }
}

/**
 * Entrada da integradora. Pública porque quem chama é ela, não um usuário: a
 * autenticação é conferida pelo adaptador sobre o corpo **cru** (ver
 * `ROTA_WEBHOOK_RENAVE` no `app.setup.ts`).
 */
@Controller('webhooks')
export class WebhookRenaveController {
  constructor(private readonly integracao: RenaveIntegracaoService) {}

  @Public()
  @Post('renave')
  @HttpCode(200)
  receber(@Req() req: Request): Promise<unknown> {
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return this.integracao.receberWebhook(req.headers, corpo);
  }
}
