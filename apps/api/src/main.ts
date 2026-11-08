import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Nest lit AppModule, construit tous les objets et leurs dépendances, puis prépare le serveur HTTP.
  const app = await NestFactory.create(AppModule);

  const port = Number(process.env.API_PORT ?? 3000);

  // '127.0.0.1' : l'API n'écoute que sur ton ordinateur, pas sur le réseau.
  await app.listen(port, '127.0.0.1');
  console.log(`API prête sur http://127.0.0.1:${port}`);
}

bootstrap();
