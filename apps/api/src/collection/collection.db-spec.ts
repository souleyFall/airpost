import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { PasswordService } from '../auth/password.service';
import { parseEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { exampleProfile } from '../profile/profile.fixture';
import { HTTP_FETCH, type HttpFetch } from '../http/http-fetch';
import { LlmProvider, type LlmRequest, type LlmResponse } from '../llm/llm.types';

/** Faux modèle : note toute offre 80 et la décrit, sans réseau. */
class FakeModel extends LlmProvider {
  generate(request: LlmRequest): Promise<LlmResponse> {
    const count = Number(/Évalue les (\d+) offre/.exec(request.user)?.[1] ?? 0);
    const results = Array.from({ length: count }, (_, i) => ({
      n: i + 1,
      score: 80,
      summary: 'Bonne piste.',
      disqualifier: null,
      strengths: ['TypeScript demandé'],
      gaps: [],
      brief: {
        company: 'Éditeur de logiciels.',
        stack: ['TypeScript'],
        wantedProfile: null,
        rhythm: null,
      },
    }));
    return Promise.resolve({
      text: JSON.stringify({ results }),
      usage: { promptTokens: 1, outputTokens: 1 },
    });
  }
}

// Pipeline complet : session, CSRF, profil, trois sources simulées, vraie base PostgreSQL.
describe('Collecte (e2e, base réelle, API simulées)', () => {
  const PASSWORD = 'un-mot-de-passe-solide-1234';
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const lbaJob = (id: string, title: string, company: string) => ({
    identifier: { id },
    workplace: {
      name: company,
      location: { address: '75011 Paris', geopoint: { coordinates: [2.38, 48.86] } },
    },
    apply: { url: `https://exemple.test/${id}` },
    offer: { title, status: 'Active', publication: { creation: '2026-11-03T04:31:01.453Z' } },
  });

  const adzunaJob = (id: string, title: string, company: string) => ({
    id,
    title,
    company: { display_name: company },
    location: { display_name: 'Paris', area: ['France', 'Ile-de-France', 'Paris'] },
    latitude: 48.86,
    longitude: 2.38,
    redirect_url: `https://www.adzuna.fr/details/${id}`,
  });

  let lbbStatus = 200;
  let calls: string[] = [];

  /** Fausses API : répond selon le domaine appelé, sans réseau. */
  const fakeHttp: HttpFetch = async (url) => {
    const host = new URL(url).host;
    calls.push(host);
    if (host === 'data.geopf.fr') {
      return json({ features: [{ geometry: { coordinates: [2.381844, 48.860162] } }] });
    }
    if (host === 'api.apprentissage.beta.gouv.fr') {
      return json({
        jobs: [
          lbaJob('lba-1', 'Alternance développeur web', 'Exemple Logiciels'),
          lbaJob('lba-2', 'Alternance data', 'Autre Entreprise'),
        ],
      });
    }
    if (host === 'api.adzuna.com') {
      return json({
        results: [
          // Même annonce que lba-1 : doublon entre sources.
          adzunaJob('adz-1', 'Alternance développeur web', 'Exemple Logiciels'),
          adzunaJob('adz-2', 'Alternance mobile', 'Studio Mobile'),
        ],
      });
    }
    if (host === 'entreprise.francetravail.fr') {
      return json({ access_token: 'jeton', expires_in: 1499 });
    }
    if (host === 'api.francetravail.io') {
      return lbbStatus === 200
        ? json({
            items: [
              {
                siret: '12345678900012',
                company_name: 'Boîte Qui Recrute',
                city: 'Paris',
                postcode: '75011',
              },
            ],
          })
        : json({}, lbbStatus);
    }
    return json({}, 404);
  };

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;

  beforeEach(async () => {
    lbbStatus = 200;
    calls = [];
    vi.stubEnv('LBA_API_KEY', 'cle-lba');
    vi.stubEnv('FT_CLIENT_ID', 'id-ft');
    vi.stubEnv('FT_CLIENT_SECRET', 'secret-ft');
    vi.stubEnv('ADZUNA_APP_ID', 'id-adzuna');
    vi.stubEnv('ADZUNA_APP_KEY', 'cle-adzuna');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HTTP_FETCH)
      .useValue(fakeHttp)
      .overrideProvider(LlmProvider)
      .useValue(new FakeModel())
      .compile();
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
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  async function connect() {
    const res = await http
      .post('/auth/login')
      .send({ login: 'alice', password: PASSWORD })
      .expect(200);
    const setCookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    return {
      cookie: setCookie.split(';')[0] ?? '',
      csrf: (res.body as { csrfToken: string }).csrfToken,
    };
  }

  const run = (s: { cookie: string; csrf: string }) =>
    http.post('/collection/run').set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf);

  async function withProfile() {
    const session = await connect();
    await http
      .put('/profile')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send(exampleProfile())
      .expect(200);
    return session;
  }

  it('exige une connexion et le jeton CSRF', async () => {
    await http.post('/collection/run').expect(401);
    await http.get('/collection/last').expect(401);
    const session = await connect();
    await http.post('/collection/run').set('Cookie', session.cookie).expect(403);
  });

  it('refuse (400) sans profil, sans appeler aucune source', async () => {
    const session = await connect();

    const res = await run(session).expect(400);

    expect(JSON.stringify(res.body)).toContain('profil');
    expect(calls).toEqual([]);
  });

  it('collecte les trois sources, écarte le doublon entre sources et enregistre en base', async () => {
    const session = await withProfile();

    const res = await run(session).expect(200);

    const report = res.body as {
      purged: number;
      sources: { source: string; status: string; created: number; duplicates: number }[];
    };
    expect(report.sources.map((s) => [s.source, s.status, s.created, s.duplicates])).toEqual([
      ['LBA', 'ok', 2, 0],
      ['ADZUNA', 'ok', 1, 1],
      ['LBB', 'ok', 1, 0],
    ]);
    const rows = await prisma.offer.findMany({
      orderBy: [{ source: 'asc' }, { externalId: 'asc' }],
    });
    expect(rows.map((r) => `${r.source}:${r.externalId}`)).toEqual([
      'LBA:lba-1',
      'LBA:lba-2',
      // PostgreSQL trie un type énuméré dans l'ordre de déclaration (LBA, LBB, ADZUNA).
      'LBB:12345678900012',
      'ADZUNA:adz-2',
    ]);
    expect(rows[0]).toMatchObject({
      company: 'Exemple Logiciels',
      city: 'Paris',
      postcode: '75011',
      channel: 'SITE',
      applyUrl: 'https://exemple.test/lba-1',
    });
    // Chaque offre est analysée par le modèle à la fin de la collecte, et sa distance au domicile calculée.
    expect(res.body).toMatchObject({ analyzed: 4, pendingAnalysis: 0 });
    expect(rows.every((r) => r.score === 80 && r.analysis !== null)).toBe(true);
    expect(rows.find((r) => r.externalId === 'lba-1')?.distanceKm).toBeLessThan(1);
    expect(rows.find((r) => r.externalId === 'lba-1')?.contractType).toBe('ALTERNANCE');
    // Seul le code postal part vers le géocodeur, pas le nom du candidat.
    expect(calls.filter((h) => h === 'data.geopf.fr')).toHaveLength(1);
  });

  it('rejouée, la collecte met à jour sans créer de doublon', async () => {
    const session = await withProfile();
    await run(session).expect(200);

    const second = await run(session).expect(200);

    const sources = (second.body as { sources: { created: number; updated: number }[] }).sources;
    expect(sources.map((s) => [s.created, s.updated])).toEqual([
      [0, 2],
      [0, 1],
      [0, 1],
    ]);
    expect(await prisma.offer.count()).toBe(4);
  });

  it('une source en panne est signalée sans bloquer les autres', async () => {
    lbbStatus = 429;
    const session = await withProfile();

    const res = await run(session).expect(200);

    const sources = (res.body as { sources: { source: string; status: string; reason?: string }[] })
      .sources;
    expect(sources.find((s) => s.source === 'LBB')).toMatchObject({
      status: 'error',
      reason: 'rate_limited',
    });
    expect(sources.find((s) => s.source === 'LBA')).toMatchObject({ status: 'ok' });
    expect(await prisma.offer.count()).toBe(3);
  });

  it('une source sans clé est signalée « disabled »', async () => {
    await app.close();
    vi.stubEnv('ADZUNA_APP_KEY', '');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HTTP_FETCH)
      .useValue(fakeHttp)
      .overrideProvider(LlmProvider)
      .useValue(new FakeModel())
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, parseEnv());
    await app.init();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer() as Server);
    await prisma.user.deleteMany();
    await prisma.user.create({
      data: { login: 'alice', passwordHash: await new PasswordService().hash(PASSWORD) },
    });
    const session = await withProfile();

    const res = await run(session).expect(200);

    const adzuna = (res.body as { sources: { source: string; status: string }[] }).sources.find(
      (s) => s.source === 'ADZUNA',
    );
    expect(adzuna?.status).toBe('disabled');
    expect(calls).not.toContain('api.adzuna.com');
  });

  it('applique la durée de conservation sans jamais supprimer une offre qui a une candidature', async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const base = {
      title: 'Ancienne',
      company: 'X',
      dedupKey: 'x',
      channel: 'SITE',
      firstSeenAt: old,
      lastSeenAt: old,
    } as const;
    await prisma.offer.create({ data: { ...base, source: 'LBA', externalId: 'old-free' } });
    const kept = await prisma.offer.create({
      data: { ...base, source: 'LBA', externalId: 'old-followed' },
    });
    await prisma.application.create({ data: { offerId: kept.id, status: 'APPLIED' } });
    const session = await withProfile();

    const res = await run(session).expect(200);

    expect((res.body as { purged: number }).purged).toBe(1);
    const ids = (await prisma.offer.findMany()).map((o) => o.externalId);
    expect(ids).toContain('old-followed');
    expect(ids).not.toContain('old-free');
  });

  it('indique quelles connexions sont configurées, sans jamais exposer une clé', async () => {
    await http.get('/collection/status').expect(401);
    const session = await connect();

    const res = await http.get('/collection/status').set('Cookie', session.cookie).expect(200);

    expect(res.body).toMatchObject({
      sources: { LBA: true, LBB: true, ADZUNA: true },
      gemini: { configured: expect.any(Boolean) as unknown },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/cle-lba|secret-ft|id-ft|cle-adzuna/);
  });

  it('expose le bilan de la dernière collecte', async () => {
    const session = await withProfile();
    await http.get('/collection/last').set('Cookie', session.cookie).expect(404);

    await run(session).expect(200);
    const last = await http.get('/collection/last').set('Cookie', session.cookie).expect(200);

    expect((last.body as { sources: unknown[] }).sources).toHaveLength(3);
  });

  it('refuse (409) une collecte lancée pendant qu’une autre tourne', async () => {
    const session = await withProfile();

    const [a, b] = await Promise.all([run(session), run(session)]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});
