import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { parseEnv } from './config/env';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * En développement, charge le .env du dépôt. En production, l'environnement fournit déjà les variables.
 * Renvoie le fichier chargé, pour qu'on sache d'où vient la configuration (jamais son contenu).
 */
function loadDotEnv(): string | undefined {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  const file = candidates.find((path) => existsSync(path));
  if (file) {
    process.loadEnvFile(file);
  }
  return file;
}

async function bootstrap() {
  if (process.env.NODE_ENV !== 'production') {
    const file = loadDotEnv();
    console.log(
      file
        ? `Configuration chargée depuis ${file}`
        : 'Aucun fichier .env trouvé : variables du processus et valeurs par défaut uniquement.',
    );
  }

  // Échoue tout de suite, avec la liste des variables invalides, plutôt que de démarrer mal configuré.
  const env = parseEnv();

  if (env.NODE_ENV !== 'production' && !LOCAL_HOSTS.has(env.API_HOST)) {
    console.warn(
      `Attention : l'API écoute sur ${env.API_HOST}, donc depuis tout le réseau, sans authentification.`,
    );
  }

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
