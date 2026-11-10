import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { PasswordService } from '../auth/password.service';
import { parseEnv } from '../config/env';
import { HTTP_FETCH } from '../http/http-fetch';
import { FACT_ACHIEVEMENT } from '../letters/letter.fixture';
import { LlmProvider, type LlmRequest, type LlmResponse } from '../llm/llm.types';
import { PrismaService } from '../prisma/prisma.service';
import { exampleProfile } from '../profile/profile.fixture';

/** Faux modèle : rejoue des réponses préparées et garde les requêtes reçues. */
class FakeModel extends LlmProvider {
  queue: object[] = [];
  requests: LlmRequest[] = [];
  async generate(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error('plus de réponse préparée');
    return { text: JSON.stringify(next), usage: { promptTokens: 10, outputTokens: 10 } };
  }
}

/** Faux Gmail : garde les brouillons créés et supprimés. */
class FakeGmail {
  drafts = new Map<string, string>();
  deleted: string[] = [];
  counter = 0;
  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'acces', expires_in: 3600 }));
    }
    if (init?.method === 'POST' && url.endsWith('/drafts')) {
      const id = `draft-${(this.counter += 1)}`;
      const raw = (JSON.parse(init.body as string) as { message: { raw: string } }).message.raw;
      this.drafts.set(id, Buffer.from(raw, 'base64url').toString('utf8'));
      return new Response(JSON.stringify({ id }));
    }
    if (init?.method === 'DELETE') {
      const id = decodeURIComponent(url.split('/drafts/')[1] ?? '');
      this.deleted.push(id);
      return this.drafts.delete(id)
        ? new Response(null, { status: 204 })
        : new Response('{}', { status: 404 });
    }
    return new Response('{}', { status: 404 });
  };
}

/** Relance valide : 60 à 130 mots, aucun chiffre hors profil, aucune coordonnée, aucun repère à compléter. */
const followUp = (overrides: Partial<{ body: string; usedFacts: string[] }> = {}) => ({
  body: [
    'Madame, Monsieur,',
    "Il y a quelques jours, je vous ai adressé ma candidature pour le poste d'alternant développeur au sein de votre entreprise, et je souhaitais savoir où en était l'étude de mon dossier.",
    "Depuis, j'ai poursuivi mon travail sur la performance côté serveur, un sujet qui rejoint les besoins de votre équipe : mon expérience avec TypeScript, React et Docker m'a appris à mesurer avant d'optimiser. Je serais heureux de vous présenter mon code lors d'un court échange, quand cela vous conviendrait.",
  ].join('\n\n'),
  usedFacts: [FACT_ACHIEVEMENT, 'TypeScript'],
  ...overrides,
});

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

