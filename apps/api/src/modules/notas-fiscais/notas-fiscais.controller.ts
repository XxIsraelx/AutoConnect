import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { PerfilFiscalService, PAPEIS_DO_FISCAL } from './perfil-fiscal.service';
import { escopoDa } from '../../common/escopo';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  confirmacaoDoContadorSchema, dadosFiscaisDoVeiculoSchema,
  perfilDeOperacaoSchema, perfilFiscalSchema,
} from '@autoconnect/shared';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

/** `?presencial=false` para entrega em outro estado; o padrão é a venda no balcão. */
const previaQuerySchema = z.object({
  presencial: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
}).strict();

/**
 * Fiscal da loja — trilha N do plano fiscal, `manager` para cima.
 *
 * N1: perfil fiscal (regime, série, ambiente, operações), confirmação do
 * contador, dados fiscais do veículo e a prévia da nota de um negócio. A
 * emissão (N2) entra atrás de um provedor, nesta mesma rota `/fiscal`.
 */
@Controller('fiscal')
@UseGuards(RolesGuard)
@Roles(...PAPEIS_DO_FISCAL)
export class NotasFiscaisController {
  constructor(private readonly perfil: PerfilFiscalService) {}

  /** GET /fiscal/perfil — configuração, operações (com sugestões) e dados da loja. */
  @Get('perfil')
  obter(@Req() req: AuthRequest): Promise<unknown> {
    return this.perfil.obter(escopoDa(req.user));
  }

  @Put('perfil')
  salvar(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    return this.perfil.salvarConfiguracao(escopoDa(req.user), req.user, perfilFiscalSchema.parse(body));
  }

  /** POST /fiscal/perfil/operacoes/padrao — cria as operações que faltam, com as sugestões. */
  @Post('perfil/operacoes/padrao')
  semear(@Req() req: AuthRequest): Promise<unknown> {
    return this.perfil.semearOperacoes(escopoDa(req.user), req.user);
  }

  @Put('perfil/operacoes/:operacao')
  salvarOperacao(
    @Req() req: AuthRequest,
    @Param('operacao') operacao: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.perfil.salvarOperacao(
      escopoDa(req.user), req.user, operacao, perfilDeOperacaoSchema.parse(body),
    );
  }

  /** POST /fiscal/perfil/confirmacao-do-contador — a loja registra que o contador conferiu. */
  @Post('perfil/confirmacao-do-contador')
  confirmar(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    return this.perfil.confirmarPeloContador(
      escopoDa(req.user), req.user, confirmacaoDoContadorSchema.parse(body),
    );
  }

  @Get('veiculos/:id')
  dadosDoVeiculo(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.perfil.dadosDoVeiculo(escopoDa(req.user), id);
  }

  @Put('veiculos/:id')
  salvarDadosDoVeiculo(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.perfil.salvarDadosDoVeiculo(
      escopoDa(req.user), req.user, id, dadosFiscaisDoVeiculoSchema.parse(body),
    );
  }

  /** GET /fiscal/negocios/:id/previa — a nota que o negócio geraria, ou o que falta. */
  @Get('negocios/:id/previa')
  previa(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    const { presencial } = previaQuerySchema.parse(query);
    return this.perfil.previaDoNegocio(escopoDa(req.user), id, presencial);
  }
}
