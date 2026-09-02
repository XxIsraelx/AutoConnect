import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  configureApp(app);

  const config = app.get(ConfigService);
  // Plataformas de hospedagem (Railway, Render, Fly) injetam a porta em PORT e
  // esperam bind em 0.0.0.0 — sem isso o healthcheck não alcança o processo.
  const port = Number(process.env.PORT) || config.get<number>('API_PORT') || 4000;

  await app.listen(port, '0.0.0.0');
  Logger.log(`AutoConnect API running on port ${port} (prefixo /api/v1)`, 'Bootstrap');
}

bootstrap();
