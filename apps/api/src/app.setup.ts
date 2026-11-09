import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { Env } from './config/env';

/**
 * Réglages HTTP communs à l'application réelle (main.ts) et aux tests d'intégration :
 * c'est ainsi que les tests vérifient exactement ce qui tourne en production.
 */
export function configureApp(app: INestApplication, env: Env): void {
  // En-têtes de sécurité : nosniff, anti-framing, HSTS, CSP restrictive... et suppression de X-Powered-By.
  app.use(helmet());

  // CORS désactivé par défaut. Une seule origine autorisée, jamais « * » : l'API portera des cookies de session.
  if (env.WEB_ORIGIN) {
    app.enableCors({
      origin: env.WEB_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      maxAge: 600,
    });
  }

  // Arrêt propre sur SIGTERM (Docker) : les requêtes en cours se terminent avant la fermeture.
  app.enableShutdownHooks();
}
