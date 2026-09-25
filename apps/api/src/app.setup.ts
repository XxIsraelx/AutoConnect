import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ZodFilter } from './common/filters/zod.filter';
import { corpoCru } from './common/middleware/corpo-cru';

/** Rota do webhook de assinatura: precisa dos bytes exatos para o HMAC. */
export const ROTA_WEBHOOK_ASSINATURA = '/api/v1/webhooks/assinatura';

/**
 * Rota do webhook de cobrança. A Asaas não assina o corpo (a autenticidade é
 * o token que ela devolve no cabeçalho), mas o cru é o que se guarda para
 * auditoria e o que vira chave de idempotência quando o evento chega sem id.
 */
export const ROTA_WEBHOOK_COBRANCA = '/api/v1/webhooks/cobranca';

/**
 * Validação de saque da Asaas — a URL cadastrada em *Integrações › Mecanismos
 * de segurança*. O cru aqui é o pedido de saque guardado byte a byte na trilha
 * de auditoria, e o SHA-256 dele é a chave de idempotência de um pedido que
 * chega sem id confiável (ou sem token válido).
 */
export const ROTA_WEBHOOK_SAQUE = '/api/v1/webhooks/asaas/saque';

/**
 * Configuração da aplicação — prefixo, filtros, pipes e CORS.
 *
 * Vive fora do `bootstrap()` para que os testes subam a app com exatamente a
 * mesma configuração da produção. Se isto morasse no `main.ts`, o teste
 * exercitaria uma app sem prefixo `/api/v1` e sem o `ZodFilter`, e passaria
 * verde sobre um comportamento que ninguém roda de verdade.
 */
export function configureApp(app: INestApplication): INestApplication {
  // Antes do parser JSON do Nest (registrado no `init`), e só nesta rota: o
  // HMAC do webhook é calculado sobre o corpo cru, e o JSON reserializado não
  // bateria. As demais rotas seguem com o parser padrão.
  app.use(ROTA_WEBHOOK_ASSINATURA, corpoCru(1024 * 1024));
  app.use(ROTA_WEBHOOK_COBRANCA, corpoCru(1024 * 1024));
  app.use(ROTA_WEBHOOK_SAQUE, corpoCru(1024 * 1024));

  // Um salto de proxy (a borda do Railway). Sem isto, `req.ip` é o IP do
  // proxy para todo mundo, e o limite por IP do formulário público — cinco
  // envios por janela — barraria a internet inteira depois do quinto visitante.
  // O `1` é deliberado: `true` confiaria na cadeia inteira de
  // `X-Forwarded-For`, que o cliente escreve e portanto forja.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

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
