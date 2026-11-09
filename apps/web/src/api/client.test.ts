import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setCsrfToken } from './client';

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(async () =>
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body ?? {}), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

function lastInit(fn: ReturnType<typeof mockFetch>) {
  const call = fn.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { url: call[0], init: call[1], headers: call[1].headers as Record<string, string> };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('client API', () => {
  it('envoie le jeton CSRF sur les requêtes qui modifient, pas sur les lectures', async () => {
    const fn = mockFetch(200, { ok: true });
    setCsrfToken('jeton-abc');
    await api('GET', '/offers');
    expect(lastInit(fn).headers['X-CSRF-Token']).toBeUndefined();
    await api('POST', '/collection/run');
    expect(lastInit(fn).headers['X-CSRF-Token']).toBe('jeton-abc');
  });

  it('préfixe /api, envoie du JSON et le cookie de même origine', async () => {
    const fn = mockFetch(200, {});
    await api('POST', '/auth/login', { login: 'a', password: 'b' });
    const { url, init, headers } = lastInit(fn);
    expect(url).toBe('/api/auth/login');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBe('{"login":"a","password":"b"}');
  });

  it('transforme une erreur HTTP en ApiError avec le message de l’API', async () => {
    mockFetch(401, { message: 'Connexion requise' });
    await expect(api('GET', '/auth/me')).rejects.toMatchObject({
      status: 401,
      message: 'Connexion requise',
    });
    await expect(api('GET', '/auth/me')).rejects.toBeInstanceOf(ApiError);
  });

  it('reste neutre si la réponse d’erreur n’est pas du JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>boom</html>', { status: 502 })),
    );
    await expect(api('GET', '/x')).rejects.toMatchObject({ status: 502, message: 'Erreur 502' });
  });

  it('gère une réponse 204 sans corps', async () => {
    mockFetch(204);
    await expect(api('POST', '/auth/logout')).resolves.toBeUndefined();
  });
});
