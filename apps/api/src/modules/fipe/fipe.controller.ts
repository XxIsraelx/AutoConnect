import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { FipeService } from './fipe.service';

/**
 * A consulta passa por Zod, não por `if` solto.
 *
 * Era um caso vivo da armadilha nº 3 do CLAUDE.md numa rota de leitura: o ano
 * chegava como string, virava `Number` no meio do handler e as duas checagens
 * moravam no controller. Com a escolha de variante entrando na query (`modelCode`),
 * o corpo de entrada cresceu e o lugar da validação deixou de ser opcional.
 */
export const consultaFipeSchema = z.object({
  brandName: z.string().trim().min(1, 'Informe a marca').max(120),
  modelName: z.string().trim().min(1, 'Informe o modelo').max(160),
  versionName: z.string().trim().max(160).optional(),
  engine: z.string().trim().max(60).optional(),
  transmission: z.string().trim().max(40).optional(),
  yearModel: z.coerce
    .number()
    .int('Ano inválido')
    .min(1950, 'Ano inválido')
    .max(new Date().getFullYear() + 1, 'Ano inválido'),
  fuel: z.string().trim().max(40).optional(),
  /** Variante que o lojista escolheu na lista — ganha da heurística. */
  modelCode: z.string().trim().max(40).optional(),
});

@Controller('fipe')
export class FipeController {
  constructor(private readonly svc: FipeService) {}

  /**
   * GET /fipe/estimate?brandName=Fiat&modelName=Argo&versionName=Drive 1.0&yearModel=2022&fuel=flex
   * Retorna `{ found: true, …, confianca, alternativas }` ou `{ found: false }`.
   */
  @Get('estimate')
  async estimate(@Query() query: Record<string, string>) {
    const params = consultaFipeSchema.parse(query);
    const estimate = await this.svc.estimate(params);
    return estimate ? { found: true, ...estimate } : { found: false };
  }

  /**
   * GET /fipe/variantes?brandName=…&modelName=…&yearModel=…
   * As variantes do modelo que têm o ano cadastrado.
   *
   * É a lista que `/veiculos/novo` abre em "Não é este o seu carro? Ver todas as
   * versões" — o caminho para **quando a estimativa tem confiança alta**, caso em
   * que `/fipe/estimate` devolve `alternativas: []` de propósito e o lojista que
   * discorda ficaria sem menu nenhum. Ficou de 22/09 a 27/09/2026 sem nenhum
   * chamador: rota pronta não é funcionalidade (armadilha nº 1 do CLAUDE.md).
   */
  @Get('variantes')
  async variantes(@Query() query: Record<string, string>) {
    const { brandName, modelName, yearModel, fuel } = consultaFipeSchema.parse(query);
    return { variantes: await this.svc.variantes({ brandName, modelName, yearModel, fuel }) };
  }
}
