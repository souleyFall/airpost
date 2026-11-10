import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { PasswordService } from '../auth/password.service';
import { parseEnv } from '../config/env';
import { HTTP_FETCH } from '../http/http-fetch';
import { LlmError, LlmProvider, type LlmRequest, type LlmResponse } from '../llm/llm.types';
import { PrismaService } from '../prisma/prisma.service';
import { exampleProfile } from '../profile/profile.fixture';
import { trustedSources } from '../collection/collection.service';
import { OffersService } from '../sources/offers.service';

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

const analysis = (score: number) => ({
  results: [
    {
      n: 1,
      score,
      summary: 'Résumé.',
      disqualifier: null,
      strengths: ['Point fort'],
      gaps: ['Manque'],
      brief: { company: null, stack: ['React'], wantedProfile: null, rhythm: null },
    },
  ],
});

/** Géocodage simulé : toute commune et tout code postal sont à Paris. Toute autre adresse est refusée (et notée). */
const fetched: string[] = [];
const fakeHttp = (url: string | URL) => {
  const address = String(url);
  fetched.push(address);
  if (address.startsWith('https://data.geopf.fr/geocodage/search')) {
    return Promise.resolve(
      new Response(JSON.stringify({ features: [{ geometry: { coordinates: [2.35, 48.86] } }] })),
    );
  }
  return Promise.resolve(new Response('{}', { status: 404 }));
};

const PASTED = [
  'Alternance - Développeur Full Stack (H/F)',
  'Atelier Exemple · Paris (75)',
  'Nous recherchons un alternant pour notre équipe produit : TypeScript, React, NestJS.',
  'Rythme 3 semaines / 1 semaine. Candidature : recrutement@atelier-exemple.test',
].join('\n');

