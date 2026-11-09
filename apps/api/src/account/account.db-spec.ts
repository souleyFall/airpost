import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { PasswordService } from '../auth/password.service';
import { parseEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { exampleProfile } from '../profile/profile.fixture';

describe('Compte : export et effacement (e2e, base réelle)', () => {
  const PASSWORD = 'un-mot-de-passe-solide-1234';
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let session: { cookie: string; csrf: string };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, parseEnv());
    await app.init();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer() as Server);
    await prisma.offer.deleteMany();
    await prisma.user.deleteMany();
    await prisma.user.create({
      data: { login: 'alice', passwordHash: await new PasswordService().hash(PASSWORD) },
    });
    const res = await http
      .post('/auth/login')
      .send({ login: 'alice', password: PASSWORD })
      .expect(200);
    session = {
      cookie: ((res.headers['set-cookie'] as unknown as string[])[0] ?? '').split(';')[0] ?? '',
      csrf: (res.body as { csrfToken: string }).csrfToken,
    };
    await http
      .put('/profile')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send(exampleProfile())
      .expect(200);
    const offer = await prisma.offer.create({
      data: {
        source: 'LBA',
        externalId: 'o1',
        dedupKey: 'o1',
        title: 'Alternance développeur',
        company: 'Exemple SA',
        channel: 'SITE',
        contactEmail: 'rh@exemple.test',
      },
    });
    const application = await prisma.application.create({
      data: { offerId: offer.id, subject: 'Objet', body: 'Texte de la lettre' },
    });
    await prisma.reply.create({
      data: {
        applicationId: application.id,
        gmailMessageId: 'm1',
        kind: 'ACKNOWLEDGEMENT',
        receivedAt: new Date(),
        snippet: 'Bien reçu',
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const erase = (password: unknown) =>
    http
      .post('/account/erase')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ password });

  describe('export', () => {
    it('exige une connexion', async () => {
      await http.get('/account/export').expect(401);
    });

    it('renvoie toutes les données en pièce jointe JSON, sans cache', async () => {
      const res = await http.get('/account/export').set('Cookie', session.cookie).expect(200);

      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        account: { login: 'alice' },
        profile: { data: { headline: 'Développeur full stack en alternance' } },
        applications: [
          {
            status: 'TO_REVIEW',
            subject: 'Objet',
            body: 'Texte de la lettre',
            offer: { title: 'Alternance développeur', contactEmail: 'rh@exemple.test' },
            replies: [{ kind: 'ACKNOWLEDGEMENT', snippet: 'Bien reçu' }],
          },
        ],
      });
    });

    it('ne contient jamais l’empreinte du mot de passe ni un jeton de session', async () => {
      const res = await http.get('/account/export').set('Cookie', session.cookie).expect(200);
      const text = JSON.stringify(res.body);
      const user = await prisma.user.findUniqueOrThrow({ where: { login: 'alice' } });
      const row = await prisma.session.findFirstOrThrow();

      expect(text).not.toContain(user.passwordHash);
      expect(text).not.toContain('argon2');
      expect(text).not.toContain(row.tokenHash);
      expect(text).not.toContain(row.csrfToken);
      expect(text).not.toMatch(/passwordHash|tokenHash|csrfToken/);
    });
  });

  describe('effacement', () => {
    it('exige le jeton CSRF', async () => {
      await http
        .post('/account/erase')
        .set('Cookie', session.cookie)
        .send({ password: PASSWORD })
        .expect(403);

      expect(await prisma.user.count()).toBe(1);
    });

    it('refuse un mot de passe faux ou absent sans rien supprimer', async () => {
      await erase('mauvais').expect(403);
      await erase(undefined).expect(400);
      await erase('').expect(400);

      expect(await prisma.user.count()).toBe(1);
      expect(await prisma.application.count()).toBe(1);
    });

    it('refuse un champ en trop (400)', async () => {
      await http
        .post('/account/erase')
        .set('Cookie', session.cookie)
        .set('X-CSRF-Token', session.csrf)
        .send({ password: PASSWORD, tout: true })
        .expect(400);

      expect(await prisma.user.count()).toBe(1);
    });

    it('efface tout avec le bon mot de passe : compte, profil, sessions, offres, candidatures, réponses', async () => {
      const res = await erase(PASSWORD).expect(204);

      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.profile.count()).toBe(0);
      expect(await prisma.session.count()).toBe(0);
      expect(await prisma.offer.count()).toBe(0);
      expect(await prisma.application.count()).toBe(0);
      expect(await prisma.reply.count()).toBe(0);
      expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/airpost_session=;/);
    });

    it('la session ne sert plus après l’effacement', async () => {
      await erase(PASSWORD).expect(204);

      await http.get('/account/export').set('Cookie', session.cookie).expect(401);
      await http.post('/auth/login').send({ login: 'alice', password: PASSWORD }).expect(401);
    });

    it('limite les essais de mot de passe (3 par minute)', async () => {
      for (let i = 0; i < 3; i++) await erase('mauvais').expect(403);

      const res = await erase('mauvais').expect(429);

      expect(res.headers['retry-after']).toBeDefined();
      expect(await prisma.user.count()).toBe(1);
    });
  });
});
