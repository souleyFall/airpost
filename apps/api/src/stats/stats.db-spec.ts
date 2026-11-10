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
import type { Stats } from './stats';

describe('Tableau de bord (e2e, base réelle)', () => {
  const PASSWORD = 'un-mot-de-passe-solide-1234';
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let cookie: string;
  const DAY = 86_400_000;
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

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

  const offer = (id: string, source: 'LBA' | 'INDEED' = 'LBA', firstSeenAt = new Date()) =>
    prisma.offer.create({
      data: {
        source,
        externalId: id,
        dedupKey: id,
        title: `Offre ${id}`,
        company: 'Exemple SA',
        channel: 'SITE',
        firstSeenAt,
      },
    });

  it('exige une connexion', async () => {
    await http.get('/stats').expect(401);
  });

  it('base vide : des zéros, sans pourcentage', async () => {
    const res = await http.get('/stats').set('Cookie', cookie).expect(200);

    const stats = res.body as Stats;
    expect(stats.funnel).toMatchObject({
      applied: 0,
      answerRate: null,
      medianDaysToFirstReply: null,
    });
    expect(stats.offers).toMatchObject({ total: 0, newThisWeek: 0 });
    expect(stats.smallSample).toBe(true);
  });

  it('calcule le tunnel, les sources et les relances à partir des vraies lignes', async () => {
    const a = await offer('a', 'LBA');
    const b = await offer('b', 'INDEED');
    const c = await offer('c', 'LBA', daysAgo(30));
    const applied = await prisma.application.create({
      data: {
        offerId: a.id,
        status: 'INTERVIEW',
        subject: 'S',
        body: 'Texte confidentiel de la lettre',
        appliedAt: daysAgo(10),
        followedUpAt: daysAgo(6),
      },
    });
    await prisma.reply.create({
      data: {
        applicationId: applied.id,
        gmailMessageId: 'm1',
        kind: 'INTERVIEW',
        receivedAt: daysAgo(4),
        snippet: 'Extrait confidentiel du mail',
      },
    });
    await prisma.application.create({
      data: { offerId: b.id, status: 'APPLIED', subject: 'S', body: 'T', appliedAt: daysAgo(9) },
    });
    await prisma.application.create({ data: { offerId: c.id, status: 'TO_REVIEW' } });

    const res = await http.get('/stats').set('Cookie', cookie).expect(200);

    const stats = res.body as Stats;
    expect(stats.funnel).toMatchObject({
      applied: 2,
      answered: 1,
      interviews: 1,
      unanswered: 1,
      answerRate: 0.5,
      medianDaysToFirstReply: 6,
    });
    expect(stats.bySource).toEqual([
      { source: 'INDEED', applied: 1, answered: 0, interviews: 0 },
      { source: 'LBA', applied: 1, answered: 1, interviews: 1 },
    ]);
    expect(stats.pipeline).toMatchObject({ toReview: 1, waiting: 1, toFollowUp: 1 });
    expect(stats.followUps).toEqual({ sent: 1, answeredAfter: 1 });
    expect(stats.offers).toMatchObject({ total: 3, newThisWeek: 2 });
    // Des compteurs seulement : jamais le texte d'une lettre ni d'un mail.
    expect(JSON.stringify(res.body)).not.toContain('confidentiel');
  });
});
