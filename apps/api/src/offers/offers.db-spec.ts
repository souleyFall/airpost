import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { PasswordService } from '../auth/password.service';
import { parseEnv } from '../config/env';
import { OfferSource } from '../generated/prisma/enums';
import { LlmError, LlmProvider, type LlmRequest, type LlmResponse } from '../llm/llm.types';
import { MatchService } from '../matching/match.service';
import { OffersService } from '../sources/offers.service';
import { PrismaService } from '../prisma/prisma.service';
import { exampleProfile } from '../profile/profile.fixture';

/** Faux modèle : rejoue des réponses préparées (ou une erreur) et garde les requêtes pour les inspecter. */
class FakeModel extends LlmProvider {
  queue: (object | LlmError)[] = [];
  requests: LlmRequest[] = [];
  generate(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) return Promise.reject(new LlmError('unavailable', 'File vide'));
    if (next instanceof LlmError) return Promise.reject(next);
    return Promise.resolve({
      text: JSON.stringify(next),
      usage: { promptTokens: 1, outputTokens: 1 },
    });
  }
}

const result = (n: number, score: number, extra: Record<string, unknown> = {}) => ({
  n,
  score,
  summary: 'Résumé.',
  disqualifier: null,
  strengths: ['Point fort'],
  gaps: ['Manque'],
  brief: {
    company: 'Éditeur de logiciels.',
    stack: ['React', 'NestJS'],
    wantedProfile: 'Étudiant en Master.',
    rhythm: null,
  },
  ...extra,
});

