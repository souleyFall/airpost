import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import type { HttpFetch } from '../http-fetch';
import { SourceError } from '../source.types';
import { LbaConnector, parseAddress } from './lba.connector';

const API_KEY = 'cle-de-test-secrete-12345';
const QUERY = { latitude: 48.8566, longitude: 2.3522, radiusKm: 20, romeCodes: ['M1805', 'M1810'] };

/** Offre au format réel de l'API (valeurs fictives). */
function job(overrides: Record<string, unknown> = {}) {
  return {
    identifier: { id: 'job-1', partner_label: 'France Travail', partner_job_id: '123' },
    workplace: {
      name: 'Exemple Logiciels',
      brand: null,
      legal_name: null,
      location: {
        address: '92000 Nanterre',
        geopoint: { type: 'Point', coordinates: [2.2069, 48.8924] },
      },
    },
    apply: { url: 'https://exemple.test/offres/1', phone: null },
    offer: {
      title: '  Alternance développeur full stack  ',
      description: 'Vous développez en TypeScript.',
      status: 'Active',
      publication: { creation: '2026-11-03T04:31:01.453Z', expiration: '2099-01-03T00:00:00.000Z' },
    },
    ...overrides,
  };
}

function connector(response: () => Response | Promise<Response>, key: string | null = API_KEY) {
  const http = vi.fn<HttpFetch>(async () => response());
  const env = { LBA_API_KEY: key ?? undefined } as Env;
  return { lba: new LbaConnector(env, http), http };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('LbaConnector', () => {
  it('normalise une offre : identifiant, entreprise, ville, coordonnées, canal « site »', async () => {
    const { lba } = connector(() => json({ jobs: [job()], recruiters: [], warnings: [] }));

    const { offers, skipped } = await lba.search(QUERY);

    expect(skipped).toBe(0);
    expect(offers).toEqual([
      {
        source: 'LBA',
        externalId: 'job-1',
        title: 'Alternance développeur full stack',
        company: 'Exemple Logiciels',
        city: 'Nanterre',
        postcode: '92000',
        // GeoJSON [longitude, latitude] → latitude, longitude.
        latitude: 48.8924,
        longitude: 2.2069,
        description: 'Vous développez en TypeScript.',
        applyUrl: 'https://exemple.test/offres/1',
        channel: 'SITE',
        publishedAt: new Date('2026-11-03T04:31:01.453Z'),
      },
    ]);
  });

  it('appelle la bonne URL avec la clé en en-tête, jamais dans l’URL', async () => {
    const { lba, http } = connector(() => json({ jobs: [] }));

    await lba.search(QUERY);

    const [url, init] = http.mock.calls[0] ?? [];
    const called = new URL(url ?? '');
    expect(called.origin + called.pathname).toBe(
      'https://api.apprentissage.beta.gouv.fr/api/job/v1/search',
    );
    expect(called.searchParams.get('latitude')).toBe('48.8566');
    expect(called.searchParams.get('radius')).toBe('20');
    // Plusieurs ROME : une virgule, pas un paramètre répété (l'API répond 400).
    expect(called.searchParams.get('romes')).toBe('M1805,M1810');
    expect(called.searchParams.getAll('romes')).toHaveLength(1);
    expect(url).not.toContain(API_KEY);
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('n’envoie pas de paramètre romes quand aucun code n’est demandé', async () => {
    const { lba, http } = connector(() => json({ jobs: [] }));

    await lba.search({ ...QUERY, romeCodes: [] });

    expect(new URL(http.mock.calls[0]?.[0] ?? '').searchParams.has('romes')).toBe(false);
  });

  it('remplace un nom d’entreprise absent par la marque, la raison sociale, puis un libellé', async () => {
    const { lba } = connector(() =>
      json({
        jobs: [
          job({
            identifier: { id: 'a' },
            workplace: { name: null, brand: 'Marque', legal_name: 'Raison' },
          }),
          job({
            identifier: { id: 'b' },
            workplace: { name: null, brand: null, legal_name: 'Raison' },
          }),
          job({
            identifier: { id: 'c' },
            workplace: { name: null, brand: null, legal_name: null },
          }),
        ],
      }),
    );

    const { offers } = await lba.search(QUERY);

    expect(offers.map((o) => o.company)).toEqual(['Marque', 'Raison', 'Entreprise non indiquée']);
  });

  it('écarte les offres expirées ou non actives', async () => {
    const { lba } = connector(() =>
      json({
        jobs: [
          job({
            identifier: { id: 'old' },
            offer: {
              title: 'Ancienne',
              status: 'Active',
              publication: { expiration: '2020-01-01T00:00:00Z' },
            },
          }),
          job({ identifier: { id: 'closed' }, offer: { title: 'Fermée', status: 'Cancelled' } }),
          job({ identifier: { id: 'ok' } }),
        ],
      }),
    );

    const { offers } = await lba.search(QUERY);

    expect(offers.map((o) => o.externalId)).toEqual(['ok']);
  });

  it('ne garde que les URL http(s) : « javascript: » est écarté', async () => {
    const { lba } = connector(() =>
      json({
        jobs: [
          job({ identifier: { id: 'x' }, apply: { url: 'javascript:alert(1)' } }),
          job({ identifier: { id: 'y' }, apply: { url: 'pas une url' } }),
          job({ identifier: { id: 'z' }, apply: null }),
        ],
      }),
    );

    const { offers } = await lba.search(QUERY);

    expect(offers).toHaveLength(3);
    expect(offers.every((o) => o.applyUrl === undefined)).toBe(true);
  });

  it('compte les entrées illisibles sans faire échouer le lot', async () => {
    const { lba } = connector(() =>
      json({ jobs: [job(), { n: 'importe quoi' }, null, { ...job(), identifier: {} }] }),
    );

    const { offers, skipped } = await lba.search(QUERY);

    expect(offers).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it('tolère les champs optionnels manquants (adresse, coordonnées, description)', async () => {
    const { lba } = connector(() =>
      json({
        jobs: [
          job({ workplace: { name: 'Sans lieu' }, offer: { title: 'Poste' } }),
          job({
            identifier: { id: 'adresse-etrangere' },
            workplace: { name: 'X', location: { address: 'Londres' } },
          }),
        ],
      }),
    );

    const { offers } = await lba.search(QUERY);

    expect(offers[0]).toMatchObject({ company: 'Sans lieu', title: 'Poste' });
    expect(offers[0]?.city).toBeUndefined();
    expect(offers[0]?.latitude).toBeUndefined();
    expect(offers[1]?.city).toBeUndefined();
  });

  describe('erreurs', () => {
    async function failure(lba: LbaConnector): Promise<SourceError> {
      try {
        await lba.search(QUERY);
      } catch (error) {
        return error as SourceError;
      }
      throw new Error('une erreur était attendue');
    }

    it('refuse de s’appeler sans clé, sans réseau', async () => {
      const { lba, http } = connector(() => json({}), null);

      const error = await failure(lba);

      expect(error).toBeInstanceOf(SourceError);
      expect(error.reason).toBe('not_configured');
      expect(http).not.toHaveBeenCalled();
    });

    it.each([
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [429, 'rate_limited'],
      [500, 'unavailable'],
    ] as const)('traduit le statut %i en « %s »', async (status, reason) => {
      const { lba } = connector(() => json({ message: 'détail du serveur' }, status));

      expect((await failure(lba)).reason).toBe(reason);
    });

    it('signale une réponse qui n’est pas du JSON attendu', async () => {
      expect((await failure(connector(() => new Response('<html>')).lba)).reason).toBe('invalid');
      expect((await failure(connector(() => json({ autre: 1 })).lba)).reason).toBe('invalid');
    });

    it('signale un réseau coupé sans recopier l’erreur d’origine', async () => {
      const { lba } = connector(() => {
        throw new Error(`connexion refusée vers https://x/?key=${API_KEY}`);
      });

      const error = await failure(lba);

      expect(error.reason).toBe('unavailable');
      expect(error.message).not.toContain(API_KEY);
    });

    it('ne laisse jamais la clé dans un message d’erreur', async () => {
      for (const status of [401, 429, 500]) {
        const { lba } = connector(() => json({}, status));
        expect((await failure(lba)).message).not.toContain(API_KEY);
      }
    });
  });
});

describe('parseAddress', () => {
  it.each([
    ['92000 Nanterre', { postcode: '92000', city: 'Nanterre' }],
    ['99 RUE DE LA VERRERIE 75004 PARIS', { postcode: '75004', city: 'PARIS' }],
    ['12 avenue Foch 69006 Lyon 6e', { postcode: '69006', city: 'Lyon 6e' }],
    ['Londres', {}],
    ['', {}],
    [null, {}],
  ])('lit « %s »', (address, expected) => {
    expect(parseAddress(address)).toEqual(expected);
  });
});
