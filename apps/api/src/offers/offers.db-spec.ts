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
import { ScoringService } from '../scoring/scoring.service';

describe('Offres et scoring (e2e, base réelle)', () => {
  const PASSWORD = 'un-mot-de-passe-solide-1234';
  const HOME = { latitude: 48.860162, longitude: 2.381844 };

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let cookie: string;

  const seed = (id: string, extra: Record<string, unknown> = {}) =>
    prisma.offer.create({
      data: {
        source: 'LBA',
        externalId: id,
        dedupKey: id,
        title: `Offre ${id}`,
        company: 'Exemple SA',
        channel: 'SITE',
        description: 'Longue description confidentielle',
        ...extra,
      },
    });

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
    cookie = ((res.headers['set-cookie'] as unknown as string[])[0] ?? '').split(';')[0] ?? '';
  });

  afterEach(async () => {
    await app.close();
  });

  describe('ScoringService', () => {
    it('note toutes les offres et enregistre le détail par critère', async () => {
      const now = new Date();
      await seed('bonne', {
        title: 'Alternance TypeScript React',
        description: 'Node.js et Docker. 2 jours / 3 jours',
        publishedAt: now,
        latitude: 48.87,
        longitude: 2.4,
        applyUrl: 'https://exemple.test/a',
      });
      await seed('faible', {
        title: 'Comptable',
        publishedAt: new Date(now.getTime() - 90 * 86_400_000),
      });

      const count = await app.get(ScoringService).rescoreAll(exampleProfile(), HOME, now);

      expect(count).toBe(2);
      const good = await prisma.offer.findFirstOrThrow({ where: { externalId: 'bonne' } });
      const weak = await prisma.offer.findFirstOrThrow({ where: { externalId: 'faible' } });
      expect(good.score).toBeGreaterThan(weak.score ?? 0);
      expect(good.scoreDetail).toMatchObject({
        total: good.score,
        stack: 25,
        rhythm: 15,
        detectedRhythm: '2J_3J',
      });
    });

    it('recalcule : la fraîcheur baisse avec le temps', async () => {
      const published = new Date('2026-11-01T00:00:00Z');
      await seed('a', { publishedAt: published });
      const scoring = app.get(ScoringService);

      await scoring.rescoreAll(exampleProfile(), HOME, new Date('2026-11-02T00:00:00Z'));
      const early = (await prisma.offer.findFirstOrThrow()).score ?? 0;
      await scoring.rescoreAll(exampleProfile(), HOME, new Date('2027-01-01T00:00:00Z'));
      const late = (await prisma.offer.findFirstOrThrow()).score ?? 0;

      expect(late).toBeLessThan(early);
    });

    it('traite un grand nombre d’offres par lots', async () => {
      await prisma.offer.createMany({
        data: Array.from({ length: 450 }, (_, i) => ({
          source: 'LBA' as const,
          externalId: `lot-${i}`,
          dedupKey: `lot-${i}`,
          title: 'Offre',
          company: 'X',
          channel: 'SITE' as const,
        })),
      });

      expect(await app.get(ScoringService).rescoreAll(exampleProfile(), HOME)).toBe(450);
      expect(await prisma.offer.count({ where: { score: null } })).toBe(0);
    });
  });

  describe('GET /offers', () => {
    it('exige une connexion', async () => {
      await http.get('/offers').expect(401);
      await http.get('/offers/00000000-0000-4000-8000-000000000000').expect(401);
    });

    it('classe par score décroissant, offres non notées à la fin, sans la description', async () => {
      await seed('moyen', { score: 50 });
      await seed('haut', { score: 90 });
      await seed('sans-score');
      await seed('bas', { score: 10 });

      const res = await http.get('/offers').set('Cookie', cookie).expect(200);

      const body = res.body as { total: number; items: { externalId?: string; title: string }[] };
      expect(body.total).toBe(4);
      expect(body.items.map((i) => i.title)).toEqual([
        'Offre haut',
        'Offre moyen',
        'Offre bas',
        'Offre sans-score',
      ]);
      expect(JSON.stringify(res.body)).not.toContain('confidentielle');
    });

    it('pagine de façon stable quand score et date sont identiques', async () => {
      const same = new Date();
      for (let i = 0; i < 6; i++) await seed(`eq${i}`, { score: 50, firstSeenAt: same });

      const titles: string[] = [];
      for (const offset of [0, 2, 4]) {
        const res = await http
          .get(`/offers?limit=2&offset=${offset}`)
          .set('Cookie', cookie)
          .expect(200);
        titles.push(...(res.body as { items: { title: string }[] }).items.map((i) => i.title));
      }

      expect(new Set(titles).size).toBe(6);
    });

    it('filtre par score minimum et pagine', async () => {
      for (let i = 1; i <= 5; i++) await seed(`o${i}`, { score: i * 10 });

      const filtered = await http.get('/offers?minScore=30').set('Cookie', cookie).expect(200);
      expect((filtered.body as { total: number }).total).toBe(3);

      const page = await http.get('/offers?limit=2&offset=1').set('Cookie', cookie).expect(200);
      expect((page.body as { items: { title: string }[] }).items.map((i) => i.title)).toEqual([
        'Offre o4',
        'Offre o3',
      ]);
    });

    it.each(['limit=0', 'limit=201', 'limit=abc', 'offset=-1', 'minScore=101'])(
      'refuse le paramètre invalide « %s » (400)',
      async (query) => {
        await http.get(`/offers?${query}`).set('Cookie', cookie).expect(400);
      },
    );

    it('indique pour chaque offre si une candidature existe et à quel stade', async () => {
      const withLetter = await seed('avec', { score: 80 });
      await seed('sans', { score: 70 });
      const application = await prisma.application.create({
        data: { offerId: withLetter.id, subject: 'Objet', body: 'Texte' },
      });

      const res = await http.get('/offers').set('Cookie', cookie).expect(200);

      const items = (res.body as { items: { title: string; application: unknown }[] }).items;
      expect(items.find((i) => i.title === 'Offre avec')?.application).toEqual({
        id: application.id,
        status: 'TO_REVIEW',
      });
      expect(items.find((i) => i.title === 'Offre sans')?.application).toBeNull();
    });

    it('renvoie une liste vide sans erreur', async () => {
      const res = await http.get('/offers').set('Cookie', cookie).expect(200);

      expect(res.body).toEqual({ total: 0, items: [] });
    });
  });

  describe('GET /offers/:id', () => {
    it('renvoie le détail complet, description comprise', async () => {
      const offer = await seed('une', { score: 70, scoreDetail: { total: 70 } });

      const res = await http.get(`/offers/${offer.id}`).set('Cookie', cookie).expect(200);

      expect(res.body).toMatchObject({
        id: offer.id,
        title: 'Offre une',
        description: 'Longue description confidentielle',
        scoreDetail: { total: 70 },
      });
      expect(res.body).not.toHaveProperty('dedupKey');
    });

    it('répond 404 pour une offre inconnue et 400 pour un identifiant mal formé', async () => {
      await http
        .get('/offers/00000000-0000-4000-8000-000000000000')
        .set('Cookie', cookie)
        .expect(404);
      await http.get('/offers/pas-un-uuid').set('Cookie', cookie).expect(400);
      await http.get("/offers/1' OR '1'='1").set('Cookie', cookie).expect(400);
    });
  });
});
