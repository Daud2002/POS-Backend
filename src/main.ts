import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = [
    'http://localhost:8080',
    'https://tapntrade.store'
  ];

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true); // allow this origin
      } else {
        callback(new Error('Not allowed by CORS')); // block
      }
    },
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // Add API prefix
  app.setGlobalPrefix('api');

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('POS System API')
    .setDescription('Point of Sale System API Documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Authentication endpoints')
    .addTag('Products', 'Product management endpoints')
    .addTag('Categories', 'Category management endpoints')
    .addTag('Customers', 'Customer management endpoints')
    .addTag('Orders', 'Order management endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation available at: http://localhost:${port}/docs`);
}

bootstrap();
