import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
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
      // Liste blanche d'en-têtes (sans elle, la bibliothèque accepte tout ce que le préambule demande).
      // X-CSRF-Token : jeton anti-CSRF de la session, exigé par l'API sur les requêtes qui modifient.
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      maxAge: 600,
    });
  }

  // Derrière le serveur web de l'application : l'adresse réelle du client vient de X-Forwarded-For,
  // lue seulement à partir du nombre de proxys déclarés (voir TRUST_PROXY dans env.ts).
  if (env.TRUST_PROXY > 0) {
    (app.getHttpAdapter().getInstance() as Express).set('trust proxy', env.TRUST_PROXY);
  }

  // Arrêt propre sur SIGTERM (Docker) : les requêtes en cours se terminent avant la fermeture.
  app.enableShutdownHooks();
}
