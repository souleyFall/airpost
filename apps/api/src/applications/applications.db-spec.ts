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

describe('Candidatures (e2e, base réelle)', () => {
  const PASSWORD = 'un-mot-de-passe-solide-1234';
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let session: { cookie: string; csrf: string };
  let offerId: string;
  let id: string;

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
    const offer = await prisma.offer.create({
      data: {
        source: 'LBA',
        externalId: 'o1',
        dedupKey: 'o1',
        title: 'Alternance développeur',
        company: 'Exemple SA',
        city: 'Paris',
        channel: 'SITE',
        description: 'Description longue',
        contactEmail: 'rh@exemple.test',
        score: 80,
      },
    });
    offerId = offer.id;
    id = (
      await prisma.application.create({
        data: { offerId, subject: 'Objet initial', body: 'Texte initial de la lettre' },
      })
    ).id;
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (path: string) => http.get(path).set('Cookie', session.cookie);
  const write = (method: 'post' | 'patch' | 'delete', path: string) =>
    http[method](path).set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);
  const setStatus = (to: string, target = id) =>
    write('post', `/applications/${target}/status`).send({ status: to });

  it('exige une connexion, et le jeton CSRF pour toute écriture', async () => {
    await http.get('/applications').expect(401);
    await http.get(`/applications/${id}`).expect(401);
    await http
      .patch(`/applications/${id}`)
      .set('Cookie', session.cookie)
      .send({ subject: 'x' })
      .expect(403);
    await http
      .post(`/applications/${id}/status`)
      .set('Cookie', session.cookie)
      .send({ status: 'VALIDATED' })
      .expect(403);
    await http.delete(`/applications/${id}`).set('Cookie', session.cookie).expect(403);
  });

  describe('lecture', () => {
    it('liste avec un résumé de l’offre, sans description ni texte de la lettre', async () => {
      const res = await get('/applications').expect(200);

      const items = res.body as { id: string; status: string; offer: { title: string } }[];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id,
        status: 'TO_REVIEW',
        offer: { title: 'Alternance développeur' },
      });
      expect(JSON.stringify(res.body)).not.toContain('Description longue');
      expect(JSON.stringify(res.body)).not.toContain('Texte initial');
    });

    it('filtre par statut et refuse un statut inconnu', async () => {
      expect((await get('/applications?status=APPLIED').expect(200)).body).toEqual([]);
      expect(
        ((await get('/applications?status=TO_REVIEW').expect(200)).body as unknown[]).length,
      ).toBe(1);
      await get('/applications?status=INCONNU').expect(400);
    });

    it('borne la liste (limit) et refuse une limite absurde', async () => {
      for (let i = 0; i < 3; i++) {
        const o = await prisma.offer.create({
          data: {
            source: 'LBA',
            externalId: `extra-${i}`,
            dedupKey: `extra-${i}`,
            title: 'T',
            company: 'C',
            channel: 'SITE',
          },
        });
        await prisma.application.create({ data: { offerId: o.id, subject: 's', body: 'b' } });
      }

      expect(((await get('/applications?limit=2').expect(200)).body as unknown[]).length).toBe(2);
      expect(((await get('/applications').expect(200)).body as unknown[]).length).toBe(4);
      await get('/applications?limit=0').expect(400);
      await get('/applications?limit=501').expect(400);
    });

    it('détaille une candidature : lettre, offre complète, réponses reçues', async () => {
      await prisma.reply.create({
        data: {
          applicationId: id,
          gmailMessageId: 'm1',
          kind: 'ACKNOWLEDGEMENT',
          receivedAt: new Date(),
          snippet: 'Bien reçu',
        },
      });

      const res = await get(`/applications/${id}`).expect(200);

      expect(res.body).toMatchObject({
        id,
        body: 'Texte initial de la lettre',
        offer: { description: 'Description longue', contactEmail: 'rh@exemple.test' },
        replies: [{ kind: 'ACKNOWLEDGEMENT', snippet: 'Bien reçu' }],
      });
    });

    it('répond 404 pour une candidature inconnue, 400 pour un identifiant mal formé', async () => {
      await get('/applications/00000000-0000-4000-8000-000000000000').expect(404);
      await get('/applications/pas-un-uuid').expect(400);
    });
  });

  describe('modification du brouillon', () => {
    it('modifie l’objet et le texte', async () => {
      const res = await write('patch', `/applications/${id}`)
        .send({ subject: 'Nouvel objet', body: 'Nouveau texte' })
        .expect(200);

      expect(res.body).toMatchObject({ subject: 'Nouvel objet', body: 'Nouveau texte' });
    });

    it('met l’objet sur une seule ligne (en-tête de message)', async () => {
      const res = await write('patch', `/applications/${id}`)
        .send({ subject: 'Objet\r\nBcc: quelquun' })
        .expect(200);

      expect((res.body as { subject: string }).subject).toBe('Objet Bcc: quelquun');
    });

    it.each([
      ['aucun champ', {}],
      ['champ inconnu', { subject: 'ok', status: 'APPLIED' }],
      ['objet vide', { subject: '   ' }],
      ['objet trop long', { subject: 'x'.repeat(121) }],
      ['texte trop long', { body: 'x'.repeat(3_001) }],
      ['mauvais type', { body: 42 }],
    ])('refuse (400) : %s', async (_name, body) => {
      await write('patch', `/applications/${id}`).send(body).expect(400);
    });

    it('refuse (409) de modifier une candidature validée', async () => {
      await setStatus('VALIDATED').expect(200);

      await write('patch', `/applications/${id}`).send({ body: 'Tentative' }).expect(409);

      expect((await prisma.application.findUniqueOrThrow({ where: { id } })).body).toBe(
        'Texte initial de la lettre',
      );
    });

    it('répond 404 pour une candidature inconnue', async () => {
      await write('patch', '/applications/00000000-0000-4000-8000-000000000000')
        .send({ body: 'x' })
        .expect(404);
    });
  });

  describe('cycle de vie', () => {
    it('suit le parcours à valider → validée → postulée → accusé → entretien, avec les dates', async () => {
      const validated = await setStatus('VALIDATED').expect(200);
      expect((validated.body as { validatedAt: string | null }).validatedAt).not.toBeNull();

      const applied = await setStatus('APPLIED').expect(200);
      expect((applied.body as { appliedAt: string | null }).appliedAt).not.toBeNull();

      await setStatus('ACKNOWLEDGED').expect(200);
      const interview = await setStatus('INTERVIEW').expect(200);
      expect((interview.body as { status: string }).status).toBe('INTERVIEW');
    });

    it('refuse (409) un passage hors du cycle, sans modifier la candidature', async () => {
      await setStatus('APPLIED').expect(409); // pas de « postulée » sans validation
      await setStatus('INTERVIEW').expect(409);

      expect((await prisma.application.findUniqueOrThrow({ where: { id } })).status).toBe(
        'TO_REVIEW',
      );
    });

    it('réserve « brouillon créé » au module Gmail', async () => {
      await setStatus('VALIDATED').expect(200);

      await setStatus('DRAFT_CREATED').expect(409);
    });

    it('permet de repasser de validée à « à valider » (date de validation effacée)', async () => {
      await setStatus('VALIDATED').expect(200);

      const res = await setStatus('TO_REVIEW').expect(200);

      expect(res.body).toMatchObject({ status: 'TO_REVIEW', validatedAt: null });
    });

    it('refuse de valider sans objet ou sans texte (422)', async () => {
      await prisma.application.update({ where: { id }, data: { body: null } });

      await setStatus('VALIDATED').expect(422);

      expect((await prisma.application.findUniqueOrThrow({ where: { id } })).status).toBe(
        'TO_REVIEW',
      );
    });

    it('refuse un statut inconnu ou un champ en trop (400), et une candidature inconnue (404)', async () => {
      await setStatus('N_IMPORTE_QUOI').expect(400);
      await write('post', `/applications/${id}/status`)
        .send({ status: 'VALIDATED', extra: 1 })
        .expect(400);
      await setStatus('VALIDATED', '00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('le retrait et le refus sont définitifs', async () => {
      await setStatus('WITHDRAWN').expect(200);

      await setStatus('TO_REVIEW').expect(409);
      await setStatus('VALIDATED').expect(409);
    });

    it('deux changements simultanés : un seul gagne, l’autre reçoit 409', async () => {
      await setStatus('VALIDATED').expect(200);

      const [a, b] = await Promise.all([setStatus('APPLIED'), setStatus('WITHDRAWN')]);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });
  });

  describe('suppression (RGPD)', () => {
    it('supprime la candidature, ses réponses et le contact du recruteur, mais pas l’offre publique', async () => {
      await prisma.reply.create({
        data: { applicationId: id, gmailMessageId: 'm1', kind: 'OTHER', receivedAt: new Date() },
      });

      await write('delete', `/applications/${id}`).expect(204);

      expect(await prisma.application.count()).toBe(0);
      expect(await prisma.reply.count()).toBe(0);
      const offer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
      expect(offer.contactEmail).toBeNull();
      expect(offer.title).toBe('Alternance développeur');
    });

    it('répond 404 pour une candidature déjà supprimée', async () => {
      await write('delete', `/applications/${id}`).expect(204);

      await write('delete', `/applications/${id}`).expect(404);
    });
  });
});
