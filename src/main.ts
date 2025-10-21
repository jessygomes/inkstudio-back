import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // On utilise un pipe pour valider les données entrantes dans les requêtes POST (permet de déclarer un modele de données genre comme ZOD)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // FIlter les données inutiles
      transform: true,
    }),
  );

  app.enableCors({
    origin: [
      process.env.FRONTEND_URL,
      process.env.FRONTEND_URL_BIS,
      process.env.FRONTEND_URL_FR,
      process.env.FRONTEND_URL_FR_BIS,
    ],
    credentials: true, // Permet d'envoyer des cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((error) => {
  console.error('Error during application bootstrap:', error);
});
