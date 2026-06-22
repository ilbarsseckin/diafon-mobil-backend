import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const { json, urlencoded } = require('express');
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ extended: true, limit: '20mb' }));
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS', allowedHeaders: 'Content-Type,Authorization', credentials: true });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  // Yuklenen fotolara erisim: /uploads/xxx.jpg
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });
  // Ziyaretci web sayfasi (public klasoru)
  app.useStaticAssets(join(__dirname, '..', 'public'), {
    prefix: '/web/',
  });
  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`Diafon Mobil backend calisiyor: port ${port}`);
}
bootstrap();
