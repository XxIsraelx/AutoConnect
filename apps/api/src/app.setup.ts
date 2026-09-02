import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ZodFilter } from './common/filters/zod.filter';

/**
 * Configuração da aplicação — prefixo, filtros, pipes e CORS.
 *
 * Vive fora do `bootstrap()` para que os testes subam a app com exatamente a
 * mesma configuração da produção. Se isto morasse no `main.ts`, o teste
 * exercitaria uma app sem prefixo `/api/v1` e sem o `ZodFilter`, e passaria
 * verde sobre um comportamento que ninguém roda de verdade.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.useGlobalFilters(new ZodFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: criarVerificadorDeOrigem(),
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  return app;
}

/**
 * Aceita as origens configuradas (localhost + o IP da rede local, usado para
 * testar no celular). Em dev, libera localhost em qualquer porta — previews e
 * ferramentas locais sobem em portas variáveis.
 */
function criarVerificadorDeOrigem() {
  const webUrl = process.env.WEB_URL ?? 'http://localhost:3000';
  const permitidas = [...new Set(['http://localhost:3000', 'http://127.0.0.1:3000', webUrl])];

  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Requisições sem origin (curl, Postman, SSR do próprio Next) passam.
    if (!origin) return callback(null, true);
    if (permitidas.includes(origin)) return callback(null, true);
    if (
      process.env.NODE_ENV !== 'production' &&
      /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
    ) {
      return callback(null, true);
    }
    callback(new Error(`CORS bloqueado para origem: ${origin}`));
  };
}
