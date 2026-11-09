import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import type { HttpFetch } from '../http-fetch';
import { type SearchQuery, SourceError } from '../source.types';
import { AdzunaConnector } from './adzuna.connector';

const APP_ID = 'app-id-secret-111';
const APP_KEY = 'app-key-secret-222';
const QUERY: SearchQuery = {
  latitude: 48.8566,
  longitude: 2.3522,
  radiusKm: 20,
  romeCodes: [],
  where: 'Paris',
  keywords: ['TypeScript', 'React'],
};

/** Annonce au format réel d'Adzuna (valeurs fictives). */
function job(overrides: Record<string, unknown> = {}) {
  return {
    id: '5489684376',
    title: 'Alternance : développeur web',
    description: 'Vous rejoignez une équipe produit…',
    created: '2026-11-10T19:47:25Z',
    redirect_url: 'https://www.adzuna.fr/details/5489684376?utm_medium=api',
    latitude: 48.87,
    longitude: 2.33,
    company: { display_name: 'Exemple Logiciels' },
    location: {
      display_name: '9ème Arrondissement, Paris',
      area: ['France', 'Ile-de-France', 'Paris', '9ème Arrondissement'],
    },
    category: { label: 'Emplois Diplômés' },
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(response: () => Response | Promise<Response>, env: Partial<Env> = {}) {
  const http = vi.fn<HttpFetch>(async () => response());
  const full = { ADZUNA_APP_ID: APP_ID, ADZUNA_APP_KEY: APP_KEY, ...env } as Env;
  return { adzuna: new AdzunaConnector(full, http), http };
}

describe('AdzunaConnector', () => {
  it('normalise une annonce : entreprise, ville, coordonnées, lien, date, canal « site »', async () => {
    const { adzuna } = setup(() => json({ count: 1, results: [job()] }));

    const { offers, skipped } = await adzuna.search(QUERY);

    expect(skipped).toBe(0);
    expect(offers).toEqual([
      {
        source: 'ADZUNA',
        externalId: '5489684376',
        title: 'Alternance : développeur web',
        company: 'Exemple Logiciels',
        city: 'Paris',
        latitude: 48.87,
        longitude: 2.33,
        description: 'Vous rejoignez une équipe produit…',
        applyUrl: 'https://www.adzuna.fr/details/5489684376?utm_medium=api',
        channel: 'SITE',
        publishedAt: new Date('2026-11-10T19:47:25Z'),
      },
    ]);
  });

  it('construit la requête : alternance + mots-clés, lieu, rayon, tri par date', async () => {
    const { adzuna, http } = setup(() => json({ results: [] }));

    await adzuna.search(QUERY);

    const called = new URL(http.mock.calls[0]?.[0] ?? '');
    expect(called.origin + called.pathname).toBe('https://api.adzuna.com/v1/api/jobs/fr/search/1');
    expect(called.searchParams.get('what')).toBe('alternance');
    expect(called.searchParams.get('what_or')).toBe('TypeScript React');
    expect(called.searchParams.get('where')).toBe('Paris');
    expect(called.searchParams.get('distance')).toBe('20');
    expect(called.searchParams.get('sort_by')).toBe('date');
    expect(called.searchParams.get('results_per_page')).toBe('50');
  });

  it('n’ajoute pas what_or sans mots-clés', async () => {
    const { adzuna, http } = setup(() => json({ results: [] }));

    await adzuna.search({ ...QUERY, keywords: [] });

    expect(new URL(http.mock.calls[0]?.[0] ?? '').searchParams.has('what_or')).toBe(false);
  });

  it('prend la ville du libellé quand la hiérarchie est incomplète, tolère les champs absents', async () => {
    const { adzuna } = setup(() =>
      json({
        results: [
          job({ id: 'a', location: { display_name: 'Lyon, Rhône', area: ['France'] } }),
          job({
            id: 'b',
            location: null,
            company: null,
            latitude: null,
            longitude: null,
            redirect_url: null,
            created: 'pas une date',
          }),
          job({ id: 'c', redirect_url: 'javascript:alert(1)' }),
        ],
      }),
    );

    const { offers } = await adzuna.search(QUERY);

    expect(offers[0]?.city).toBe('Lyon');
    expect(offers[1]).toMatchObject({ company: 'Entreprise non indiquée' });
    expect(offers[1]?.city).toBeUndefined();
    expect(offers[1]?.latitude).toBeUndefined();
    expect(offers[1]?.applyUrl).toBeUndefined();
    expect(offers[1]?.publishedAt).toBeUndefined();
    expect(offers[2]?.applyUrl).toBeUndefined();
  });

  it('accepte un identifiant numérique et borne les textes', async () => {
    const { adzuna } = setup(() =>
      json({ results: [job({ id: 42, title: 'T'.repeat(500), description: 'D'.repeat(50_000) })] }),
    );

    const { offers } = await adzuna.search(QUERY);

    expect(offers[0]?.externalId).toBe('42');
    expect(offers[0]?.title).toHaveLength(200);
    expect(offers[0]?.description).toHaveLength(10_000);
  });

  it('compte les entrées illisibles sans faire échouer le lot', async () => {
    const { adzuna } = setup(() => json({ results: [job(), { id: 'x' }, null, 'texte'] }));

    const { offers, skipped } = await adzuna.search(QUERY);

    expect(offers).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  describe('erreurs', () => {
    const failure = async (adzuna: AdzunaConnector, query = QUERY): Promise<SourceError> => {
      try {
        await adzuna.search(query);
      } catch (error) {
        return error as SourceError;
      }
      throw new Error('une erreur était attendue');
    };

    it('refuse de s’appeler sans clés (l’une ou l’autre), sans réseau', async () => {
      for (const env of [{ ADZUNA_APP_ID: undefined }, { ADZUNA_APP_KEY: undefined }]) {
        const { adzuna, http } = setup(() => json({}), env);
        expect((await failure(adzuna)).reason).toBe('not_configured');
        expect(http).not.toHaveBeenCalled();
      }
    });

    it.each([
      ['lieu absent', { ...QUERY, where: undefined }],
      ['lieu vide', { ...QUERY, where: '   ' }],
      ['rayon nul', { ...QUERY, radiusKm: 0 }],
    ])('refuse une requête invalide sans réseau (%s)', async (_name, query) => {
      const { adzuna, http } = setup(() => json({ results: [] }));

      expect((await failure(adzuna, query)).reason).toBe('invalid');
      expect(http).not.toHaveBeenCalled();
    });

    it.each([
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [429, 'rate_limited'],
      [400, 'invalid'],
      [500, 'unavailable'],
    ] as const)('traduit le statut %i en « %s »', async (status, reason) => {
      const { adzuna } = setup(() => json({}, status));

      expect((await failure(adzuna)).reason).toBe(reason);
    });

    it('signale une réponse inattendue', async () => {
      expect((await failure(setup(() => new Response('<html>')).adzuna)).reason).toBe('invalid');
      expect((await failure(setup(() => json({ autre: 1 })).adzuna)).reason).toBe('invalid');
    });

    it('ne laisse jamais la clé dans un message d’erreur : elle voyage dans l’URL', async () => {
      const cases = [
        setup(() => json({}, 401)),
        setup(() => json({}, 429)),
        setup(() => json({}, 500)),
        setup(() => {
          throw new Error(`échec vers https://api.adzuna.com/?app_key=${APP_KEY}&app_id=${APP_ID}`);
        }),
      ];
      for (const { adzuna } of cases) {
        const { message } = await failure(adzuna);
        expect(message).not.toContain(APP_KEY);
        expect(message).not.toContain(APP_ID);
      }
    });

    it('refuse les redirections', async () => {
      const { adzuna, http } = setup(() => json({ results: [] }));

      await adzuna.search(QUERY);

      expect(http.mock.calls[0]?.[1]?.redirect).toBe('error');
    });
  });
});
