import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { parseEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { hashToken } from './session.service';

// Parcours complet de connexion contre un vrai PostgreSQL (voir test/db-global-setup.ts).
describe('Authentification (e2e, base réelle)', () => {
  const LOGIN = 'souleymane';
  const PASSWORD = 'un-mot-de-passe-solide-1234';

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;

  /** Une application neuve par test : le compteur de limitation de débit repart de zéro. */
  async function start(env: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(env)) {
      vi.stubEnv(name, value);
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, parseEnv());
    await app.init();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer() as Server);
    await prisma.user.deleteMany();
    await prisma.user.create({
      data: { login: LOGIN, passwordHash: await new PasswordService().hash(PASSWORD) },
    });
  }

  beforeEach(async () => {
    await start();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const login = (body: object = { login: LOGIN, password: PASSWORD }) =>
    http.post('/auth/login').send(body);

  /** Ouvre une session et renvoie le cookie à rejouer et le jeton CSRF. */
  async function connect() {
    const res = await login().expect(200);
    const setCookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    return {
      cookie: setCookie.split(';')[0] ?? '',
      csrf: (res.body as { csrfToken: string }).csrfToken,
    };
  }

  it('connecte avec les bons identifiants : cookie de session durci et jeton CSRF', async () => {
    const res = await login().expect(200);

    const setCookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(setCookie).toMatch(/^airpost_session=[\w-]{40,}/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toMatch(/Expires=/);
    // Hors production, pas de Secure : le développement se fait en http://localhost.
    expect(setCookie).not.toContain('Secure');
    expect(res.body).toMatchObject({ login: LOGIN });
    expect((res.body as { csrfToken: string }).csrfToken).toHaveLength(43);
    expect(JSON.stringify(res.body)).not.toMatch(/hash|argon2|password/i);
  });

  it('refuse une connexion qui n’est pas du JSON (formulaire posté depuis un autre site)', async () => {
    await http
      .post('/auth/login')
      .type('form')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(415);
  });

  it('en production, le cookie est Secure avec le préfixe __Host-', async () => {
    await app.close();
    await start({ NODE_ENV: 'production' });

    const res = await login().expect(200);

    const setCookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(setCookie).toMatch(/^__Host-airpost_session=/);
    expect(setCookie).toContain('Secure');
    expect(setCookie).not.toContain('Domain');
  });

  it('SESSION_COOKIE_SECURE=false permet l’usage local en http, même en production', async () => {
    await app.close();
    await start({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' });

    const res = await login().expect(200);

    const setCookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(setCookie).toMatch(/^airpost_session=/);
    expect(setCookie).not.toContain('Secure');
  });

  it('ne stocke que l’empreinte du jeton, jamais le jeton', async () => {
    const { cookie } = await connect();
    const token = cookie.split('=')[1] ?? '';

    const sessions = await prisma.session.findMany();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).toBe(hashToken(token));
    expect(sessions[0]?.tokenHash).not.toContain(token);
  });

  it('répond pareil pour un mot de passe faux et pour un identifiant inconnu', async () => {
    const wrongPassword = await login({ login: LOGIN, password: 'mauvais' }).expect(401);
    const unknownUser = await login({ login: 'inconnu', password: PASSWORD }).expect(401);

    expect(wrongPassword.body).toEqual(unknownUser.body);
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
  });

  it('refuse un corps invalide (400) sans recopier le mot de passe reçu', async () => {
    const res = await login({ login: LOGIN, password: 123 }).expect(400);

    expect(JSON.stringify(res.body)).not.toContain('123');
    expect(res.body).toMatchObject({ errors: [{ champ: 'password' }] });
  });

  it('limite à 5 tentatives de connexion par minute (429 ensuite)', async () => {
    for (let i = 0; i < 5; i++) {
      await login({ login: LOGIN, password: 'mauvais' }).expect(401);
    }

    const res = await login().expect(429);

    expect(res.headers['retry-after']).toBeDefined();
  });

  it('refuse l’accès sans session (401) et laisse /health public', async () => {
    await http.get('/auth/me').expect(401);
    await http.get('/health').expect(200);
  });

  it('donne l’utilisateur et le jeton CSRF à qui présente le cookie', async () => {
    const { cookie, csrf } = await connect();

    const res = await http.get('/auth/me').set('Cookie', cookie).expect(200);

    expect(res.body).toEqual({ login: LOGIN, csrfToken: csrf });
  });

  it('refuse un cookie falsifié', async () => {
    await http.get('/auth/me').set('Cookie', 'airpost_session=falsifie').expect(401);
  });

  it('refuse une session expirée', async () => {
    const { cookie } = await connect();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    await http.get('/auth/me').set('Cookie', cookie).expect(401);
  });

  it('crée un jeton différent à chaque connexion (pas de fixation de session)', async () => {
    const first = await connect();
    const second = await connect();

    expect(first.cookie).not.toBe(second.cookie);
    expect(first.csrf).not.toBe(second.csrf);
  });

  it('supprime les sessions expirées lors d’une nouvelle connexion', async () => {
    await connect();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    await connect();

    expect(await prisma.session.count()).toBe(1);
  });

  it('exige le jeton CSRF pour se déconnecter (403 sans lui)', async () => {
    const { cookie } = await connect();

    await http.post('/auth/logout').set('Cookie', cookie).expect(403);
    await http.post('/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', 'faux').expect(403);
    await http.get('/auth/me').set('Cookie', cookie).expect(200);
  });

  it('se déconnecte : session détruite côté serveur, cookie effacé, rejeu refusé', async () => {
    const { cookie, csrf } = await connect();

    const res = await http
      .post('/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .expect(204);

    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/airpost_session=;/);
    expect(await prisma.session.count()).toBe(0);
    // Le cookie volé avant la déconnexion ne sert plus à rien.
    await http.get('/auth/me').set('Cookie', cookie).expect(401);
  });

  it('supprime les sessions avec l’utilisateur', async () => {
    await connect();

    await prisma.user.deleteMany();

    expect(await prisma.session.count()).toBe(0);
  });
});
