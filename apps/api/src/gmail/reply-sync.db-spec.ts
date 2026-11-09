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
import { PrismaService } from '../prisma/prisma.service';
import { buildQuery } from './reply-sync.service';

interface FakeMessage {
  id: string;
  subject: string;
  snippet: string;
  date: Date;
}

/** Faux Gmail : renvoie les messages préparés pour chaque requête de recherche et garde les requêtes reçues. */
class FakeGmail {
  messages: FakeMessage[] = [];
  queries: string[] = [];
  tokenStatus = 200;

  fetch = async (url: string): Promise<Response> => {
    if (url.includes('oauth2.googleapis.com')) {
      return this.tokenStatus === 200
        ? new Response(JSON.stringify({ access_token: 'acces', expires_in: 3600 }))
        : new Response('{"error":"invalid_grant"}', { status: this.tokenStatus });
    }
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/messages')) {
      this.queries.push(parsed.searchParams.get('q') ?? '');
      return new Response(JSON.stringify({ messages: this.messages.map((m) => ({ id: m.id })) }));
    }
    const id = decodeURIComponent(parsed.pathname.split('/messages/')[1] ?? '');
    const message = this.messages.find((m) => m.id === id);
    if (!message) return new Response('{}', { status: 404 });
    return new Response(
      JSON.stringify({
        id: message.id,
        snippet: message.snippet,
        internalDate: String(message.date.getTime()),
        payload: {
          headers: [
            { name: 'Subject', value: message.subject },
            { name: 'From', value: 'rh@exemple.test' },
          ],
        },
      }),
    );
  };
}

const message = (id: string, subject: string, snippet = ''): FakeMessage => ({
  id,
  subject,
  snippet,
  date: new Date(),
});

