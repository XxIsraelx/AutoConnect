import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PerfilFiscalService, PAPEIS_DO_FISCAL } from './perfil-fiscal.service';
import { EmissaoDeNotaService } from './emissao.service';
import { periodoEmBrasilia, RelatorioFiscalService } from './relatorio-fiscal.service';
import { Public } from '../../common/decorators/public.decorator';
import { escopoDa } from '../../common/escopo';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  cancelarNotaSchema, confirmacaoDoContadorSchema, periodoDeExportacaoSchema, dadosFiscaisDoVeiculoSchema,
  emitirNotaDoNegocioSchema, perfilDeOperacaoSchema, perfilFiscalSchema, quemEntregouSchema,
  simularRetornoDaNotaSchema,
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
  constructor(
    private readonly perfil: PerfilFiscalService,
    private readonly emissao: EmissaoDeNotaService,
    private readonly relatorios: RelatorioFiscalService,
  ) {}

  /* ── Ponte com o contador (N4) ────────────────────────── */

  /** GET /fiscal/notas?from=&to= — as notas do período, com totais e pendências. */
  @Get('notas')
  notasDoPeriodo(@Req() req: AuthRequest, @Query() query: unknown): Promise<unknown> {
    const { from, to } = periodoDeExportacaoSchema.parse(query);
    return this.relatorios.relatorio(escopoDa(req.user), periodoEmBrasilia(from, to));
  }

  /** GET /fiscal/notas.csv?from=&to= — o índice do período, para planilha. */
  @Get('notas.csv')
  async notasCsv(@Req() req: AuthRequest, @Query() query: unknown, @Res() res: Response): Promise<void> {
    const { from, to } = periodoDeExportacaoSchema.parse(query);
    const csv = await this.relatorios.csv(escopoDa(req.user), periodoEmBrasilia(from, to));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="notas-fiscais_${from.slice(0, 10)}_a_${to.slice(0, 10)}.csv"`);
    res.send(csv);
  }

  /** GET /fiscal/notas/pacote.zip?from=&to= — XMLs + índice, o que o contador pede todo mês. */
  @Get('notas/pacote.zip')
  async pacote(@Req() req: AuthRequest, @Query() query: unknown, @Res() res: Response): Promise<void> {
    const { from, to } = periodoDeExportacaoSchema.parse(query);
    const zip = await this.relatorios.pacote(escopoDa(req.user), periodoEmBrasilia(from, to));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="notas-fiscais_${from.slice(0, 10)}_a_${to.slice(0, 10)}.zip"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(zip);
  }

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

  /* ── Emissão (N2) ─────────────────────────────────────── */

  /** GET /fiscal/emissor — se há emissor, se é homologação, se é simulado. */
  @Get('emissor')
  emissor(): unknown {
    return this.emissao.capacidade();
  }

  @Get('negocios/:id/notas')
  notasDoNegocio(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.emissao.listarDoNegocio(escopoDa(req.user), id);
  }

  /** POST /fiscal/negocios/:id/notas — emite a nota de saída do negócio. */
  @Post('negocios/:id/notas')
  emitir(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { presencial } = emitirNotaDoNegocioSchema.parse(body ?? {});
    return this.emissao.emitir(escopoDa(req.user), req.user, id, presencial);
  }

  /* ── Nota de entrada (N2b) ───────────────────────────── */

  /** GET /fiscal/veiculos/:id/quem-entregou — o remetente da nota de entrada. */
  @Get('veiculos/:id/quem-entregou')
  quemEntregou(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.perfil.quemEntregou(escopoDa(req.user), id);
  }

  @Put('veiculos/:id/quem-entregou')
  salvarQuemEntregou(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.perfil.salvarQuemEntregou(escopoDa(req.user), req.user, id, quemEntregouSchema.parse(body));
  }

  @Get('veiculos/:id/entrada/previa')
  previaDaEntrada(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    const { presencial } = previaQuerySchema.parse(query);
    return this.perfil.previaDaAquisicao(escopoDa(req.user), id, presencial);
  }

  @Get('veiculos/:id/entrada/notas')
  notasDeEntrada(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.emissao.listarDaAquisicao(escopoDa(req.user), id);
  }

  /** POST /fiscal/veiculos/:id/entrada/notas — emite a nota de entrada do veículo. */
  @Post('veiculos/:id/entrada/notas')
  emitirEntrada(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { presencial } = emitirNotaDoNegocioSchema.parse(body ?? {});
    return this.emissao.emitirEntrada(escopoDa(req.user), req.user, id, presencial);
  }

  /** POST /fiscal/notas/:id/consultar — pergunta ao emissor em que pé a nota está. */
  @Post('notas/:id/consultar')
  consultar(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.emissao.consultar(escopoDa(req.user), id);
  }

  @Post('notas/:id/cancelar')
  cancelar(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { justificativa } = cancelarNotaSchema.parse(body);
    return this.emissao.cancelar(escopoDa(req.user), req.user, id, justificativa);
  }

  @Get('notas/:id/xml')
  xml(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    return this.entregar(req, id, 'xml', res);
  }

  @Get('notas/:id/danfe')
  danfe(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    return this.entregar(req, id, 'danfe', res);
  }

  private async entregar(req: AuthRequest, id: string, tipo: 'xml' | 'danfe', res: Response): Promise<void> {
    const arquivo = await this.emissao.arquivo(escopoDa(req.user), id, tipo);
    res.setHeader('Content-Type', arquivo.tipo);
    res.setHeader('Content-Disposition', `attachment; filename="${arquivo.nome}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(arquivo.conteudo);
  }

  /** Só com o emissor simulado, fora de produção (404 no resto). */
  @Post('notas/:id/simular')
  simular(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { acao } = simularRetornoDaNotaSchema.parse(body);
    return this.emissao.simular(escopoDa(req.user), id, acao);
  }
}

/**
 * Entrada do emissor. Pública porque quem chama é o emissor, não um usuário:
 * a autenticação é o token do cabeçalho, conferido pelo adaptador em tempo
 * constante. O corpo chega **cru** (`corpoCru` no `app.setup.ts`), porque o
 * evento é guardado como veio.
 */
@Controller('webhooks')
export class WebhookNotaFiscalController {
  constructor(private readonly emissao: EmissaoDeNotaService) {}

  @Public()
  @Post('nota-fiscal')
  @HttpCode(200)
  receber(@Req() req: Request): Promise<unknown> {
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return this.emissao.receberWebhook(req.headers, corpo);
  }
}
