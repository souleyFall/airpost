import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { parseEnv } from './config/env';

describe('Durcissement HTTP (e2e)', () => {
  let app: INestApplication | undefined;

  /** Démarre l'application avec les mêmes réglages que main.ts, sur un environnement de test donné. */
  async function startApp(env: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(env)) {
      vi.stubEnv(name, value);
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, parseEnv());
    await app.init();
    return request(app.getHttpServer() as Server);
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.unstubAllEnvs();
  });

  it('envoie les en-têtes de sécurité et masque X-Powered-By', async () => {
    const http = await startApp();

    const res = await http.get('/health').expect(200);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    // On vérifie le contenu, pas seulement la présence : un Helmet affaibli doit faire échouer le test.
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d{7,}/);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it("n'expose pas la version du service sur la route publique", async () => {
    const http = await startApp();

    const res = await http.get('/health').expect(200);

    expect(res.body).not.toHaveProperty('version');
  });

  it('désactive CORS quand WEB_ORIGIN est absente', async () => {
    const http = await startApp();

    const res = await http.get('/health').set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it("n'autorise que l'origine configurée, jamais « * » ni l'origine de l'appelant", async () => {
    const http = await startApp({ WEB_ORIGIN: 'https://airpost.example' });

    const res = await http.get('/health').set('Origin', 'https://evil.example');

    // Le navigateur compare cette valeur à l'origine de la page : « evil.example » est refusée.
    expect(res.headers['access-control-allow-origin']).toBe('https://airpost.example');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('répond au préambule CORS uniquement avec les méthodes prévues', async () => {
    const http = await startApp({ WEB_ORIGIN: 'https://airpost.example' });

    const res = await http
      .options('/health')
      .set('Origin', 'https://airpost.example')
      .set('Access-Control-Request-Method', 'DELETE')
      .expect(204);

    expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PATCH,PUT,DELETE');
    expect(res.headers['access-control-allow-methods']).not.toContain('TRACE');
  });

  it("n'accepte dans le préambule CORS que les en-têtes de la liste blanche", async () => {
    const http = await startApp({ WEB_ORIGIN: 'https://airpost.example' });

    const res = await http
      .options('/health')
      .set('Origin', 'https://airpost.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type, x-en-tete-inattendu')
      .expect(204);

    expect(res.headers['access-control-allow-headers']).toBe('Content-Type');
  });

  it('limite le débit : 429 au-delà du seuil, avec Retry-After', async () => {
    const http = await startApp({ RATE_LIMIT_MAX: '3', RATE_LIMIT_WINDOW_MS: '60000' });

    for (let i = 0; i < 3; i++) {
      await http.get('/health').expect(200);
    }
    const res = await http.get('/health').expect(429);

    expect(res.headers['retry-after']).toBeDefined();
  });
});
