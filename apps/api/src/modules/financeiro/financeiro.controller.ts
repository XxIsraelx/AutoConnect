import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { BOM } from '../../common/csv';
import { FinanceiroService, PAPEIS_DO_FINANCEIRO } from './financeiro.service';
import { ConciliacaoService } from './conciliacao.service';
import { escopoDa } from '../../common/escopo';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  atualizarCategoriaFinanceiraSchema, atualizarContaFinanceiraSchema,
  atualizarLancamentoSchema, baixaSchema, cancelarLancamentoSchema,
  categoriaFinanceiraSchema, contaFinanceiraSchema, fecharMesSchema,
  lancamentoSchema, listarLancamentosSchema, reabrirMesSchema, fluxoQuerySchema,
  importarOfxSchema, conciliarSchema, periodoDeExportacaoSchema,
} from '@autoconnect/shared';

interface AuthRequest {
  user: { id: string; role: string; tenantId: string | null };
}

/**
 * Financeiro da loja — `manager` para cima.
 *
 * O vendedor não entra: o caixa da loja é a informação que ele não precisa para
 * vender e que a loja menos quer circulando. Mesma razão da carteira fechada por
 * padrão e do CSV de clientes restrito à gerência.
 *
 * Todo corpo passa por Zod `.strict()`. Não é zelo: `PATCH /tenant/me` com o
 * corpo só anotado deixou um `tenant_admin` desativar a própria loja em setembro,
 * e aqui o campo a mais mudaria dinheiro.
 */
@Controller('financeiro')
@UseGuards(RolesGuard)
@Roles(...PAPEIS_DO_FINANCEIRO)
export class FinanceiroController {
  constructor(
    private readonly financeiro: FinanceiroService,
    private readonly conciliacao: ConciliacaoService,
  ) {}

  /** GET /financeiro/resumo — saldo, o que vence, o que atrasou, o mês. */
  @Get('resumo')
  resumo(@Req() req: AuthRequest): Promise<unknown> {
    return this.financeiro.resumo(escopoDa(req.user));
  }

  /**
   * GET /financeiro/fluxo?dias=30 — o caixa dia a dia, daqui para frente.
   *
   * Responde "em que dia o caixa fica negativo", que é a pergunta semanal do
   * dono e que nenhuma outra tela responde.
   */
  @Get('fluxo')
  fluxo(@Req() req: AuthRequest, @Query() query: unknown): Promise<unknown> {
    const { dias } = fluxoQuerySchema.parse(query);
    return this.financeiro.fluxoDeCaixa(escopoDa(req.user), dias);
  }

  /** GET /financeiro/dre?year=2026&month=9 — o resultado gerencial do mês. */
  @Get('dre')
  dre(@Req() req: AuthRequest, @Query() query: unknown): Promise<unknown> {
    const { year, month } = fecharMesSchema.parse(query);
    return this.financeiro.dre(escopoDa(req.user), year, month);
  }

  /* ── Contas ─────────────────────────────────────────────── */

  @Get('contas')
  contas(@Req() req: AuthRequest): Promise<unknown> {
    return this.financeiro.listarContas(escopoDa(req.user));
  }

  @Post('contas')
  criarConta(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    return this.financeiro.criarConta(escopoDa(req.user), contaFinanceiraSchema.parse(body));
  }

  @Patch('contas/:id')
  atualizarConta(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.financeiro.atualizarConta(
      escopoDa(req.user), id, atualizarContaFinanceiraSchema.parse(body),
    );
  }

  /* ── Categorias ─────────────────────────────────────────── */

  @Get('categorias')
  categorias(@Req() req: AuthRequest): Promise<unknown> {
    return this.financeiro.listarCategorias(escopoDa(req.user));
  }

  /** POST, não escrita escondida num GET: a tela pede, o lojista decide. */
  @Post('categorias/padrao')
  semearCategorias(@Req() req: AuthRequest): Promise<unknown> {
    return this.financeiro.semearCategorias(escopoDa(req.user));
  }

  @Post('categorias')
  criarCategoria(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    return this.financeiro.criarCategoria(escopoDa(req.user), categoriaFinanceiraSchema.parse(body));
  }

