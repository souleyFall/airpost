import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import { GmailClient, GmailError } from './gmail.client';

interface Call {
  url: string;
  init?: RequestInit;
}

describe('GmailClient', () => {
  let dir: string;
  let calls: Call[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gmail-'));
    calls = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

  function clientWith(
    handler: (url: string, init?: RequestInit) => Response,
    files: { token?: object; credentials?: object } = {
      token: { client_id: 'cid', client_secret: 'csecret', refresh_token: 'rtok' },
    },
  ) {
    const env: Partial<Env> = {};
    if (files.token) {
      writeFileSync(join(dir, 'token.json'), JSON.stringify(files.token));
      env.GMAIL_TOKEN_FILE = join(dir, 'token.json');
    }
    if (files.credentials) {
      writeFileSync(join(dir, 'credentials.json'), JSON.stringify(files.credentials));
      env.GMAIL_CREDENTIALS_FILE = join(dir, 'credentials.json');
    }
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    });
    return new GmailClient(env as Env, http);
  }

  const ok = (url: string) =>
    url.includes('oauth2.googleapis.com')
      ? json({ access_token: 'acces-1', expires_in: 3600 })
      : json({ id: 'draft-1' });

  it('n’est pas configuré sans fichier d’autorisation', async () => {
    const client = clientWith(ok, {});
    expect(client.isConfigured()).toBe(false);
    await expect(client.createDraft('raw')).rejects.toMatchObject({ reason: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('renouvelle le jeton puis crée le brouillon, et réutilise le jeton tant qu’il est valide', async () => {
    const client = clientWith(ok);
    expect(client.isConfigured()).toBe(true);

    expect(await client.createDraft('RAW1')).toBe('draft-1');
    await client.createDraft('RAW2');

    const tokenCalls = calls.filter((c) => c.url.includes('oauth2'));
    expect(tokenCalls).toHaveLength(1);
    const form = new URLSearchParams(tokenCalls[0]?.init?.body as string);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('rtok');
    const draft = calls.find((c) => c.url.endsWith('/drafts'));
    expect((draft?.init?.headers as Record<string, string>).Authorization).toBe('Bearer acces-1');
    expect(JSON.parse(draft?.init?.body as string)).toEqual({ message: { raw: 'RAW1' } });
  });

  it('prend le client OAuth dans credentials.json quand token.json ne le contient pas', async () => {
    const client = clientWith(ok, {
      token: { refresh_token: 'rtok' },
      credentials: { installed: { client_id: 'cid2', client_secret: 'sec2' } },
    });
    await client.createDraft('RAW');
    const form = new URLSearchParams(
      calls.find((c) => c.url.includes('oauth2'))?.init?.body as string,
    );
    expect(form.get('client_id')).toBe('cid2');
  });

  it('signale une autorisation expirée (invalid_grant) sans révéler de secret', async () => {
    const client = clientWith((url) =>
      url.includes('oauth2') ? json({ error: 'invalid_grant' }, 400) : json({}),
    );
    const error = await client.createDraft('RAW').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GmailError);
    expect((error as GmailError).reason).toBe('unauthorized');
    expect((error as GmailError).message).not.toMatch(/rtok|csecret|cid/);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rate_limited'],
    [400, 'invalid'],
    [500, 'unavailable'],
  ])('traduit la réponse %i de Gmail en « %s »', async (status, reason) => {
    const client = clientWith((url) => (url.includes('oauth2') ? ok(url) : json({}, status)));
    await expect(client.createDraft('RAW')).rejects.toMatchObject({ reason });
  });

  it('oublie le jeton d’accès refusé (401) et en redemande un', async () => {
    let drafts = 0;
    const client = clientWith((url) => {
      if (url.includes('oauth2')) return ok(url);
      drafts += 1;
      return drafts === 1 ? json({}, 401) : json({ id: 'draft-2' });
    });
    await expect(client.createDraft('RAW')).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(await client.createDraft('RAW')).toBe('draft-2');
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });

  it('refuse une réponse de création sans identifiant', async () => {
    const client = clientWith((url) => (url.includes('oauth2') ? ok(url) : json({ truc: 1 })));
    await expect(client.createDraft('RAW')).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('supprime un brouillon, et considère « déjà absent » (404) comme un succès', async () => {
    const client = clientWith((url) =>
      url.includes('oauth2') ? ok(url) : new Response(null, { status: 404 }),
    );
    await expect(client.deleteDraft('abc/../x')).resolves.toBeUndefined();
    // L'identifiant est encodé dans l'URL : pas de traversée de chemin.
    expect(calls.at(-1)?.url).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts/abc%2F..%2Fx',
    );
    expect(calls.at(-1)?.init?.method).toBe('DELETE');
  });

  it('traduit une panne réseau en « unavailable »', async () => {
    const env = {
      GMAIL_TOKEN_FILE: (() => {
        writeFileSync(
          join(dir, 't.json'),
          JSON.stringify({ client_id: 'a', client_secret: 'b', refresh_token: 'c' }),
        );
        return join(dir, 't.json');
      })(),
    } as Env;
    const client = new GmailClient(env, async () => {
      throw new TypeError('fetch failed');
    });
    await expect(client.createDraft('RAW')).rejects.toMatchObject({ reason: 'unavailable' });
  });

  describe('messageContent', () => {
    const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
    const message = (payload: object, extra: object = {}) => ({
      id: 'm1',
      internalDate: '1794278645000',
      payload,
      ...extra,
    });
    const serve = (body: object) =>
      clientWith((url) =>
        url.includes('oauth2') ? json({ access_token: 'a', expires_in: 3600 }) : json(body),
      );

    it('lit l’expéditeur, la signature validée par Gmail, la date et le corps texte (en UTF-8)', async () => {
      const client = serve(
        message({
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: 'Indeed <donotreply@jobalert.indeed.com>' },
            {
              name: 'Authentication-Results',
              value: 'mx.google.com; dkim=pass header.i=@indeed.com',
            },
            { name: 'Authentication-Results', value: 'mx.google.com; spf=pass' },
          ],
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: b64('Développeur full stack (H/F) – 42 000 €') },
            },
            { mimeType: 'text/html', body: { data: b64('<p>html</p>') } },
          ],
        }),
      );

      const content = await client.messageContent('m1');

      expect(content).toMatchObject({
        id: 'm1',
        from: 'Indeed <donotreply@jobalert.indeed.com>',
        text: 'Développeur full stack (H/F) – 42 000 €',
      });
      expect(content.authenticationResults).toContain('dkim=pass');
      expect(content.authenticationResults).toContain('spf=pass');
      expect(content.receivedAt).toEqual(new Date(1794278645000));
      const call = calls.find((c) => c.url.includes('/messages/m1'));
      expect(call?.url).toContain('format=full');
    });

    it('trouve le texte dans un message imbriqué, et renvoie null s’il n’y en a pas (HTML seulement)', async () => {
      const nested = serve(
        message({
          mimeType: 'multipart/mixed',
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [{ mimeType: 'text/plain', body: { data: b64('profond') } }],
            },
          ],
        }),
      );
      expect((await nested.messageContent('m1')).text).toBe('profond');

      const htmlOnly = serve(message({ mimeType: 'text/html', body: { data: b64('<p>x</p>') } }));
      expect((await htmlOnly.messageContent('m1')).text).toBeNull();
    });

    it('borne la profondeur de l’arbre MIME et la taille du corps (message malveillant)', async () => {
      let deep: object = { mimeType: 'text/plain', body: { data: b64('trop profond') } };
      for (let i = 0; i < 20; i++) deep = { mimeType: 'multipart/mixed', parts: [deep] };
      expect((await serve(message(deep)).messageContent('m1')).text).toBeNull();

      const huge = serve(
        message({ mimeType: 'text/plain', body: { data: b64('x'.repeat(900_000)) } }),
      );
      expect((await huge.messageContent('m1')).text).toHaveLength(500_000);
    });

    it('refuse une réponse mal formée, sans en divulguer le contenu', async () => {
      const client = serve({ id: 'm1', internalDate: 'pas-une-date', payload: {} });

      await expect(client.messageContent('m1')).rejects.toMatchObject({
        reason: 'unavailable',
        message: 'Réponse Gmail inattendue.',
      });
    });
  });
});