describe('Relance des candidatures (e2e, base réelle, faux modèle et faux Gmail)', () => {
  const PASSWORD = 'un-mot-de-passe-solide-1234';
  const model = new FakeModel();
  const gmail = new FakeGmail();
  let dir: string;
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let session: { cookie: string; csrf: string };
  let applicationId: string;

  const write = (method: 'post' | 'put' | 'delete', path: string) =>
    http[method](path).set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);
  const generate = (id = applicationId) => write('post', `/applications/${id}/follow-up`);
  const draft = (body: object, id = applicationId) =>
    write('post', `/applications/${id}/follow-up/draft`).send(body);
  const done = (id = applicationId) => write('post', `/applications/${id}/follow-up/done`);
  const row = () => prisma.application.findUniqueOrThrow({ where: { id: applicationId } });

  async function createApplication(extra: Record<string, unknown> = {}) {
    await prisma.offer.deleteMany();
    const offer = await prisma.offer.create({
      data: {
        source: 'LBA',
        externalId: 'o1',
        dedupKey: 'o1',
        title: 'Alternance développeur',
        company: 'Exemple SA',
        city: 'Paris',
        channel: 'EMAIL',
        contactEmail: 'rh@exemple.test',
      },
    });
    applicationId = (
      await prisma.application.create({
        data: {
          offerId: offer.id,
          status: 'APPLIED',
          subject: 'Candidature en alternance',
          body: 'Madame, Monsieur,\n\nTexte de la lettre déjà envoyée.',
          appliedAt: daysAgo(9),
          ...extra,
        },
      })
    ).id;
  }

  beforeEach(async () => {
    model.queue = [];
    model.requests = [];
    gmail.drafts.clear();
    gmail.deleted = [];
    gmail.counter = 0;
    dir = mkdtempSync(join(tmpdir(), 'relance-db-'));
    writeFileSync(
      join(dir, 'token.json'),
      JSON.stringify({ client_id: 'cid', client_secret: 'sec', refresh_token: 'rtok' }),
    );
    vi.stubEnv('GMAIL_TOKEN_FILE', join(dir, 'token.json'));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmProvider)
      .useValue(model)
      .overrideProvider(HTTP_FETCH)
      .useValue(gmail.fetch)
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
    await createApplication();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('à relancer', () => {
    it('la liste et le détail disent quelles candidatures sont à relancer, relancées, ou à classer sans suite', async () => {
      const get = async () =>
        (await http.get('/applications').set('Cookie', session.cookie).expect(200)).body as {
          id: string;
          followUp: string | null;
        }[];

      expect((await get())[0]?.followUp).toBe('due');
      const detail = await http
        .get(`/applications/${applicationId}`)
        .set('Cookie', session.cookie)
        .expect(200);
      expect((detail.body as { followUp: string }).followUp).toBe('due');

      await prisma.application.update({
        where: { id: applicationId },
        data: { followedUpAt: daysAgo(2) },
      });
      expect((await get())[0]?.followUp).toBe('done');

      await prisma.application.update({
        where: { id: applicationId },
        data: { followedUpAt: daysAgo(11) },
      });
      expect((await get())[0]?.followUp).toBe('give_up');
    });

    it('pas encore « à relancer » avant 8 jours, ni après un accusé de réception récent', async () => {
      await prisma.application.update({
        where: { id: applicationId },
        data: { appliedAt: daysAgo(3) },
      });
      const early = await http.get('/applications').set('Cookie', session.cookie).expect(200);
      expect((early.body as { followUp: string | null }[])[0]?.followUp).toBeNull();

      await prisma.application.update({
        where: { id: applicationId },
        data: { appliedAt: daysAgo(20), status: 'ACKNOWLEDGED' },
      });
      await prisma.reply.create({
        data: {
          applicationId,
          gmailMessageId: 'm1',
          kind: 'ACKNOWLEDGEMENT',
          receivedAt: daysAgo(2),
        },
      });
      const acked = await http.get('/applications').set('Cookie', session.cookie).expect(200);
      expect((acked.body as { followUp: string | null }[])[0]?.followUp).toBeNull();
    });
  });

  describe('rédaction', () => {
    it('exige une connexion et le jeton CSRF, sans appeler le modèle', async () => {
      await http.post(`/applications/${applicationId}/follow-up`).expect(401);
      await http
        .post(`/applications/${applicationId}/follow-up`)
        .set('Cookie', session.cookie)
        .expect(403);
      expect(model.requests).toHaveLength(0);
    });

    it('rédige la relance : objet « Relance : … », message signé localement, destinataire, rien enregistré', async () => {
      model.queue.push(followUp());

      const res = await generate().expect(200);

      const body = res.body as {
        subject: string;
        body: string;
        preview: string;
        to: string | null;
        warnings: string[];
      };
      expect(body.subject).toBe('Relance : Candidature en alternance');
      expect(body.to).toBe('rh@exemple.test');
      expect(body.preview).toContain('Cordialement,\nCamille Exemple');
      expect(body.body).not.toContain('Camille');
      expect(body.warnings).toEqual([]);
      // La lettre déjà envoyée est transmise au modèle (comme texte non fiable), le nom et le mail du candidat non.
      const prompt = model.requests[0]?.user ?? '';
      expect(prompt).toContain('Texte de la lettre déjà envoyée.');
      expect(prompt).not.toContain('camille@exemple.test');
      // Rien n'est enregistré à ce stade : l'utilisateur relit d'abord.
      expect((await row()).followedUpAt).toBeNull();
      expect(gmail.drafts.size).toBe(0);
    });

    it('refuse un message qui ne respecte pas les garde-fous (chiffre inventé), après deux essais', async () => {
      const invented = followUp({
        body: followUp().body.replace('quelques jours', '37 jours'),
      });
      model.queue.push(invented, invented);

      const res = await generate().expect(422);

      expect(JSON.stringify(res.body)).not.toContain('37 jours');
      expect(model.requests).toHaveLength(2);
      // La seconde demande dit CE QUI est refusé, avec la longueur propre à une relance.
      expect(model.requests[1]?.user).toContain('chiffre');
    });

    it('refuse un message trop long pour une relance', async () => {
      const long = followUp({ body: `${followUp().body}\n\n${followUp().body}` });
      model.queue.push(long, long);

      await generate().expect(422);
      expect(model.requests[1]?.user).toContain('entre 60 et 130 mots');
    });

    it.each(['TO_REVIEW', 'VALIDATED', 'DRAFT_CREATED', 'INTERVIEW', 'REJECTED'] as const)(
      'refuse (409) une candidature au statut %s',
      async (status) => {
        await prisma.application.update({ where: { id: applicationId }, data: { status } });

        await generate().expect(409);
        expect(model.requests).toHaveLength(0);
      },
    );

    it('refuse (409) une seconde relance, et 404 pour une candidature inconnue', async () => {
      await prisma.application.update({
        where: { id: applicationId },
        data: { followedUpAt: new Date() },
      });

      await generate().expect(409);
      await generate('00000000-0000-4000-8000-000000000000').expect(404);
      await generate('pas-un-uuid').expect(400);
      expect(model.requests).toHaveLength(0);
    });
  });

  describe('brouillon Gmail', () => {
    const payload = { subject: 'Relance : Candidature en alternance', body: followUp().body };

    it('crée le brouillon (destinataire, objet, signature), pose la date de relance, sans rien envoyer', async () => {
      const res = await draft(payload).expect(200);

      expect(res.body).toMatchObject({ applicationId, draftId: 'draft-1', to: 'rh@exemple.test' });
      const message = gmail.drafts.get('draft-1') ?? '';
      expect(message).toContain('To: rh@exemple.test');
      expect(message).toContain('Subject: Relance : Candidature en alternance');
      const saved = await row();
      expect(saved.followedUpAt).not.toBeNull();
      expect(saved.followUpDraftId).toBe('draft-1');
      // Le statut ne bouge pas : la candidature reste « envoyée », seule la relance est notée.
      expect(saved.status).toBe('APPLIED');
    });

    it('une seule relance : la seconde est refusée et ne laisse aucun brouillon en plus', async () => {
      await draft(payload).expect(200);

      await draft(payload).expect(409);

      expect(gmail.drafts.size).toBe(1);
    });

    it('refuse (409) une candidature qui n’est pas en attente de réponse', async () => {
      await prisma.application.update({
        where: { id: applicationId },
        data: { status: 'INTERVIEW' },
      });

      await draft(payload).expect(409);
      expect(gmail.drafts.size).toBe(0);
    });

    it('refuse un message avec un repère à compléter (422) ou trop court / champ inconnu (400)', async () => {
      await draft({ ...payload, body: `${payload.body} Je suis [prénom].` }).expect(422);
      await draft({ ...payload, body: 'Trop court' }).expect(400);
      await draft({ ...payload, extra: 'x' }).expect(400);
      expect(gmail.drafts.size).toBe(0);
    });

    it('un objet avec retour à la ligne ne peut pas injecter d’en-tête', async () => {
      await draft({ ...payload, subject: 'Relance\r\nBcc: pirate@exemple.test' }).expect(200);

      // Le texte reste dans l'objet (sur une ligne), mais aucun en-tête « Bcc » n'existe.
      const headers = (gmail.drafts.get('draft-1') ?? '').split('\r\n\r\n')[0] ?? '';
      expect(headers.split('\r\n').some((line) => /^bcc:/i.test(line))).toBe(false);
      expect(headers).toContain('Subject: Relance Bcc: pirate@exemple.test');
    });

    it('supprimer la candidature supprime aussi le brouillon de relance', async () => {
      await draft(payload).expect(200);

      await write('delete', `/applications/${applicationId}`).expect(200);

      expect(gmail.deleted).toContain('draft-1');
      expect(await prisma.application.count()).toBe(0);
    });
  });

  describe('relance faite autrement (téléphone, LinkedIn)', () => {
    it('la déclare faite : la candidature sort de « à relancer », une seule fois', async () => {
      const res = await done().expect(200);

      expect((res.body as { followUp: string }).followUp).toBe('done');
      expect((await row()).followedUpAt).not.toBeNull();
      expect(gmail.drafts.size).toBe(0);
      await done().expect(409);
    });

    it('refuse un statut sans attente de réponse, une candidature inconnue, et exige la session', async () => {
      await prisma.application.update({
        where: { id: applicationId },
        data: { status: 'REJECTED' },
      });

      await done().expect(409);
      await done('00000000-0000-4000-8000-000000000000').expect(404);
      await http.post(`/applications/${applicationId}/follow-up/done`).expect(401);
    });
  });
});
