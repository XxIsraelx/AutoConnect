import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ZodError, ZodIssue } from 'zod';

/** Erro de campo no formato que `apps/web` consome em `ApiError.fieldErrors`. */
interface ErroDeCampo {
  field: string;
  message: string;
}

/**
 * `unrecognized_keys` (o que `.strict()` produz) vem com `path` **vazio** e as
 * chaves numa lista à parte. Traduzido cru, chega à tela como um erro sem
 * campo — exatamente o "Validation failed" solto que o CLAUDE.md manda evitar.
 * Aqui ele vira uma entrada por chave, com o nome do campo no `field`.
 */
function paraErrosDeCampo(issue: ZodIssue): ErroDeCampo[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((chave) => ({
      field: [...issue.path, chave].join('.'),
      message: 'Campo desconhecido — a API não sabe gravar isto.',
    }));
  }
  return [{ field: issue.path.join('.'), message: issue.message }];
}

@Catch(ZodError)
export class ZodFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Validation failed',
      errors: exception.errors.flatMap(paraErrosDeCampo),
    });
  }
}
