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
import { exampleProfile } from './profile.fixture';

// Profil contre un vrai PostgreSQL, avec la vraie chaîne de sécurité (session, CSRF).
describe('Profil (e2e, base réelle)', () => {
  const PASSWORD = 'un-mot-de-passe-solide-1234';

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, parseEnv());
    await app.init();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer() as Server);
    await prisma.user.deleteMany();
    const passwordHash = await new PasswordService().hash(PASSWORD);
    await prisma.user.createMany({
      data: [
        { login: 'alice', passwordHash },
        { login: 'bob', passwordHash },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function connect(login: string) {
    const res = await http.post('/auth/login').send({ login, password: PASSWORD }).expect(200);
    const setCookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    return {
      cookie: setCookie.split(';')[0] ?? '',
      csrf: (res.body as { csrfToken: string }).csrfToken,
    };
  }

  const put = (session: { cookie: string; csrf: string }, body: unknown) =>
    http
      .put('/profile')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send(body as object);

  it('exige une connexion', async () => {
    await http.get('/profile').expect(401);
    await http.put('/profile').send(exampleProfile()).expect(401);
  });

  it('répond 404 tant que le profil n’est pas renseigné', async () => {
    const alice = await connect('alice');

    await http.get('/profile').set('Cookie', alice.cookie).expect(404);
  });

  it('exige le jeton CSRF pour écrire', async () => {
    const alice = await connect('alice');

    await http.put('/profile').set('Cookie', alice.cookie).send(exampleProfile()).expect(403);
    expect(await prisma.profile.count()).toBe(0);
  });

  it('enregistre puis relit le profil', async () => {
    const alice = await connect('alice');

    const saved = await put(alice, exampleProfile()).expect(200);
    const read = await http.get('/profile').set('Cookie', alice.cookie).expect(200);

    expect(saved.body).toEqual(exampleProfile());
    expect(read.body).toEqual(exampleProfile());
  });

  it('remplace le profil entier à chaque écriture (PUT idempotent, une seule ligne)', async () => {
    const alice = await connect('alice');
    await put(alice, exampleProfile()).expect(200);
    const updated = { ...exampleProfile(), headline: 'Ingénieure logiciel en alternance' };

    await put(alice, updated).expect(200);
    await put(alice, updated).expect(200);

    expect(await prisma.profile.count()).toBe(1);
    const read = await http.get('/profile').set('Cookie', alice.cookie).expect(200);
    expect((read.body as { headline: string }).headline).toBe('Ingénieure logiciel en alternance');
  });

  it('refuse un profil invalide (400) en nommant le champ, sans recopier la valeur', async () => {
    const alice = await connect('alice');
    const invalid = exampleProfile();
    invalid.identity.postcode = 'valeur-secrete-7501';

    const res = await put(alice, invalid).expect(400);

    expect(JSON.stringify(res.body)).toContain('identity.postcode');
    expect(JSON.stringify(res.body)).not.toContain('valeur-secrete-7501');
    expect(await prisma.profile.count()).toBe(0);
  });

  it('refuse les champs inconnus, dont un userId qui viserait le profil d’un autre', async () => {
    const alice = await connect('alice');
    const bob = await prisma.user.findUniqueOrThrow({ where: { login: 'bob' } });

    await put(alice, { ...exampleProfile(), userId: bob.id }).expect(400);

    expect(await prisma.profile.count()).toBe(0);
  });

  it('cloisonne les profils : chacun ne voit que le sien', async () => {
    const alice = await connect('alice');
    const bob = await connect('bob');
    await put(alice, exampleProfile()).expect(200);

    await http.get('/profile').set('Cookie', bob.cookie).expect(404);
    await put(bob, { ...exampleProfile(), headline: 'Profil de Bob' }).expect(200);

    const aliceRead = await http.get('/profile').set('Cookie', alice.cookie).expect(200);
    expect((aliceRead.body as { headline: string }).headline).toBe(
      'Développeur full stack en alternance',
    );
  });

  it('supprime le profil avec l’utilisateur (RGPD : effacement)', async () => {
    const alice = await connect('alice');
    await put(alice, exampleProfile()).expect(200);

    await prisma.user.delete({ where: { login: 'alice' } });

    expect(await prisma.profile.count()).toBe(0);
  });
});
