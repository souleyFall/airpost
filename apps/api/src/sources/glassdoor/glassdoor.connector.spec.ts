import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import type { HttpFetch } from '../../http/http-fetch';
import type { GeocoderService } from '../geocoder.service';
import { type SearchQuery, SourceError } from '../source.types';
import {
  GlassdoorConnector,
  buildQueries,
  normalizeGlassdoorJob,
  radiusFor,
} from './glassdoor.connector';

const KEY = 'cle-serpapi-secrete';
const NOW = new Date('2026-11-10T12:00:00Z');

const QUERY: SearchQuery = {
  latitude: 48.78,
  longitude: 2.03,
  radiusKm: 37,
  romeCodes: ['M1805'],
  where: 'Montigny-le-Bretonneux',
  keywords: ['TypeScript', 'React'],
  contracts: ['ALTERNANCE'],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Annonce anonymisée, au format de Glassdoor via SerpApi. */
function job(overrides: Record<string, unknown> = {}) {
  return {
    job_id: 'gd-1',
    title: 'Alternance développeur web',
    company_name: 'Atelier Exemple',
    location: 'Paris',
    link: 'https://exemple.test/glassdoor/gd-1',
    days_since_posted: 3,
    easy_apply: false,
    snippet: 'Vous rejoignez une équipe produit en alternance.',
    skills: ['TypeScript', 'React'],
    ...overrides,
  };
}

const page = (jobs: unknown[], next?: string) => ({
  jobs_results: jobs,
  serpapi_pagination: next ? { current: 1, next_page_token: next } : { current: 1 },
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
  const full = { SERPAPI_KEY: KEY, GLASSDOOR_MAX_SEARCHES: 4, ...env } as Env;
  const connector = new GlassdoorConnector(full, http, {
    geocodeCity,
  } as unknown as GeocoderService);
  return { connector, http, geocodeCity };
}

describe('radiusFor', () => {
  it.each([
    [1, '5'],
    [5, '5'],
    [6, '10'],
    [25, '25'],
    [37, '50'],
    [50, '50'],
    [90, '100'],
    [500, '100'],
  ])('%i km → rayon Glassdoor %s', (km, expected) => {
    expect(radiusFor(km)).toBe(expected);
  });
});

describe('buildQueries', () => {
  it('une requête par contrat, sans les mots-clés (Glassdoor les rend obligatoires)', () => {
    expect(buildQueries({ ...QUERY, contracts: ['ALTERNANCE', 'STAGE'] })).toEqual([
      'alternance développeur',
      'stage développeur',
    ]);
  });

  it('alternance par défaut, sans doublon', () => {
    expect(buildQueries({ ...QUERY, contracts: undefined })).toEqual(['alternance développeur']);
    expect(buildQueries({ ...QUERY, contracts: ['STAGE', 'STAGE'] })).toEqual([
      'stage développeur',
    ]);
  });
});

describe('normalizeGlassdoorJob', () => {
  const parsed = () => normalizeGlassdoorJob(job(), NOW);

  it('normalise une annonce : entreprise, ville, extrait et compétences, lien, âge, canal « site »', () => {
    expect(parsed()).toEqual({
      source: 'GLASSDOOR',
      externalId: 'gd-1',
      title: 'Alternance développeur web',
      company: 'Atelier Exemple',
      city: 'Paris',
      description:
        'Vous rejoignez une équipe produit en alternance.\n\nCompétences : TypeScript, React',
      applyUrl: 'https://exemple.test/glassdoor/gd-1',
      channel: 'SITE',
      publishedAt: new Date('2026-11-07T12:00:00Z'),
    });
  });

  it('ne garde jamais un lien javascript:', () => {
    expect(
      normalizeGlassdoorJob(job({ link: 'javascript:alert(1)' }) as never, NOW).applyUrl,
    ).toBeUndefined();
  });

  it('tolère les champs absents et un âge incohérent', () => {
    const offer = normalizeGlassdoorJob({ job_id: 'x', title: 'Dev', days_since_posted: -4 }, NOW);
    expect(offer).toMatchObject({ company: 'Entreprise non indiquée', channel: 'SITE' });
    expect(offer.publishedAt).toBeUndefined();
    expect(offer.description).toBeUndefined();
    expect(offer.city).toBeUndefined();
  });

  it('un âge de zéro jour = publiée aujourd’hui', () => {
    expect(normalizeGlassdoorJob(job({ days_since_posted: 0 }) as never, NOW).publishedAt).toEqual(
      NOW,
    );
  });
});

describe('GlassdoorConnector', () => {
  it('construit la requête : moteur, contrat, lieu, France, rayon admis, 14 jours, clé', async () => {
    const { connector, http } = setup(() => json(page([])));

    await connector.search(QUERY, NOW);

    const called = new URL(http.mock.calls[0]?.[0] ?? '');
    expect(called.origin + called.pathname).toBe('https://serpapi.com/search.json');
    expect(called.searchParams.get('engine')).toBe('glassdoor_jobs');
    expect(called.searchParams.get('q')).toBe('alternance développeur');
    expect(called.searchParams.get('location')).toBe('Montigny-le-Bretonneux, France');
    expect(called.searchParams.get('radius')).toBe('50');
    expect(called.searchParams.get('date_posted')).toBe('14');
    expect(called.searchParams.get('api_key')).toBe(KEY);
    expect(http.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('normalise les annonces et ajoute les coordonnées des villes (une recherche par ville)', async () => {
    const { connector, geocodeCity } = setup(() =>
      json(
        page([
          job(),
          job({ job_id: 'gd-2', location: 'Paris' }),
          job({ job_id: 'gd-3', location: 'Vélizy-Villacoublay' }),
          job({ job_id: 'gd-4', location: 'France' }),
        ]),
      ),
    );

    const { offers, skipped } = await connector.search(QUERY, NOW);

    expect(skipped).toBe(0);
    expect(offers).toHaveLength(4);
    expect(offers[0]).toMatchObject({ latitude: 48.86, longitude: 2.35 });
    expect(offers[3]?.latitude).toBeUndefined();
    expect(geocodeCity.mock.calls.map((c) => c[0])).toEqual(['Paris', 'Vélizy-Villacoublay']);
    expect(geocodeCity.mock.calls[0]?.[1]).toEqual({ latitude: 48.78, longitude: 2.03 });
  });

  it('suit les pages (jeton) et respecte le plafond de recherches, même s’il reste des pages', async () => {
    const { connector, http } = setup(
      (_url, call) => json(page([job({ job_id: `j${call}` })], `jeton-${call}`)),
      { GLASSDOOR_MAX_SEARCHES: 3 },
    );

    const { offers } = await connector.search(QUERY, NOW);

    expect(http).toHaveBeenCalledTimes(3);
    expect(offers).toHaveLength(3);
    const second = new URL(http.mock.calls[1]?.[0] ?? '');
    expect(second.searchParams.get('next_page_token')).toBe('jeton-0');
    expect(second.searchParams.get('q')).toBe('alternance développeur');
  });

  it('accepte un identifiant numérique, converti en texte', async () => {
    const { connector } = setup(() => json(page([job({ job_id: 1234567 })])));

    const { offers } = await connector.search(QUERY, NOW);

    expect(offers[0]?.externalId).toBe('1234567');
  });

  it('une recherche par contrat, la page 1 de chacune d’abord', async () => {
    const { connector, http } = setup((url) =>
      url.searchParams.get('next_page_token')
        ? json(page([]))
        : json(page([job({ job_id: url.searchParams.get('q') })], 'suite')),
    );

    await connector.search({ ...QUERY, contracts: ['ALTERNANCE', 'STAGE'] }, NOW);

    const queries = http.mock.calls.map((c) => new URL(c[0]).searchParams.get('q'));
    expect(queries).toEqual([
      'alternance développeur',
      'stage développeur',
      'alternance développeur',
      'stage développeur',
    ]);
  });

  it('compte les entrées illisibles sans faire échouer le lot, et une annonce vue deux fois une seule fois', async () => {
    const { connector } = setup(() =>
      json(page([job(), job(), { job_id: 'x' }, null, 'texte', { title: 1 }])),
    );

    const { offers, skipped } = await connector.search(QUERY, NOW);

    expect(offers).toHaveLength(1);
    expect(skipped).toBe(4 * 1);
  });

  describe('quota et erreurs', () => {
    const failure = async (connector: GlassdoorConnector, query = QUERY): Promise<SourceError> => {
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

    it('signale « quota atteint » dès la première recherche', async () => {
      const { connector } = setup(() => json({}, 429));
      expect((await failure(connector)).reason).toBe('rate_limited');
    });

    it('« aucun résultat » n’est pas une panne', async () => {
      const { connector } = setup(() =>
        json({ error: "Glassdoor hasn't returned any results for this query." }),
      );
      expect(await connector.search(QUERY, NOW)).toEqual({ offers: [], skipped: 0 });
    });

    it('traduit les erreurs d’une réponse 200 : clé invalide, plus de recherches', async () => {
      const invalid = setup(() => json({ error: 'Invalid API key.' }));
      expect((await failure(invalid.connector)).reason).toBe('unauthorized');
      const quota = setup(() => json({ error: "You've run out of searches." }));
      expect((await failure(quota.connector)).reason).toBe('rate_limited');
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
      expect(error.message).toBe('Glassdoor : service injoignable (réseau).');
      expect(error.message).not.toContain(KEY);

      for (const status of [401, 429, 500, 422]) {
        const { connector } = setup(() => json({}, status));
        const e = await failure(connector);
        expect(e.message).not.toContain(KEY);
        expect(e.message).toContain('Glassdoor');
      }
      const body = setup(() => json({ error: `Boum https://serpapi.com/x?api_key=${KEY} ${KEY}` }));
      const withBody = await failure(body.connector);
      expect(withBody.message).not.toContain(KEY);
      expect(withBody.message).not.toContain('serpapi.com');
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
      expect(http).not.toHaveBeenCalled();
    });
  });
});
