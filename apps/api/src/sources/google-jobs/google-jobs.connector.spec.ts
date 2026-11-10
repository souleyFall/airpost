import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import type { HttpFetch } from '../../http/http-fetch';
import type { GeocoderService } from '../geocoder.service';
import { type SearchQuery, SourceError } from '../source.types';
import {
  GoogleJobsConnector,
  buildQueries,
  cityOf,
  isGeocodable,
  normalizeGoogleJob,
  parsePostedAt,
} from './google-jobs.connector';

const KEY = 'cle-serpapi-secrete';
const NOW = new Date('2026-11-10T12:00:00Z');

const QUERY: SearchQuery = {
  latitude: 48.78,
  longitude: 2.03,
  radiusKm: 30,
  romeCodes: ['M1805'],
  where: 'Élancourt',
  keywords: ['TypeScript', 'React', 'Node.js'],
  contracts: ['ALTERNANCE'],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Annonce anonymisée, au format de SerpApi. */
function job(overrides: Record<string, unknown> = {}) {
  return {
    job_id: 'job-1',
    title: 'Alternance développeur web',
    company_name: 'Atelier Exemple',
    location: 'Paris, Île-de-France, France',
    via: 'via LinkedIn',
    description: 'Vous rejoignez une équipe produit.',
    detected_extensions: { posted_at: 'Il y a 3 jours', schedule_type: 'Temps plein' },
    apply_options: [{ title: 'LinkedIn', link: 'https://exemple.test/offre/1' }],
    share_link: 'https://share.exemple.test/1',
    job_highlights: [{ title: 'Qualifications', items: ['TypeScript', 'React'] }],
    ...overrides,
  };
}

const page = (jobs: unknown[], next?: string) => ({
  jobs_results: jobs,
  serpapi_pagination: next ? { next_page_token: next } : undefined,
});

function setup(
  respond: (url: URL, call: number) => Response | Promise<Response>,
  env: Partial<Env> = {},
  geocode: (name: string) => { latitude: number; longitude: number } | null = () => ({
    latitude: 48.86,
    longitude: 2.35,
  }),
) {
  let call = 0;
  const http = vi.fn<HttpFetch>(async (url) => respond(new URL(url), call++));
  const geocodeCity = vi.fn(async (name: string, _near?: { latitude: number; longitude: number }) =>
    geocode(name),
  );
  const full = { SERPAPI_KEY: KEY, SERPAPI_MAX_SEARCHES: 6, ...env } as Env;
  const connector = new GoogleJobsConnector(full, http, {
    geocodeCity,
  } as unknown as GeocoderService);
  return { connector, http, geocodeCity };
}

describe('parsePostedAt', () => {
  it.each([
    ['Il y a 3 jours', new Date('2026-11-07T12:00:00Z')],
    ['il y a 1 jour', new Date('2026-11-09T12:00:00Z')],
    ['Il y a 8 heures', new Date('2026-11-10T04:00:00Z')],
    ['il y a 2 semaines', new Date('2026-10-27T12:00:00Z')],
    ['Il y a 1 mois', new Date('2026-10-11T12:00:00Z')],
    ['Il y a 30+ jours', new Date('2026-10-11T12:00:00Z')],
    ['3 days ago', new Date('2026-11-07T12:00:00Z')],
    ['Aujourd’hui', NOW],
  ])('« %s »', (text, expected) => {
    expect(parsePostedAt(text, NOW)).toEqual(expected);
  });

  it.each([undefined, null, '', 'bientôt', 'il y a longtemps'])('« %s » : inconnue', (text) => {
    expect(parsePostedAt(text, NOW)).toBeUndefined();
  });
});

describe('cityOf et isGeocodable', () => {
  it('prend le premier segment du lieu', () => {
    expect(cityOf('Paris, Île-de-France, France')).toBe('Paris');
    expect(cityOf('Élancourt')).toBe('Élancourt');
    expect(cityOf(undefined)).toBeUndefined();
    expect(cityOf('')).toBeUndefined();
  });

  it('ne géocode ni un pays, ni une région, ni « Anywhere »', () => {
    for (const place of ['France', 'Île-de-France', 'Bretagne', 'Anywhere', 'Télétravail']) {
      expect(isGeocodable(place)).toBe(false);
    }
    expect(isGeocodable('Paris')).toBe(true);
    expect(isGeocodable(undefined)).toBe(false);
  });
});

describe('buildQueries', () => {
  it('une requête par contrat, avec deux mots-clés au plus', () => {
    expect(buildQueries({ ...QUERY, contracts: ['ALTERNANCE', 'STAGE'] })).toEqual([
      'alternance développeur TypeScript React',
      'stage développeur TypeScript React',
    ]);
  });

  it('alternance par défaut, sans mot-clé, et sans doublon', () => {
    expect(buildQueries({ ...QUERY, contracts: undefined, keywords: [] })).toEqual([
      'alternance développeur',
    ]);
    expect(buildQueries({ ...QUERY, contracts: ['STAGE', 'STAGE'] })).toHaveLength(1);
  });
});

describe('normalizeGoogleJob', () => {
  const parsed = () => normalizeGoogleJob(job(), NOW);

  it('normalise une annonce : entreprise, ville, plateforme d’origine, lien, date, canal « site »', () => {
    expect(parsed()).toEqual({
      source: 'GOOGLE_JOBS',
      externalId: 'job-1',
      title: 'Alternance développeur web',
      company: 'Atelier Exemple',
      city: 'Paris',
      description: 'Vous rejoignez une équipe produit.\n\nQualifications\nTypeScript\nReact',
      applyUrl: 'https://exemple.test/offre/1',
      channel: 'SITE',
      via: 'LinkedIn',
      publishedAt: new Date('2026-11-07T12:00:00Z'),
    });
  });

  it('prend le lien de partage quand aucune option de candidature n’est sûre', () => {
    const offer = normalizeGoogleJob(
      job({ apply_options: [{ link: 'javascript:alert(1)' }, { link: null }] }),
      NOW,
    );
    expect(offer.applyUrl).toBe('https://share.exemple.test/1');
  });

  it('ne garde jamais un lien javascript: ni un lien absent', () => {
    const offer = normalizeGoogleJob(
      job({
        apply_options: [{ link: 'javascript:alert(1)' }],
        share_link: 'data:text/html,x',
      }),
      NOW,
    );
    expect(offer.applyUrl).toBeUndefined();
  });

  it('tolère les champs absents', () => {
    const offer = normalizeGoogleJob({ job_id: 'x', title: 'Dev' }, NOW);
    expect(offer).toMatchObject({ company: 'Entreprise non indiquée', channel: 'SITE' });
    expect(offer.city).toBeUndefined();
    expect(offer.via).toBeUndefined();
    expect(offer.publishedAt).toBeUndefined();
  });
});

describe('GoogleJobsConnector', () => {
  it('construit la requête : moteur, mots-clés et contrat, lieu, France, français, rayon, clé', async () => {
    const { connector, http } = setup(() => json(page([])));

    await connector.search(QUERY, NOW);

    const called = new URL(http.mock.calls[0]?.[0] ?? '');
    expect(called.origin + called.pathname).toBe('https://serpapi.com/search.json');
    expect(called.searchParams.get('engine')).toBe('google_jobs');
    expect(called.searchParams.get('q')).toBe('alternance développeur TypeScript React');
    expect(called.searchParams.get('location')).toBe('Élancourt, France');
    expect(called.searchParams.get('gl')).toBe('fr');
    expect(called.searchParams.get('hl')).toBe('fr');
    expect(called.searchParams.get('lrad')).toBe('30');
    expect(called.searchParams.get('api_key')).toBe(KEY);
    expect(http.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('normalise les annonces et ajoute les coordonnées de la ville (une seule recherche par ville)', async () => {
    const { connector, geocodeCity } = setup(() =>
      json(
        page([
          job(),
          job({ job_id: 'job-2', location: 'Paris, France' }),
          job({ job_id: 'job-3', location: 'Versailles, Île-de-France, France' }),
          job({ job_id: 'job-4', location: 'France' }),
        ]),
      ),
    );

    const { offers, skipped } = await connector.search(QUERY, NOW);

    expect(skipped).toBe(0);
    expect(offers).toHaveLength(4);
    expect(offers[0]).toMatchObject({ latitude: 48.86, longitude: 2.35 });
    // « France » n'est pas une commune : pas de coordonnées.
    expect(offers[3]?.latitude).toBeUndefined();
    expect(geocodeCity.mock.calls.map((c) => c[0])).toEqual(['Paris', 'Versailles']);
    // La commune la plus proche du domicile départage les homonymes.
    expect(geocodeCity.mock.calls[0]?.[1]).toEqual({ latitude: 48.78, longitude: 2.03 });
  });

  it('laisse l’offre sans coordonnées quand la ville est introuvable', async () => {
    const { connector } = setup(
      () => json(page([job()])),
      {},
      () => null,
    );

    const { offers } = await connector.search(QUERY, NOW);

    expect(offers[0]?.latitude).toBeUndefined();
  });

  it('une requête par contrat, la page 1 de chacune d’abord, puis la page 2 (jeton de page suivante)', async () => {
    const { connector, http } = setup((url) => {
      const q = url.searchParams.get('q') ?? '';
      const token = url.searchParams.get('next_page_token');
      if (!token) return json(page([job({ job_id: `${q}-p1` })], `jeton-${q}`));
      return json(page([job({ job_id: `${q}-p2` })]));
    });

    const { offers } = await connector.search(
      { ...QUERY, contracts: ['ALTERNANCE', 'STAGE'] },
      NOW,
    );

    const calls = http.mock.calls.map((c) => {
      const u = new URL(c[0]);
      return `${u.searchParams.get('q')?.split(' ')[0]}:${u.searchParams.get('next_page_token') ?? 'p1'}`;
    });
    expect(calls).toEqual([
      'alternance:p1',
      'stage:p1',
      'alternance:jeton-alternance développeur TypeScript React',
      'stage:jeton-stage développeur TypeScript React',
    ]);
    expect(offers).toHaveLength(4);
  });

  it('s’arrête au plafond de recherches par collecte, même s’il reste des pages', async () => {
    const { connector, http } = setup(
      (_url, call) => json(page([job({ job_id: `j${call}` })], 'encore')),
      {
        SERPAPI_MAX_SEARCHES: 3,
      },
    );

    const { offers } = await connector.search(QUERY, NOW);

    expect(http).toHaveBeenCalledTimes(3);
    expect(offers).toHaveLength(3);
  });

  it('ne compte qu’une annonce vue dans deux requêtes', async () => {
    const { connector } = setup(() => json(page([job()])));

    const { offers } = await connector.search(
      { ...QUERY, contracts: ['ALTERNANCE', 'STAGE'] },
      NOW,
    );

    expect(offers).toHaveLength(1);
  });

  it('compte les entrées illisibles sans faire échouer le lot', async () => {
    const { connector } = setup(() =>
      json(page([job(), { job_id: 'x' }, null, 'texte', { title: 1 }])),
    );

    const { offers, skipped } = await connector.search(QUERY, NOW);

    expect(offers).toHaveLength(1);
    expect(skipped).toBe(4);
  });

  describe('quota et erreurs', () => {
    const failure = async (connector: GoogleJobsConnector, query = QUERY): Promise<SourceError> => {
      try {
        await connector.search(query, NOW);
      } catch (error) {
        return error as SourceError;
      }
      throw new Error('une erreur était attendue');
    };

    it('garde ce qui a été lu quand le quota est atteint en route', async () => {
      const { connector, http } = setup((_url, call) =>
        call === 0 ? json(page([job()], 'suite')) : json({}, 429),
      );

      const { offers } = await connector.search(QUERY, NOW);

      expect(offers).toHaveLength(1);
      expect(http).toHaveBeenCalledTimes(2);
    });

    it('signale « quota atteint » dès la première recherche (429), sans réessayer', async () => {
      const { connector, http } = setup(() => json({}, 429));

      expect((await failure(connector)).reason).toBe('rate_limited');
      expect(http).toHaveBeenCalledTimes(1);
    });

    it('traduit les erreurs d’une réponse 200 : clé invalide, plus de recherches', async () => {
      const invalid = setup(() => json({ error: 'Invalid API key. Your API key should be here.' }));
      expect((await failure(invalid.connector)).reason).toBe('unauthorized');
      const quota = setup(() => json({ error: "You've run out of searches." }));
      expect((await failure(quota.connector)).reason).toBe('rate_limited');
      const other = setup(() => json({ error: 'Quelque chose a mal tourné.' }));
      expect((await failure(other.connector)).reason).toBe('unavailable');
    });

    it('« aucun résultat » n’est pas une panne', async () => {
      const { connector } = setup(() =>
        json({ error: "Google hasn't returned any results for this query." }),
      );

      expect(await connector.search(QUERY, NOW)).toEqual({ offers: [], skipped: 0 });
    });

    it.each([
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [500, 'unavailable'],
    ])('statut HTTP %i → %s', async (status, reason) => {
      const { connector } = setup(() => json({}, status));
      expect((await failure(connector)).reason).toBe(reason);
    });

    it('réponse illisible ou de mauvaise forme : « invalide »', async () => {
      expect((await failure(setup(() => new Response('<html>')).connector)).reason).toBe('invalid');
      expect((await failure(setup(() => json({ jobs_results: 'non' })).connector)).reason).toBe(
        'invalid',
      );
    });

    it('ne divulgue jamais la clé : ni dans un message d’erreur, ni quand le réseau coupe', async () => {
      const down = setup(() => {
        throw new Error(`réseau coupé : https://serpapi.com/search.json?api_key=${KEY}`);
      });
      const error = await failure(down.connector);
      expect(error.reason).toBe('unavailable');
      expect(error.message).not.toContain(KEY);
      expect(error.message).not.toContain('serpapi.com');

      for (const status of [401, 429, 500, 422]) {
        const { connector } = setup(() => json({}, status));
        expect((await failure(connector)).message).not.toContain(KEY);
      }
      const errorBody = setup(() => json({ error: `Invalid API key ${KEY}` }));
      expect((await failure(errorBody.connector)).message).not.toContain(KEY);
    });

    it('refuse de s’appeler sans clé, sans réseau', async () => {
      const { connector, http } = setup(() => json(page([])), { SERPAPI_KEY: undefined });

      expect((await failure(connector)).reason).toBe('not_configured');
      expect(http).not.toHaveBeenCalled();
    });

    it('refuse un lieu ou un rayon invalide, sans réseau', async () => {
      const { connector, http } = setup(() => json(page([])));

      expect((await failure(connector, { ...QUERY, where: '  ' })).reason).toBe('invalid');
      expect((await failure(connector, { ...QUERY, radiusKm: Number.NaN })).reason).toBe('invalid');
      expect((await failure(connector, { ...QUERY, where: undefined })).reason).toBe('invalid');
      expect(http).not.toHaveBeenCalled();
    });
  });
});