describe('Offres et analyse IA (e2e, base réelle)', () => {
  const PASSWORD = 'un-mot-de-passe-solide-1234';
  const model = new FakeModel();

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let cookie: string;
  let csrf: string;

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
        // Le profil de test recherche une alternance : seules les offres de ce contrat sont envoyées au modèle.
        contractType: 'ALTERNANCE',
        ...extra,
      },
    });

  const get = (query: string) => http.get(`/offers${query}`).set('Cookie', cookie).expect(200);
  const titles = (res: { body: unknown }) =>
    (res.body as { items: { title: string }[] }).items.map((i) => i.title);

  beforeEach(async () => {
    model.queue = [];
    model.requests = [];
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmProvider)
      .useValue(model)
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
    const res = await http
      .post('/auth/login')
      .send({ login: 'alice', password: PASSWORD })
      .expect(200);
    cookie = ((res.headers['set-cookie'] as unknown as string[])[0] ?? '').split(';')[0] ?? '';
    csrf = (res.body as { csrfToken: string }).csrfToken;
  });

  afterEach(async () => {
    await app.close();
  });

  describe('MatchService', () => {
    it('analyse les offres sans note : score, verdict, brief, empreinte du profil', async () => {
      await seed('a', { title: 'Alternance React', distanceKm: 4.2 });
      model.queue.push({
        results: [result(1, 82, { strengths: ['React demandé, présent dans ton profil'] })],
      });

      const report = await app.get(MatchService).analyzePending(exampleProfile());

      expect(report).toEqual({ analyzed: 1, remaining: 0 });
      const row = await prisma.offer.findFirstOrThrow();
      expect(row.score).toBe(82);
      expect(row.analyzedAt).not.toBeNull();
      expect(row.profileHash).toMatch(/^[0-9a-f]{32}$/);
      expect(row.analysis).toMatchObject({
        verdict: 'excellent',
        strengths: ['React demandé, présent dans ton profil'],
        brief: { stack: ['React', 'NestJS'] },
      });
      // Les faits calculés par le système sont dans le prompt ; l'identité du candidat n'y est pas.
      const prompt = model.requests[0]?.user ?? '';
      expect(prompt).toContain('4.2 km');
      expect(prompt).not.toContain('Montigny');
    });

    it('n’analyse pas deux fois avec le même profil, mais refait l’analyse si le profil change', async () => {
      await seed('a');
      model.queue.push({ results: [result(1, 70)] }, { results: [result(1, 40)] });
      const matching = app.get(MatchService);

      await matching.analyzePending(exampleProfile());
      expect((await matching.analyzePending(exampleProfile())).analyzed).toBe(0);
      expect(model.requests).toHaveLength(1);

      const changed = exampleProfile();
      changed.search.keywords = [...changed.search.keywords, 'Rust'];
      expect((await matching.analyzePending(changed)).analyzed).toBe(1);
      expect((await prisma.offer.findFirstOrThrow()).score).toBe(40);
    });

    it('plafonne le score d’une offre écartée, quoi qu’écrive le modèle', async () => {
      await seed('compta');
      model.queue.push({
        results: [result(1, 90, { disqualifier: 'Poste de comptabilité, pas de développement' })],
      });

      await app.get(MatchService).analyzePending(exampleProfile());

      const row = await prisma.offer.findFirstOrThrow();
      expect(row.score).toBe(35);
      expect(row.analysis).toMatchObject({ verdict: 'off_target' });
    });

    it('regroupe les offres par lots et respecte le plafond par collecte', async () => {
      for (let i = 0; i < 6; i++) await seed(`lot-${i}`);
      model.queue.push({ results: [1, 2, 3, 4].map((n) => result(n, 60)) });
      model.queue.push({ results: [1, 2].map((n) => result(n, 60)) });

      const capped = await app.get(MatchService).analyzePending(exampleProfile(), 4);
      expect(capped).toEqual({ analyzed: 4, remaining: 2 });
      expect(model.requests).toHaveLength(1);
    });

    it('un quota atteint arrête la boucle sans perdre les offres déjà analysées', async () => {
      for (let i = 0; i < 6; i++) await seed(`q-${i}`);
      model.queue.push(
        { results: [1, 2, 3, 4].map((n) => result(n, 60)) },
        new LlmError('rate_limited', 'Quota'),
      );

      const report = await app.get(MatchService).analyzePending(exampleProfile());

      expect(report).toEqual({ analyzed: 4, remaining: 2 });
    });

    describe('seules les offres au contrat recherché sont envoyées au modèle', () => {
      it('n’analyse pas une offre au contrat non précisé, en CDI ou en stage quand seule l’alternance est recherchée', async () => {
        await seed('alt', { contractType: 'ALTERNANCE' });
        await seed('autre', { contractType: 'AUTRE' });
        await seed('cdi', { contractType: 'CDI' });
        await seed('stage', { contractType: 'STAGE' });
        await seed('spont', { contractType: 'SPONTANEE' });
        model.queue.push({ results: [result(1, 70)] });

        const report = await app.get(MatchService).analyzePending(exampleProfile());

        // Une seule offre dans la requête, et les autres ne sont pas comptées « en attente ».
        expect(report).toEqual({ analyzed: 1, remaining: 0 });
        expect(model.requests).toHaveLength(1);
        const analyzed = await prisma.offer.findMany({ where: { analyzedAt: { not: null } } });
        expect(analyzed.map((o) => o.externalId)).toEqual(['alt']);
      });

      it('envoie aussi les stages quand le profil recherche alternance et stage', async () => {
        await seed('alt', { contractType: 'ALTERNANCE' });
        await seed('stage', { contractType: 'STAGE' });
        await seed('autre', { contractType: 'AUTRE' });
        model.queue.push({ results: [result(1, 70), result(2, 60)] });
        const profile = exampleProfile();
        profile.search.contracts = ['ALTERNANCE', 'STAGE'];

        const report = await app.get(MatchService).analyzePending(profile);

        expect(report).toEqual({ analyzed: 2, remaining: 0 });
      });

      it('une offre au contrat non précisé reste analysable quand l’utilisateur l’ouvre', async () => {
        const row = await seed('autre', { contractType: 'AUTRE' });
        model.queue.push({ results: [result(1, 55)] });

        await app.get(MatchService).analyzeOne(exampleProfile(), row.id);

        expect((await prisma.offer.findFirstOrThrow()).score).toBe(55);
      });
    });

    it('ignore une entrée dont le numéro est hors plage ou répété (l’offre sera retentée)', async () => {
      await seed('a');
      await seed('b');
      model.queue.push({ results: [result(1, 70), result(1, 20), result(3, 90)] });

      const report = await app.get(MatchService).analyzePending(exampleProfile());

      expect(report).toEqual({ analyzed: 1, remaining: 1 });
    });
  });

  describe('OffersService.cleanup', () => {
    it('supprime les offres hors métier sans candidature, corrige les contrats, épargne le suivi', async () => {
      await seed('dev', { source: 'ADZUNA', title: 'Alternance développeur web' });
      await seed('compta', { source: 'ADZUNA', title: 'Alternance comptable' });
      await seed('lba', { source: 'LBA', title: 'Mission polyvalente' });
      const suivie = await seed('suivie', { source: 'ADZUNA', title: 'Alternance comptable' });
      await prisma.application.create({ data: { offerId: suivie.id, subject: 'O', body: 'T' } });

      await seed('lbb', { source: 'LBB', title: 'Candidature spontanée : logiciels' });
      const result = await app.get(OffersService).cleanup(['LBB', 'LBA']);

      expect(result.removed).toBe(1);
      const rows = await prisma.offer.findMany({ orderBy: { externalId: 'asc' } });
      expect(rows.map((r) => r.externalId)).toEqual(['dev', 'lba', 'lbb', 'suivie']);
      expect(rows.find((r) => r.externalId === 'lbb')?.contractType).toBe('SPONTANEE');
      expect(rows.find((r) => r.externalId === 'dev')?.contractType).toBe('ALTERNANCE');
      expect(rows.find((r) => r.externalId === 'lba')?.contractType).toBe('ALTERNANCE');
    });
  });

  describe('offres écartées par l’IA', () => {
    const analyzeVisible = (ids: string[]) =>
      http.post('/offers/analyze').set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ ids });

    async function withProfile() {
      await http
        .put('/profile')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrf)
        .send(exampleProfile())
        .expect(200);
    }

    it('une offre jugée hors cible est marquée écartée et quitte le fil', async () => {
      await withProfile();
      const bonne = await seed('bonne');
      const compta = await seed('compta');
      model.queue.push({
        results: [
          result(1, 80),
          result(2, 90, { disqualifier: 'Poste de comptabilité, pas de développement' }),
        ],
      });

      const res = await analyzeVisible([bonne.id, compta.id]).expect(200);

      const flags = Object.fromEntries(
        (res.body as { items: { id: string; excluded: boolean }[] }).items.map((i) => [
          i.id,
          i.excluded,
        ]),
      );
      expect(Object.values(flags).sort()).toEqual([false, true]);
      expect(titles(await get('?pending=true')).length).toBe(1);
      // Sans le filtre « à traiter », l’offre reste consultable : elle n’est pas supprimée.
      expect((await get('')).body).toMatchObject({ total: 2 });
    });

    it('une réanalyse favorable la remet dans le fil', async () => {
      await withProfile();
      const offer = await seed('a', { excluded: true });
      model.queue.push({ results: [result(1, 70)] });

      await http
        .post(`/offers/${offer.id}/analyze?force=true`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrf)
        .expect(200);

      expect((await prisma.offer.findFirstOrThrow()).excluded).toBe(false);
      expect(titles(await get('?pending=true'))).toEqual(['Offre a']);
    });

    it('une offre écartée mais qui a déjà une candidature reste dans le fil', async () => {
      const offer = await seed('suivie', { excluded: true });
      await prisma.application.create({ data: { offerId: offer.id, subject: 'O', body: 'T' } });
      await seed('masquee', { excluded: true });

      expect(titles(await get('?pending=true'))).toEqual(['Offre suivie']);
    });

    it('le détail indique si l’offre est écartée', async () => {
      const offer = await seed('a', { excluded: true });
      const res = await http.get(`/offers/${offer.id}`).set('Cookie', cookie).expect(200);
      expect(res.body).toMatchObject({ excluded: true });
    });
  });
  describe('POST /offers/analyze (offres affichées)', () => {
    const analyzeVisible = (ids: string[]) =>
      http.post('/offers/analyze').set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ ids });

    async function withProfile() {
      await http
        .put('/profile')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrf)
        .send(exampleProfile())
        .expect(200);
    }

    it('analyse en une fois les offres sans note et renvoie leur score', async () => {
      await withProfile();
      const a = await seed('a');
      const b = await seed('b');
      model.queue.push({ results: [result(1, 81), result(2, 42)] });

      const res = await analyzeVisible([a.id, b.id]).expect(200);

      const body = res.body as { analyzed: number; items: { id: string; score: number }[] };
      expect(body.analyzed).toBe(2);
      // Les plus récentes sont envoyées d'abord : l'ordre des notes suit celui de la demande au modèle.
      expect(body.items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
      expect(body.items.map((i) => i.score).sort()).toEqual([42, 81]);
      expect(model.requests).toHaveLength(1);
    });

    it('n’analyse que les offres demandées et ignore celles déjà à jour', async () => {
      await withProfile();
      const a = await seed('a');
      await seed('autre');
      model.queue.push({ results: [result(1, 70)] });
      await analyzeVisible([a.id]).expect(200);
      expect(await prisma.offer.count({ where: { score: null } })).toBe(1);

      await analyzeVisible([a.id]).expect(200);
      expect(model.requests).toHaveLength(1);
    });

    it('un quota atteint n’est pas une erreur : les offres restent sans note', async () => {
      await withProfile();
      const a = await seed('a');
      model.queue.push(new LlmError('rate_limited', 'Quota'));

      const res = await analyzeVisible([a.id]).expect(200);

      expect(res.body).toMatchObject({ analyzed: 0, items: [{ id: a.id, score: null }] });
    });

    it('refuse sans profil (400), sans jeton CSRF (403) et une liste invalide (400)', async () => {
      const a = await seed('a');
      await analyzeVisible([a.id]).expect(400);
      await http
        .post('/offers/analyze')
        .set('Cookie', cookie)
        .send({ ids: [a.id] })
        .expect(403);
      await analyzeVisible([]).expect(400);
      await analyzeVisible(['pas-un-uuid']).expect(400);
      await withProfile();
      await analyzeVisible(Array.from({ length: 101 }, () => a.id)).expect(400);
    });
  });
  describe('POST /offers/:id/analyze', () => {
    const analyze = (id: string, query = '') =>
      http.post(`/offers/${id}/analyze${query}`).set('Cookie', cookie).set('X-CSRF-Token', csrf);

    async function withProfile() {
      await http
        .put('/profile')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrf)
        .send(exampleProfile())
        .expect(200);
    }

    it('exige une connexion et le jeton CSRF', async () => {
      const offer = await seed('a');
      await http.post(`/offers/${offer.id}/analyze`).expect(401);
      await http.post(`/offers/${offer.id}/analyze`).set('Cookie', cookie).expect(403);
    });

    it('refuse (400) sans profil', async () => {
      const offer = await seed('a');
      await analyze(offer.id).expect(400);
      expect(model.requests).toHaveLength(0);
    });

    it('analyse l’offre ouverte et renvoie le détail à jour ; sans nouvel appel si déjà à jour', async () => {
      await withProfile();
      const offer = await seed('a');
      model.queue.push({ results: [result(1, 77)] });

      const first = await analyze(offer.id).expect(200);
      expect(first.body).toMatchObject({ score: 77, analysis: { verdict: 'excellent' } });
      await analyze(offer.id).expect(200);
      expect(model.requests).toHaveLength(1);

      model.queue.push({ results: [result(1, 50)] });
      const forced = await analyze(offer.id, '?force=true').expect(200);
      expect(forced.body).toMatchObject({ score: 50 });
      expect(model.requests).toHaveLength(2);
    });

    it('traduit un quota atteint en 429 et une offre inconnue en 404', async () => {
      await withProfile();
      const offer = await seed('a');
      model.queue.push(new LlmError('rate_limited', 'Quota'));
      await analyze(offer.id).expect(429);
      await analyze('00000000-0000-4000-8000-000000000000').expect(404);
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

      const res = await get('');

      expect((res.body as { total: number }).total).toBe(4);
      expect(titles(res)).toEqual(['Offre haut', 'Offre moyen', 'Offre bas', 'Offre sans-score']);
      expect(JSON.stringify(res.body)).not.toContain('confidentielle');
    });

    it('pagine : page, taille, total, et sans doublon ni trou quand score et date sont identiques', async () => {
      const same = new Date();
      for (let i = 0; i < 7; i++) await seed(`eq${i}`, { score: 50, firstSeenAt: same });

      const all: string[] = [];
      for (const offset of [0, 3, 6]) {
        const res = await get(`?limit=3&offset=${offset}`);
        expect(res.body).toMatchObject({ total: 7, limit: 3, offset });
        all.push(...titles(res));
      }

      expect(all).toHaveLength(7);
      expect(new Set(all).size).toBe(7);
      expect(titles(await get('?limit=3&offset=6'))).toHaveLength(1);
    });

    it('filtre par score minimum', async () => {
      for (let i = 1; i <= 5; i++) await seed(`o${i}`, { score: i * 10 });

      expect((await get('?minScore=30')).body).toMatchObject({ total: 3 });
      expect(titles(await get('?limit=2&offset=1'))).toEqual(['Offre o4', 'Offre o3']);
    });

    it('filtre par source, type de contrat et canal (valeurs multiples séparées par des virgules)', async () => {
      await seed('lba-alt', { source: 'LBA', contractType: 'ALTERNANCE', score: 90 });
      await seed('adz-alt', { source: 'ADZUNA', contractType: 'ALTERNANCE', score: 80 });
      await seed('adz-cdi', { source: 'ADZUNA', contractType: 'CDI', score: 70 });
      await seed('lbb-stage', {
        source: 'LBB',
        contractType: 'STAGE',
        channel: 'EMAIL',
        score: 60,
      });

      expect(titles(await get('?source=ADZUNA'))).toEqual(['Offre adz-alt', 'Offre adz-cdi']);
      expect(titles(await get('?source=LBA,LBB'))).toEqual(['Offre lba-alt', 'Offre lbb-stage']);
      expect(titles(await get('?contract=ALTERNANCE'))).toEqual(['Offre lba-alt', 'Offre adz-alt']);
      expect(titles(await get('?contract=CDI,STAGE'))).toEqual([
        'Offre adz-cdi',
        'Offre lbb-stage',
      ]);
      expect(titles(await get('?source=ADZUNA&contract=ALTERNANCE'))).toEqual(['Offre adz-alt']);
      expect(titles(await get('?channel=EMAIL'))).toEqual(['Offre lbb-stage']);
    });

    it.each(Object.values(OfferSource))(
      'accepte chaque source de l’énumération dans le filtre (« %s »)',
      async (source) => {
        await seed('une', { source, contractType: 'ALTERNANCE' });

        const res = await get(`?source=${source}`);

        expect(res.body).toMatchObject({ total: 1 });
      },
    );

    it('les candidatures spontanées ont leur propre filtre et ne sont pas des alternances', async () => {
      await seed('annonce', { source: 'LBA', contractType: 'ALTERNANCE', score: 90 });
      await seed('spontanee', { source: 'LBB', contractType: 'SPONTANEE', score: 50 });

      expect(titles(await get('?contract=SPONTANEE'))).toEqual(['Offre spontanee']);
      expect(titles(await get('?contract=ALTERNANCE'))).toEqual(['Offre annonce']);
      expect(titles(await get('?contract=ALTERNANCE,SPONTANEE'))).toHaveLength(2);
    });

    it('recherche dans l’intitulé, l’entreprise, la ville et la description, sans tenir compte de la casse', async () => {
      await seed('a', { title: 'Développeur React', company: 'Alpha' });
      await seed('b', { title: 'Autre', company: 'Beta Logiciels' });
      await seed('c', { title: 'Autre aussi', city: 'Élancourt' });
      await seed('d', { title: 'Encore', description: 'Stack: NestJS et Prisma' });

      expect(titles(await get('?q=REACT'))).toEqual(['Développeur React']);
      expect(titles(await get('?q=beta'))).toEqual(['Autre']);
      expect(titles(await get('?q=%C3%A9lancourt'))).toEqual(['Autre aussi']);
      expect(titles(await get('?q=prisma'))).toEqual(['Encore']);
      expect((await get('?q=introuvable')).body).toMatchObject({ total: 0, items: [] });
    });

    it('traite les caractères spéciaux de la recherche comme du texte', async () => {
      await seed('a', { title: '100% motivé_' });
      await seed('b', { title: 'Autre' });

      expect(titles(await get('?q=%25'))).toEqual(['100% motivé_']);
      expect((await get('?q=%27%20OR%20%271%27%3D%271')).body).toMatchObject({ total: 0 });
    });

    it('trie par fraîcheur (récentes d’abord, sans date à la fin) ou par distance (inconnues à la fin)', async () => {
      const day = 86_400_000;
      const now = Date.now();
      await seed('vieille', { publishedAt: new Date(now - 10 * day), distanceKm: 5 });
      await seed('recente', { publishedAt: new Date(now - day), distanceKm: 40 });
      await seed('sans-date', { distanceKm: null });

      expect(titles(await get('?sort=fresh'))).toEqual([
        'Offre recente',
        'Offre vieille',
        'Offre sans-date',
      ]);
      expect(titles(await get('?sort=distance'))).toEqual([
        'Offre vieille',
        'Offre recente',
        'Offre sans-date',
      ]);
    });

    it('tri par note : les offres notées d’abord, puis celles sans note de la plus récente à la plus ancienne', async () => {
      const day = 86_400_000;
      const now = Date.now();
      await seed('note-moyenne', { score: 60, analyzedAt: new Date(), publishedAt: new Date(now) });
      await seed('note-haute', {
        score: 90,
        analyzedAt: new Date(),
        publishedAt: new Date(now - 9 * day),
      });
      await seed('autre-vieille', { contractType: 'AUTRE', publishedAt: new Date(now - 5 * day) });
      await seed('autre-recente', { contractType: 'AUTRE', publishedAt: new Date(now - day) });
      await seed('autre-sans-date', {
        contractType: 'AUTRE',
        firstSeenAt: new Date(now - 2 * day),
      });

      expect(titles(await get('?sort=score'))).toEqual([
        'Offre note-haute',
        'Offre note-moyenne',
        'Offre autre-recente',
        'Offre autre-vieille',
        'Offre autre-sans-date',
      ]);
    });

    it('filtre par distance maximale sans écarter les offres non localisées', async () => {
      await seed('proche', { distanceKm: 8 });
      await seed('loin', { distanceKm: 80 });
      await seed('inconnue', { distanceKm: null });

      expect(titles(await get('?maxDistanceKm=30&sort=distance'))).toEqual([
        'Offre proche',
        'Offre inconnue',
      ]);
    });

    it('« pending » ne garde que les offres sans candidature ou à relire', async () => {
      const sans = await seed('sans', { score: 90 });
      const aRelire = await seed('relire', { score: 80 });
      const validee = await seed('validee', { score: 70 });
      await prisma.application.create({ data: { offerId: aRelire.id, subject: 'O', body: 'T' } });
      await prisma.application.create({
        data: { offerId: validee.id, subject: 'O', body: 'T', status: 'VALIDATED' },
      });

      expect(titles(await get('?pending=true'))).toEqual(['Offre sans', 'Offre relire']);
      expect((await get('')).body).toMatchObject({ total: 3 });
      expect(sans.id).toBeTruthy();
    });

    it.each([
      'limit=0',
      'limit=101',
      'limit=abc',
      'offset=-1',
      'minScore=101',
      'sort=hasard',
      'source=INCONNUE',
      'contract=CDI,PIRATE',
      'channel=FAX',
      'pending=peutetre',
      `q=${'x'.repeat(101)}`,
    ])('refuse le paramètre invalide « %s » (400)', async (query) => {
      await http.get(`/offers?${query}`).set('Cookie', cookie).expect(400);
    });

    it('indique pour chaque offre si une candidature existe et à quel stade', async () => {
      const withLetter = await seed('avec', { score: 80 });
      await seed('sans', { score: 70 });
      const application = await prisma.application.create({
        data: { offerId: withLetter.id, subject: 'Objet', body: 'Texte' },
      });

      const res = await get('');

      const items = (res.body as { items: { title: string; application: unknown }[] }).items;
      expect(items.find((i) => i.title === 'Offre avec')?.application).toEqual({
        id: application.id,
        status: 'TO_REVIEW',
      });
      expect(items.find((i) => i.title === 'Offre sans')?.application).toBeNull();
    });

    it('renvoie une liste vide sans erreur', async () => {
      expect((await get('')).body).toEqual({ total: 0, limit: 20, offset: 0, items: [] });
    });
  });

  describe('GET /offers/:id', () => {
    it('renvoie le détail complet : description, analyse, contrat, distance', async () => {
      const offer = await seed('une', {
        score: 70,
        contractType: 'ALTERNANCE',
        distanceKm: 12.5,
        analysis: { verdict: 'good', brief: { stack: ['React'] } },
        profileHash: 'secret-interne',
        source: 'GOOGLE_JOBS',
        via: 'Indeed',
      });

      const res = await http.get(`/offers/${offer.id}`).set('Cookie', cookie).expect(200);

      expect(res.body).toMatchObject({
        id: offer.id,
        title: 'Offre une',
        description: 'Longue description confidentielle',
        contractType: 'ALTERNANCE',
        distanceKm: 12.5,
        via: 'Indeed',
        analysis: { verdict: 'good', brief: { stack: ['React'] } },
      });
      expect(res.body).not.toHaveProperty('dedupKey');
      expect(res.body).not.toHaveProperty('profileHash');
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

  describe('offres rejetées (sans lettre, restaurables 7 jours)', () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const write = (path: string) => http.post(path).set('Cookie', cookie).set('X-CSRF-Token', csrf);
    const rejectedList = async () =>
      (await http.get('/offers/rejected').set('Cookie', cookie).expect(200)).body as {
        total: number;
        items: { id: string; title: string; hasLetter: boolean; expiresAt: string }[];
      };

    it('rejeter une offre sans lettre la sort de « À valider » et la met dans les rejetées', async () => {
      const a = await seed('a');
      await seed('b');

      await write(`/offers/${a.id}/reject`).expect(200);

      expect(titles(await get('?pending=true'))).toEqual(['Offre b']);
      const list = await rejectedList();
      expect(list.items.map((i) => i.title)).toEqual(['Offre a']);
      expect(list.items[0]?.hasLetter).toBe(false);
      // L'échéance est à 7 jours exactement de la date de rejet.
      const row = await prisma.offer.findUniqueOrThrow({ where: { id: a.id } });
      expect(new Date(list.items[0]?.expiresAt ?? '').getTime()).toBe(
        (row.rejectedAt as Date).getTime() + 7 * 24 * 60 * 60 * 1000,
      );
    });

    it('rejeter deux fois ne change pas la date de rejet', async () => {
      const a = await seed('a');
      await write(`/offers/${a.id}/reject`).expect(200);
      const first = (await prisma.offer.findUniqueOrThrow({ where: { id: a.id } })).rejectedAt;

      await write(`/offers/${a.id}/reject`).expect(200);

      expect((await prisma.offer.findUniqueOrThrow({ where: { id: a.id } })).rejectedAt).toEqual(
        first,
      );
    });

    it('restaurer remet l’offre dans « À valider »', async () => {
      const a = await seed('a');
      await write(`/offers/${a.id}/reject`).expect(200);

      await write(`/offers/${a.id}/restore`).expect(200);

      expect(titles(await get('?pending=true'))).toEqual(['Offre a']);
      expect((await rejectedList()).total).toBe(0);
    });

    it('refuse de restaurer une offre dont les 7 jours sont passés', async () => {
      const a = await seed('a', { rejectedAt: daysAgo(8) });

      await write(`/offers/${a.id}/restore`).expect(409);

      expect(
        (await prisma.offer.findUniqueOrThrow({ where: { id: a.id } })).rejectedAt,
      ).not.toBeNull();
    });

    it('refuse de rejeter une offre dont la candidature est déjà avancée', async () => {
      const a = await seed('a');
      await prisma.application.create({ data: { offerId: a.id, status: 'VALIDATED' } });

      await write(`/offers/${a.id}/reject`).expect(409);

      expect((await prisma.offer.findUniqueOrThrow({ where: { id: a.id } })).rejectedAt).toBeNull();
    });

    it('rejeter une offre dont la lettre n’est pas validée garde la lettre jusqu’à l’échéance', async () => {
      const a = await seed('a');
      await prisma.application.create({
        data: { offerId: a.id, subject: 'Objet', body: 'Texte de la lettre' },
      });

      await write(`/offers/${a.id}/reject`).expect(200);

      expect((await rejectedList()).items[0]?.hasLetter).toBe(true);
      await write(`/offers/${a.id}/restore`).expect(200);
      expect((await prisma.application.findFirstOrThrow()).body).toBe('Texte de la lettre');
    });

    it('répond 404 pour une offre inconnue, 400 pour un identifiant mal formé, 401 sans session', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      await write(`/offers/${unknown}/reject`).expect(404);
      await write(`/offers/${unknown}/restore`).expect(404);
      await write('/offers/pas-un-uuid/reject').expect(400);
      await http.get('/offers/rejected').expect(401);
      await http.post(`/offers/${unknown}/reject`).set('Cookie', cookie).expect(403);
    });

    it('après 7 jours, le contenu est vidé et la lettre supprimée ; l’identité reste', async () => {
      const old = await seed('old', {
        rejectedAt: daysAgo(8),
        score: 80,
        analyzedAt: new Date(),
        applyUrl: 'https://exemple.test/offre',
        contactEmail: 'rh@exemple.test',
      });
      await prisma.application.create({
        data: { offerId: old.id, subject: 'Objet', body: 'Texte de la lettre' },
      });
      const recent = await seed('recent', { rejectedAt: daysAgo(6), score: 70 });
      await prisma.application.create({
        data: { offerId: recent.id, subject: 'Objet', body: 'Texte conservé' },
      });

      const cleared = await app.get(OffersService).purgeRejected();

      expect(cleared).toBe(1);
      const vidée = await prisma.offer.findUniqueOrThrow({ where: { id: old.id } });
      expect(vidée).toMatchObject({
        title: 'Offre old',
        company: 'Exemple SA',
        dedupKey: 'old',
        description: null,
        contactEmail: null,
        applyUrl: null,
        analysis: null,
        analyzedAt: null,
        score: null,
      });
      expect(await prisma.application.count({ where: { offerId: old.id } })).toBe(0);
      // Une offre rejetée depuis moins de 7 jours n'est pas touchée.
      const gardée = await prisma.offer.findUniqueOrThrow({ where: { id: recent.id } });
      expect(gardée).toMatchObject({ description: 'Longue description confidentielle', score: 70 });
      expect(await prisma.application.count({ where: { offerId: recent.id } })).toBe(1);
      // Idempotent : un second passage n'a plus rien à vider.
      expect(await app.get(OffersService).purgeRejected()).toBe(0);
    });

    it('la liste des rejetées vide d’abord les expirées et ne les montre plus', async () => {
      const old = await seed('old', { rejectedAt: daysAgo(9) });
      await seed('recent', { rejectedAt: daysAgo(1) });

      const list = await rejectedList();

      expect(list.items.map((i) => i.title)).toEqual(['Offre recent']);
      expect(
        (await prisma.offer.findUniqueOrThrow({ where: { id: old.id } })).description,
      ).toBeNull();
    });

    it('la collecte ne réimporte pas le contenu d’une offre rejetée, mais la voit toujours', async () => {
      const store = app.get(OffersService);
      await store.saveMany([
        {
          source: 'LBA',
          externalId: 'r1',
          title: 'Alternance dev',
          company: 'ACME',
          city: 'Paris',
          channel: 'SITE',
          description: 'v1',
        },
      ]);
      const row = await prisma.offer.findFirstOrThrow({ where: { externalId: 'r1' } });
      await prisma.offer.update({
        where: { id: row.id },
        data: { rejectedAt: daysAgo(8), description: null, lastSeenAt: daysAgo(3) },
      });

      const result = await store.saveMany([
        {
          source: 'LBA',
          externalId: 'r1',
          title: 'Titre modifié',
          company: 'ACME',
          city: 'Paris',
          channel: 'SITE',
          description: 'v2 revenue',
        },
      ]);

      expect(result).toEqual({ created: 0, updated: 1 });
      const after = await prisma.offer.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.description).toBeNull();
      expect(after.title).toBe('Alternance dev');
      expect(after.rejectedAt).not.toBeNull();
      expect(after.lastSeenAt.getTime()).toBeGreaterThan(row.lastSeenAt.getTime() - 1);
      expect(await prisma.offer.count()).toBe(1);
    });

    it('même règle pour une source à identifiant instable (Google Jobs) : pas de réimport sous un autre identifiant', async () => {
      const store = app.get(OffersService);
      const google = (id: string, description: string) => ({
        source: 'GOOGLE_JOBS' as const,
        externalId: id,
        title: 'Alternance dev',
        company: 'ACME',
        city: 'Paris',
        channel: 'SITE' as const,
        description,
      });
      await store.saveMany([google('ancien', 'v1')]);
      await prisma.offer.updateMany({ data: { rejectedAt: daysAgo(8), description: null } });

      const result = await store.saveMany([google('nouveau', 'v2')]);

      expect(result).toEqual({ created: 0, updated: 1 });
      const rows = await prisma.offer.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ externalId: 'ancien', description: null });
    });

    it('une offre rejetée n’est jamais envoyée à l’analyse IA', async () => {
      await seed('a', { rejectedAt: new Date() });
      await seed('b');
      model.queue = [{ results: [result(1, 80)] }];

      const profile = exampleProfile();
      const report = await app.get(MatchService).analyzePending(profile);

      expect(report.analyzed).toBe(1);
      expect(model.requests).toHaveLength(1);
      expect(JSON.stringify(model.requests[0])).toContain('Offre b');
      expect(JSON.stringify(model.requests[0])).not.toContain('Offre a');
    });
  });
});
