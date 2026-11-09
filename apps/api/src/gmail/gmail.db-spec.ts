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
import { exampleProfile } from '../profile/profile.fixture';

/** Faux Gmail : garde les brouillons créés/supprimés et peut simuler une panne. */
class FakeGmail {
  drafts = new Map<string, string>();
  deleted: string[] = [];
  down = false;
  counter = 0;

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'acces', expires_in: 3600 }));
    }
    if (this.down) return new Response('{}', { status: 503 });
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

describe('Brouillons Gmail (e2e, base réelle, faux Gmail)', () => {
  const PASSWORD = 'un-mot-de-passe-solide-1234';
  const gmail = new FakeGmail();
  let dir: string;
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let session: { cookie: string; csrf: string };
  let applicationId: string;

  async function start(configured: boolean) {
    if (configured) {
      writeFileSync(
        join(dir, 'token.json'),
        JSON.stringify({ client_id: 'cid', client_secret: 'sec', refresh_token: 'rtok' }),
      );
      vi.stubEnv('GMAIL_TOKEN_FILE', join(dir, 'token.json'));
    } else {
      vi.stubEnv('GMAIL_TOKEN_FILE', join(dir, 'absent.json'));
    }
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
    await write('put', '/profile').send(exampleProfile()).expect(200);
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
          status: 'VALIDATED',
          subject: 'Candidature — développeur été',
          body: 'Bonjour,\nTexte de la lettre.',
        },
      })
    ).id;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gmail-db-'));
    gmail.drafts.clear();
    gmail.deleted = [];
    gmail.down = false;
    gmail.counter = 0;
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (method: 'post' | 'put' | 'delete', path: string) =>
    http[method](path).set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);
  const draft = (id = applicationId) => write('post', `/applications/${id}/draft`);

  it('exige une connexion et le jeton CSRF', async () => {
    await start(true);
    await http.post(`/applications/${applicationId}/draft`).expect(401);
    await http
      .post(`/applications/${applicationId}/draft`)
      .set('Cookie', session.cookie)
      .expect(403);
    await http.get('/gmail/status').expect(401);
    expect(gmail.drafts.size).toBe(0);
  });

  it('crée le brouillon complet (destinataire, objet encodé, signature) et passe au statut « brouillon créé »', async () => {
    await start(true);

    const res = await draft().expect(200);

    expect(res.body).toMatchObject({ applicationId, draftId: 'draft-1', to: 'rh@exemple.test' });
    const message = gmail.drafts.get('draft-1') ?? '';
    expect(message).toContain('To: rh@exemple.test');
    expect(message).toContain('Subject: =?UTF-8?B?');
    const body = Buffer.from(
      (message.split('\r\n\r\n')[1] ?? '').replace(/\r\n/g, ''),
      'base64',
    ).toString('utf8');
    expect(body).toContain('Texte de la lettre.');
    expect(body).toContain('Cordialement');
    const stored = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(stored).toMatchObject({ status: 'DRAFT_CREATED', gmailDraftId: 'draft-1' });
  });

  it('crée un brouillon sans destinataire pour une candidature par le site', async () => {
    await start(true);
    await prisma.offer.updateMany({ data: { channel: 'SITE' } });

    const res = await draft().expect(200);

    expect((res.body as { to: unknown }).to).toBeNull();
    expect(gmail.drafts.get('draft-1')).not.toContain('To:');
  });

  it('n’envoie jamais une adresse mal formée à Gmail (injection d’en-tête)', async () => {
    await start(true);
    await prisma.offer.updateMany({
      data: { contactEmail: 'rh@exemple.test\r\nBcc: victime@exemple.test' },
    });

    await draft().expect(200);

    expect(gmail.drafts.get('draft-1')).not.toMatch(/bcc:/i);
  });

  it('refuse une candidature qui n’est pas « validée » (409) et ne crée pas deux brouillons', async () => {
    await start(true);
    await draft().expect(200);
    await draft().expect(409);
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: 'TO_REVIEW' },
    });
    await draft().expect(409);
    expect(gmail.drafts.size).toBe(1);
  });

  it('répond 404 (inconnue), 400 (identifiant mal formé) et 400 (profil absent)', async () => {
    await start(true);
    await draft('00000000-0000-4000-8000-000000000000').expect(404);
    await draft('pas-un-uuid').expect(400);
    await prisma.profile.deleteMany();
    await draft().expect(400);
  });

  it('répond 503 sans fichier d’autorisation, sans rien modifier', async () => {
    await start(false);
    await draft().expect(503);
    expect(
      (await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })).status,
    ).toBe('VALIDATED');
    const status = await http.get('/gmail/status').set('Cookie', session.cookie).expect(200);
    expect(status.body).toEqual({ configured: false });
  });

  it('répond 502 si Gmail est en panne et garde la candidature « validée »', async () => {
    await start(true);
    gmail.down = true;
    await draft().expect(502);
    expect(
      (await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })).status,
    ).toBe('VALIDATED');
  });

  it('supprime le brouillon Gmail quand on supprime la candidature (R33)', async () => {
    await start(true);
    await draft().expect(200);

    const res = await write('delete', `/applications/${applicationId}`).expect(200);

    expect(res.body).toEqual({ gmailDraftDeleted: true });
    expect(gmail.deleted).toEqual(['draft-1']);
    expect(await prisma.application.count()).toBe(0);
  });

  it('supprime quand même la candidature si Gmail est injoignable, et le signale', async () => {
    await start(true);
    await draft().expect(200);
    gmail.down = true;

    const res = await write('delete', `/applications/${applicationId}`).expect(200);

    expect(res.body).toEqual({ gmailDraftDeleted: false });
    expect(await prisma.application.count()).toBe(0);
  });

  it('retire le brouillon quand on revient à « validée » ou qu’on retire la candidature', async () => {
    await start(true);
    await draft().expect(200);

    await write('post', `/applications/${applicationId}/status`)
      .send({ status: 'VALIDATED' })
      .expect(200);

    expect(gmail.deleted).toEqual(['draft-1']);
    expect(
      await prisma.application.findUniqueOrThrow({ where: { id: applicationId } }),
    ).toMatchObject({
      status: 'VALIDATED',
      gmailDraftId: null,
    });
    // Et on peut en créer un nouveau.
    await draft().expect(200);
    expect(gmail.drafts.size).toBe(1);
  });

  it('garde le brouillon quand la candidature est marquée « envoyée »', async () => {
    await start(true);
    await draft().expect(200);

    await write('post', `/applications/${applicationId}/status`)
      .send({ status: 'APPLIED' })
      .expect(200);

    expect(gmail.deleted).toEqual([]);
  });

  it('l’effacement du compte supprime aussi les brouillons Gmail', async () => {
    await start(true);
    await draft().expect(200);

    await http
      .post('/account/erase')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ password: PASSWORD })
      .expect(204);

    expect(gmail.deleted).toEqual(['draft-1']);
  });

  it('l’état DRAFT_CREATED ne peut toujours pas être posé à la main', async () => {
    await start(true);
    await write('post', `/applications/${applicationId}/status`)
      .send({ status: 'DRAFT_CREATED' })
      .expect(409);
  });
});
