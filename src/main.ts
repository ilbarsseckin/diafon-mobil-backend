import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS', allowedHeaders: 'Content-Type,Authorization', credentials: true });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`Diafon Mobil backend calisiyor: port ${port}`);
}
bootstrap();
