import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // On utilise un pipe pour valider les données entrantes dans les requêtes POST (permet de déclarer un modele de données genre comme ZOD)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // FIlter les données inutiles
      transform: true,
    }),
  );

  app.use(
    '/stripe/webhook',
    bodyParser.raw({ type: 'application/json' }),
  );

  const corsOptions = {
    origin: [
    process.env.FRONT_URL,
    "http://localhost:3000",
    ],
    credentials: true, // Permet d'envoyer des cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };

  app.enableCors(corsOptions);

  // Configuration WebSocket - les WebSocketGateway doivent être configurés avec les mêmes origins
  // Vérification prudente de l'instance HTTP (type-safe, sans assignation de any)
  const httpServer = app.getHttpServer() as unknown;
  if (
    httpServer &&
    typeof httpServer === 'object' &&
    '_events' in httpServer &&
    (httpServer as { _events?: Record<string, unknown> })._events &&
    'connection' in (httpServer as { _events?: Record<string, unknown> })._events!
  ) {
    // WebSocket est actif, les gateways utiliseront la configuration définie dans @WebSocketGateway
  }

  await app.listen(process.env.PORT ?? 4000);
}

bootstrap().catch((error) => {
  console.error('Error during application bootstrap:', error);
});