  @Patch('categorias/:id')
  atualizarCategoria(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.financeiro.atualizarCategoria(
      escopoDa(req.user), id, atualizarCategoriaFinanceiraSchema.parse(body),
    );
  }

  /* ── Lançamentos ────────────────────────────────────────── */

  @Get('lancamentos')
  lancamentos(@Req() req: AuthRequest, @Query() query: unknown): Promise<unknown> {
    return this.financeiro.listarLancamentos(escopoDa(req.user), listarLancamentosSchema.parse(query));
  }

  @Post('lancamentos')
  criarLancamento(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    return this.financeiro.criarLancamento(
      escopoDa(req.user), lancamentoSchema.parse(body), req.user,
    );
  }

  @Patch('lancamentos/:id')
  atualizarLancamento(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.financeiro.atualizarLancamento(
      escopoDa(req.user), id, atualizarLancamentoSchema.parse(body),
    );
  }

  /** Idempotente: dois cliques no botão não viram dois pagamentos. */
  @Post('lancamentos/:id/baixa')
  darBaixa(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.financeiro.darBaixa(escopoDa(req.user), id, baixaSchema.parse(body));
  }

  @Post('lancamentos/:id/cancelar')
  cancelarLancamento(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { motivo } = cancelarLancamentoSchema.parse(body);
    return this.financeiro.cancelarLancamento(escopoDa(req.user), id, motivo);
  }

  /**
   * GET /financeiro/lancamentos.csv?from=&to= — o período para o contador.
   *
   * Fica no financeiro, e não em `/tenant/reports`, porque o recorte de quem vê
   * é outro: relatório é de gerente para cima **e vendedor na própria carteira**;
   * o caixa da loja não é do vendedor em nenhuma fatia.
   */
  @Get('lancamentos.csv')
  async csvParaOContador(
    @Req() req: AuthRequest,
    @Res() res: Response,
    @Query() query: unknown,
  ): Promise<void> {
    const { from, to } = periodoDeExportacaoSchema.parse(query);
    const csv = await this.financeiro.csvDeLancamentos(
      escopoDa(req.user), new Date(from), new Date(to),
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="financeiro_${from}_a_${to}.csv"`);
    res.send(BOM + csv);
  }

  /* ── Conciliação bancária ───────────────────────────────── */

  /** POST /financeiro/contas/:id/ofx — importa o extrato. */
  @Post('contas/:id/ofx')
  importarOfx(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const { conteudo } = importarOfxSchema.parse(body);
    return this.conciliacao.importarOfx(escopoDa(req.user), id, conteudo);
  }

  /** GET /financeiro/contas/:id/conciliacao — o que sobra dos dois lados. */
  @Get('contas/:id/conciliacao')
  pendencias(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.conciliacao.pendencias(escopoDa(req.user), id);
  }

  /** POST /financeiro/conciliacoes — confirma o par sugerido (ou outro). */
  @Post('conciliacoes')
  conciliar(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    const { transacaoId, lancamentoId } = conciliarSchema.parse(body);
    return this.conciliacao.conciliar(escopoDa(req.user), transacaoId, lancamentoId);
  }

  /** POST /financeiro/conciliacoes/:id/ignorar — "não é da loja". */
  @Post('conciliacoes/:id/ignorar')
  ignorar(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.conciliacao.ignorar(escopoDa(req.user), id);
  }

  /* ── Fechamento ─────────────────────────────────────────── */

  @Get('periodos')
  periodos(@Req() req: AuthRequest): Promise<unknown> {
    return this.financeiro.listarPeriodos(escopoDa(req.user));
  }

  @Post('periodos/fechar')
  fechar(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    const { year, month } = fecharMesSchema.parse(body);
    return this.financeiro.fecharMes(escopoDa(req.user), year, month, req.user);
  }

  @Post('periodos/reabrir')
  reabrir(@Req() req: AuthRequest, @Body() body: unknown): Promise<unknown> {
    const { year, month, motivo } = reabrirMesSchema.parse(body);
    return this.financeiro.reabrirMes(escopoDa(req.user), year, month, motivo, req.user);
  }
}