describe('buildQuery', () => {
  const appliedAt = new Date('2026-11-01T00:00:00Z');
  it('cherche par domaine de l’expéditeur quand le contact est connu', () => {
    expect(buildQuery({ appliedAt, contactEmail: 'rh@exemple.fr', company: 'X' })).toBe(
      `after:${Math.floor(appliedAt.getTime() / 1000)} -from:me from:@exemple.fr`,
    );
  });
  it('sinon cherche le nom de l’entreprise, nettoyé (guillemets, barres)', () => {
    const query = buildQuery({
      appliedAt,
      contactEmail: null,
      company: 'Acme" OR in:anywhere \\ "Corp',
    });
    expect(query).toContain('"Acme OR in:anywhere Corp"');
    expect(query?.match(/"/g)).toHaveLength(2);
  });
  it('ignore une entreprise inconnue ou un contact invalide sans nom', () => {
    expect(
      buildQuery({ appliedAt, contactEmail: null, company: 'Entreprise non indiquée' }),
    ).toBeNull();
    expect(buildQuery({ appliedAt, contactEmail: 'pas-une-adresse', company: '  ' })).toBeNull();
  });
});

describe('Suivi des réponses Gmail (e2e, base réelle, faux Gmail)', () => {
  const PASSWORD = 'un-mot-de-passe-solide-1234';
  const gmail = new FakeGmail();
  let dir: string;
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let session: { cookie: string; csrf: string };
  let applicationId: string;
  let offerId: string;

  async function start(configured = true) {
    writeFileSync(
      join(dir, 'token.json'),
      JSON.stringify({ client_id: 'cid', client_secret: 'sec', refresh_token: 'rtok' }),
    );
    vi.stubEnv('GMAIL_TOKEN_FILE', join(dir, configured ? 'token.json' : 'absent.json'));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    const offer = await prisma.offer.create({
      data: {
        source: 'LBA',
        externalId: 'o1',
        dedupKey: 'o1',
        title: 'Alternance développeur',
        company: 'Exemple SA',
        channel: 'EMAIL',
        contactEmail: 'rh@exemple.test',
      },
    });
    offerId = offer.id;
    applicationId = (
      await prisma.application.create({
        data: {
          offerId,
          status: 'APPLIED',
          subject: 'Objet',
          body: 'Texte',
          appliedAt: new Date(Date.now() - 3 * 86_400_000),
        },
      })
    ).id;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gmail-sync-'));
    gmail.messages = [];
    gmail.queries = [];
    gmail.tokenStatus = 200;
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (method: 'post' | 'patch', path: string) =>
    http[method](path).set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);
  const sync = () => write('post', '/gmail/sync');
  const statusOf = async () =>
    (await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })).status;

  it('exige une connexion et le jeton CSRF', async () => {
    await start();
    await http.post('/gmail/sync').expect(401);
    await http.post('/gmail/sync').set('Cookie', session.cookie).expect(403);
    await http.patch('/replies/00000000-0000-4000-8000-000000000000').expect(401);
    expect(gmail.queries).toHaveLength(0);
  });

  it('enregistre et classe les réponses, puis fait avancer le statut', async () => {
    await start();
    gmail.messages = [
      message('m1', 'Accusé de réception', 'Nous avons bien reçu votre candidature.'),
    ];

    const res = await sync().expect(200);

    expect(res.body).toMatchObject({ checked: 1, newReplies: 1, statusChanges: 1 });
    expect(gmail.queries[0]).toContain('from:@exemple.test');
    expect(gmail.queries[0]).toContain('-from:me');
    expect(await statusOf()).toBe('ACKNOWLEDGED');
    const reply = await prisma.reply.findFirstOrThrow();
    expect(reply).toMatchObject({ kind: 'ACKNOWLEDGEMENT', gmailMessageId: 'm1' });
  });

  it('ne duplique pas un message déjà vu et ne fait pas reculer le statut', async () => {
    await start();
    gmail.messages = [message('m1', 'Entretien', 'Seriez-vous disponible jeudi ?')];
    await sync().expect(200);
    expect(await statusOf()).toBe('INTERVIEW');

    gmail.messages = [
      message('m1', 'Entretien', 'Seriez-vous disponible jeudi ?'),
      message('m2', 'Accusé de réception', 'Bien reçu votre candidature'),
    ];
    const res = await sync().expect(200);

    expect(res.body).toMatchObject({ newReplies: 1, statusChanges: 0 });
    expect(await prisma.reply.count()).toBe(2);
    expect(await statusOf()).toBe('INTERVIEW');
  });

  it('ne conserve que 300 caractères d’extrait', async () => {
    await start();
    gmail.messages = [message('m1', 'Info', 'x'.repeat(2_000))];
    await sync().expect(200);
    expect((await prisma.reply.findFirstOrThrow()).snippet).toHaveLength(300);
  });

  it('passe en « sans réponse » après 14 jours sans aucun message', async () => {
    await start();
    await prisma.application.update({
      where: { id: applicationId },
      data: { appliedAt: new Date(Date.now() - 15 * 86_400_000) },
    });

    const res = await sync().expect(200);

    expect(res.body).toMatchObject({ noResponse: 1 });
    expect(await statusOf()).toBe('NO_RESPONSE');
  });

  it('une réponse tardive fait sortir de « sans réponse »', async () => {
    await start();
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: 'NO_RESPONSE', appliedAt: new Date(Date.now() - 20 * 86_400_000) },
    });
    gmail.messages = [message('m1', 'Entretien', 'Rendez-vous ?')];

    await sync().expect(200);

    expect(await statusOf()).toBe('INTERVIEW');
  });

  it('ne cherche pas une entreprise inconnue (pas de balayage de la boîte)', async () => {
    await start();
    await prisma.offer.update({
      where: { id: offerId },
      data: { contactEmail: null, company: 'Entreprise non indiquée' },
    });

    const res = await sync().expect(200);

    expect(res.body).toMatchObject({ checked: 0, skipped: 1 });
    expect(gmail.queries).toHaveLength(0);
  });

  it('ignore les candidatures qui ne sont pas envoyées', async () => {
    await start();
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: 'VALIDATED' },
    });
    const res = await sync().expect(200);
    expect(res.body).toMatchObject({ checked: 0 });
    expect(gmail.queries).toHaveLength(0);
  });

  it('permet de corriger un refus détecté à tort : le statut suit', async () => {
    await start();
    gmail.messages = [
      message('m1', 'Votre candidature', 'Malheureusement nous ne donnons pas suite.'),
    ];
    await sync().expect(200);
    expect(await statusOf()).toBe('REJECTED');
    const reply = await prisma.reply.findFirstOrThrow();

    const res = await write('patch', `/replies/${reply.id}`).send({ kind: 'OTHER' }).expect(200);

    expect(res.body).toMatchObject({ kind: 'OTHER' });
    expect(await statusOf()).toBe('APPLIED');
  });

  it('refuse une catégorie inconnue (400), un champ en trop (400) et un message inconnu (404)', async () => {
    await start();
    gmail.messages = [message('m1', 'Info')];
    await sync().expect(200);
    const reply = await prisma.reply.findFirstOrThrow();
    await write('patch', `/replies/${reply.id}`).send({ kind: 'AUTRE' }).expect(400);
    await write('patch', `/replies/${reply.id}`).send({ kind: 'OTHER', x: 1 }).expect(400);
    await write('patch', '/replies/00000000-0000-4000-8000-000000000000')
      .send({ kind: 'OTHER' })
      .expect(404);
  });

  it('répond 503 sans modifier la base quand l’autorisation Gmail est expirée', async () => {
    await start();
    gmail.tokenStatus = 400;
    await sync().expect(503);
    expect(await prisma.reply.count()).toBe(0);
    expect(await statusOf()).toBe('APPLIED');
  });

  it('répond 503 quand Gmail n’est pas configuré', async () => {
    await start(false);
    await sync().expect(503);
  });

  it('expose le bilan de la dernière synchronisation', async () => {
    await start();
    await http.get('/gmail/sync').set('Cookie', session.cookie).expect(404);
    await sync().expect(200);
    const last = await http.get('/gmail/sync').set('Cookie', session.cookie).expect(200);
    expect(last.body).toMatchObject({ checked: 1 });
  });

  it('le détail d’une candidature et la liste exposent le dernier échange', async () => {
    await start();
    gmail.messages = [message('m1', 'Accusé de réception', 'Bien reçu votre candidature')];
    await sync().expect(200);

    const list = await http.get('/applications').set('Cookie', session.cookie).expect(200);

    const [row] = list.body as { replies: { kind: string; snippet: string }[] }[];
    expect(row?.replies[0]).toMatchObject({ kind: 'ACKNOWLEDGEMENT' });
  });
});
