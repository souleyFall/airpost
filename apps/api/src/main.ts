import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { parseEnv } from './config/env';

/** En développement, charge le .env du dépôt. En production, l'environnement fournit déjà les variables. */
function loadDotEnv(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  const file = candidates.find((path) => existsSync(path));
  if (file) {
    process.loadEnvFile(file);
  }
}

async function bootstrap() {
  if (process.env.NODE_ENV !== 'production') {
    loadDotEnv();
  }

  // Échoue tout de suite, avec la liste des variables invalides, plutôt que de démarrer mal configuré.
  const env = parseEnv();

  // Nest lit AppModule, construit tous les objets et leurs dépendances, puis prépare le serveur HTTP.
  const app = await NestFactory.create(AppModule);
  configureApp(app, env);

  // Par défaut l'API n'écoute que sur 127.0.0.1 : pas sur le réseau.
  await app.listen(env.API_PORT, env.API_HOST);
  console.log(`API prête sur http://${env.API_HOST}:${env.API_PORT}`);
}

// Si le démarrage échoue, on affiche l'erreur et on quitte avec un code non nul (Docker le détecte).
bootstrap().catch((error: unknown) => {
  console.error('Échec du démarrage de l’API', error);
  process.exit(1);
});