describe('Offres ajoutées à la main (e2e, base réelle, faux modèle)', () => {
  const PASSWORD = 'un-mot-de-passe-solide-1234';
  const model = new FakeModel();
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let session: { cookie: string; csrf: string };

  const write = (method: 'post' | 'put', path: string) =>
    http[method](path).set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);
  const extract = (text = PASTED) => write('post', '/offers/manual/extract').send({ text });
  const create = (extra: Record<string, unknown> = {}) =>
    write('post', '/offers/manual').send({
      text: PASTED,
      title: 'Alternance - Développeur Full Stack (H/F)',
      company: 'Atelier Exemple',
      city: 'Paris',
      contactEmail: 'recrutement@atelier-exemple.test',
      applyUrl: 'https://www.linkedin.com/jobs/view/4477928448/',
      ...extra,
    });

  beforeEach(async () => {
    model.queue = [];
    model.requests = [];
    fetched.length = 0;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmProvider)
      .useValue(model)
      .overrideProvider(HTTP_FETCH)
      .useValue(fakeHttp)
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
    session = {
      cookie: ((res.headers['set-cookie'] as unknown as string[])[0] ?? '').split(';')[0] ?? '',
      csrf: (res.body as { csrfToken: string }).csrfToken,
    };
    await write('put', '/profile').send(exampleProfile()).expect(200);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('lecture du texte collé', () => {
    it('exige une connexion et le jeton CSRF, sans appeler le modèle', async () => {
      await http.post('/offers/manual/extract').send({ text: PASTED }).expect(401);
      await http
        .post('/offers/manual/extract')
        .set('Cookie', session.cookie)
        .send({ text: PASTED })
        .expect(403);
      expect(model.requests).toHaveLength(0);
    });

    it('propose intitulé, entreprise et ville (modèle) et l’adresse de contact (trouvée localement)', async () => {
      model.queue.push({
        title: 'Alternance - Développeur Full Stack (H/F)',
        company: 'Atelier Exemple',
        city: 'Paris',
      });

      const res = await extract().expect(200);

      expect(res.body).toEqual({
        title: 'Alternance - Développeur Full Stack (H/F)',
        company: 'Atelier Exemple',
        city: 'Paris',
        contactEmail: 'recrutement@atelier-exemple.test',
      });
      // Le modèle ne voit pas l'adresse : elle est retirée avant, et cherchée par le code.
      expect(model.requests[0]?.user).not.toContain('recrutement@atelier-exemple.test');
      // Rien n'est téléchargé.
      expect(fetched).toEqual([]);
      expect(await prisma.offer.count()).toBe(0);
    });

    it('refuse un texte trop court (400) ou un champ inconnu (400)', async () => {
      await extract('Trop court').expect(400);
      await write('post', '/offers/manual/extract').send({ text: PASTED, url: 'x' }).expect(400);
      expect(model.requests).toHaveLength(0);
    });

    it('quota du modèle atteint : 429, l’utilisateur peut remplir les champs à la main', async () => {
      model.queue.push(new LlmError('rate_limited', 'Quota'));

      await extract().expect(429);
    });
  });

  describe('enregistrement', () => {
    it('enregistre l’offre (source « à la main »), localise la ville, garde le lien sans le visiter, puis l’analyse', async () => {
      model.queue.push(analysis(82));

      const res = await create().expect(200);

      expect(res.body).toMatchObject({ created: true, analyzed: true });
      const offer = await prisma.offer.findUniqueOrThrow({
        where: { id: (res.body as { id: string }).id },
      });
      expect(offer).toMatchObject({
        source: 'MANUAL',
        title: 'Alternance - Développeur Full Stack (H/F)',
        company: 'Atelier Exemple',
        city: 'Paris',
        channel: 'EMAIL',
        contactEmail: 'recrutement@atelier-exemple.test',
        applyUrl: 'https://www.linkedin.com/jobs/view/4477928448/',
        contractType: 'ALTERNANCE',
        score: 82,
      });
      expect(offer.description).toContain('Rythme 3 semaines / 1 semaine');
      expect(offer.latitude).not.toBeNull();
      expect(offer.distanceKm).not.toBeNull();
      expect(offer.externalId).toMatch(/^manual-[0-9a-f]{32}$/);
      // Seul le service public de géocodage a été appelé : le lien de l'annonce, jamais.
      expect(fetched.every((url) => url.startsWith('https://data.geopf.fr/'))).toBe(true);
      expect(fetched.some((url) => url.includes('linkedin'))).toBe(false);
    });

    it('sans adresse de contact : candidature par le site', async () => {
      model.queue.push(analysis(60));

      const res = await create({ contactEmail: null }).expect(200);

      const offer = await prisma.offer.findUniqueOrThrow({
        where: { id: (res.body as { id: string }).id },
      });
      expect(offer.channel).toBe('SITE');
      expect(offer.contactEmail).toBeNull();
    });

    it('la même annonce collée deux fois (ou déjà collectée par une autre source) n’est pas dupliquée', async () => {
      model.queue.push(analysis(70));
      const first = await create().expect(200);

      const again = await create({ title: 'alternance - développeur full stack (h/f)' }).expect(
        200,
      );

      expect(again.body).toEqual({
        id: (first.body as { id: string }).id,
        created: false,
        analyzed: false,
      });
      expect(await prisma.offer.count()).toBe(1);
    });

    it('quota du modèle atteint pendant l’analyse : l’offre est gardée, sans note', async () => {
      model.queue.push(new LlmError('rate_limited', 'Quota'));

      const res = await create().expect(200);

      expect(res.body).toMatchObject({ created: true, analyzed: false });
      expect(await prisma.offer.count()).toBe(1);
    });

    it('un lien douteux ou une adresse invalide ne sont pas enregistrés', async () => {
      model.queue.push(analysis(50));

      const res = await create({
        applyUrl: 'javascript:alert(1)',
        contactEmail: 'pas une adresse',
      }).expect(200);

      const offer = await prisma.offer.findUniqueOrThrow({
        where: { id: (res.body as { id: string }).id },
      });
      expect(offer.applyUrl).toBeNull();
      expect(offer.contactEmail).toBeNull();
      expect(offer.channel).toBe('SITE');
    });

    it('refuse sans intitulé ou sans entreprise (400), et sans profil (400)', async () => {
      await create({ title: '' }).expect(400);
      await create({ company: '' }).expect(400);
      await prisma.profile.deleteMany();
      await create().expect(400);
      expect(await prisma.offer.count()).toBe(0);
    });

    it('une offre ajoutée à la main n’est jamais supprimée par le tri de pertinence de la collecte', async () => {
      model.queue.push(analysis(40));
      await create({
        title: 'Chargé de projet marketing',
        text: `${PASTED}\nMarketing digital.`,
      }).expect(200);

      // Un intitulé de marketing serait supprimé s'il venait d'une source collectée ; ajouté à la main, il reste.
      const result = await app.get(OffersService).cleanup(trustedSources(['M1805']));

      expect(result.removed).toBe(0);
      expect(await prisma.offer.count()).toBe(1);
    });
  });
});
