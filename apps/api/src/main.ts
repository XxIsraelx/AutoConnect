import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ZodFilter } from './common/filters/zod.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  app.useGlobalFilters(new ZodFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Aceita todas as origens configuradas (localhost + IP da rede local para testes no celular)
  const webUrl = process.env.WEB_URL ?? 'http://localhost:3000';
  const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    webUrl,
  ].filter((v, i, arr) => arr.indexOf(v) === i); // remove duplicatas

  app.enableCors({
    origin: (origin, callback) => {
      // Permite requisições sem origin (ex: curl, Postman, SSR do próprio Next)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS bloqueado para origem: ${origin}`));
    },
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  const config = app.get(ConfigService);
  const port = config.get<number>('API_PORT') ?? 4000;

  await app.listen(port);
  Logger.log(`AutoConnect API running on http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap();
