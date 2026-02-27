import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { RealtimeService } from './realtime/realtime.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const realtimeService = app.get(RealtimeService);

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT || 3000);
  realtimeService.initialize(app.getHttpServer());
  await app.listen(port);
}

bootstrap();
