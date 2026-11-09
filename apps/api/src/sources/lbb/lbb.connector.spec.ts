import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import type { HttpFetch } from '../http-fetch';
import { SourceError } from '../source.types';
import { LbbConnector } from './lbb.connector';

const CLIENT_ID = 'id-client-secret-111';
const CLIENT_SECRET = 'secret-client-222';
const ACCESS_TOKEN = 'jeton-acces-333';
const QUERY = { latitude: 48.8566, longitude: 2.3522, radiusKm: 20, romeCodes: ['M1805'] };

/** Entreprise au format réel de l'API (valeurs fictives). */
function company(overrides: Record<string, unknown> = {}) {
  return {
    rome: 'M1805',
    id: 1,
    siret: '12345678900012',
    email: 'yes',
    company_name: 'EXEMPLE LOGICIELS SAS',
    office_name: '',
    headcount_min: 200,
    headcount_max: 249,
    naf: '6203Z',
    naf_label: "Gestion d'installations informatiques",
    location: { lat: 48.78, lon: 2.19 },
    city: 'Vélizy-Villacoublay',
    postcode: '78140',
    hiring_potential: 4.5,
    is_high_potential: true,
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function setup(
  search: Handler,
  token: Handler = () => json({ access_token: ACCESS_TOKEN, expires_in: 1499 }),
) {
  const http = vi.fn<HttpFetch>(async (url, init) =>
    url.includes('/access_token') ? token(url, init) : search(url, init),
  );
  const env = { FT_CLIENT_ID: CLIENT_ID, FT_CLIENT_SECRET: CLIENT_SECRET } as Env;
  return { lbb: new LbbConnector(env, http), http };
}

describe('LbbConnector', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('normalise une entreprise : candidature spontanée, fiche La Bonne Boîte, canal « site »', async () => {
    const { lbb } = setup(() => json({ hits: 1, items: [company()] }));

    const { offers, skipped } = await lbb.search(QUERY);

    expect(skipped).toBe(0);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      source: 'LBB',
      externalId: '12345678900012',
      title: "Candidature spontanée : Gestion d'installations informatiques",
      company: 'EXEMPLE LOGICIELS SAS',
      city: 'Vélizy-Villacoublay',
      postcode: '78140',
      latitude: 48.78,
      longitude: 2.19,
      applyUrl: 'https://labonneboite.francetravail.fr/entreprise/12345678900012',
      channel: 'SITE',
    });
    expect(offers[0]?.description).toContain('Effectif : 200 à 249');
    expect(offers[0]?.description).toContain('candidature spontanée');
    // « email: yes » n'est pas une adresse : aucun contact n'est enregistré.
    expect(offers[0]?.contactEmail).toBeUndefined();
  });

  it('demande un jeton OAuth2 avec le bon scope, puis l’envoie en en-tête', async () => {
    const { lbb, http } = setup(() => json({ items: [] }));

    await lbb.search(QUERY);

    const [tokenUrl, tokenInit] = http.mock.calls[0] ?? [];
    expect(tokenUrl).toContain('/connexion/oauth2/access_token?realm=/partenaire');
    expect(tokenInit?.method).toBe('POST');
    const form = tokenInit?.body as URLSearchParams;
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('api_labonneboitev2 search');
    const [searchUrl, searchInit] = http.mock.calls[1] ?? [];
    expect((searchInit?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${ACCESS_TOKEN}`,
    );
    const called = new URL(searchUrl ?? '');
    expect(called.searchParams.get('rome')).toBe('M1805');
    expect(called.searchParams.get('distance')).toBe('20');
    expect(called.searchParams.get('page_size')).toBe('100');
    // Les secrets ne voyagent ni dans l'URL de recherche ni dans celle du jeton.
    for (const url of [searchUrl, tokenUrl]) {
      expect(url).not.toContain(CLIENT_SECRET);
      expect(url).not.toContain(ACCESS_TOKEN);
    }
  });

  it('réutilise le jeton tant qu’il est valide, en redemande un après l’expiration', async () => {
    const { lbb, http } = setup(() => json({ items: [] }));
    const tokenCalls = () => http.mock.calls.filter(([u]) => u.includes('/access_token')).length;

    await lbb.search(QUERY);
    await lbb.search(QUERY);
    expect(tokenCalls()).toBe(1);

    vi.setSystemTime(Date.now() + 1500 * 1000);
    await lbb.search(QUERY);
    expect(tokenCalls()).toBe(2);
  });

  it('ne demande qu’un jeton quand deux recherches se croisent', async () => {
    const { lbb, http } = setup(() => json({ items: [] }));

    await Promise.all([lbb.search(QUERY), lbb.search(QUERY)]);

    expect(http.mock.calls.filter(([u]) => u.includes('/access_token'))).toHaveLength(1);
  });

  it('fait un appel par code ROME et fusionne les entreprises par SIRET', async () => {
    const { lbb, http } = setup((url) => {
      const rome = new URL(url).searchParams.get('rome');
      return json({
        items: [
          company({ siret: '11111111100011' }),
          rome === 'M1810'
            ? company({ siret: '22222222200022' })
            : company({ siret: '11111111100011' }),
        ],
      });
    });

    const { offers } = await lbb.search({ ...QUERY, romeCodes: ['M1805', 'M1810'] });

    expect(http.mock.calls.filter(([u]) => u.includes('/recherche'))).toHaveLength(2);
    expect(offers.map((o) => o.externalId).sort()).toEqual(['11111111100011', '22222222200022']);
  });

  it('compte les entrées illisibles (SIRET invalide) sans faire échouer le lot', async () => {
    const { lbb } = setup(() =>
      json({ items: [company(), company({ siret: 'pas-un-siret' }), { n: 1 }, null] }),
    );

    const { offers, skipped } = await lbb.search(QUERY);

    expect(offers).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it('borne les textes, repli sur « Entreprise non indiquée », tolère les champs absents', async () => {
    const { lbb } = setup(() =>
      json({
        items: [
          company({ siret: '11111111100011', company_name: 'E'.repeat(500) }),
          company({
            siret: '22222222200022',
            company_name: null,
            office_name: null,
            naf_label: null,
            location: null,
          }),
        ],
      }),
    );

    const { offers } = await lbb.search(QUERY);

    expect(offers[0]?.company).toHaveLength(200);
    expect(offers[1]).toMatchObject({ company: 'Entreprise non indiquée' });
    expect(offers[1]?.latitude).toBeUndefined();
  });

  describe('erreurs', () => {
    const failure = async (lbb: LbbConnector, query = QUERY): Promise<SourceError> => {
      try {
        await lbb.search(query);
      } catch (error) {
        return error as SourceError;
      }
      throw new Error('une erreur était attendue');
    };

    it('refuse de s’appeler sans identifiants, sans réseau', async () => {
      const http = vi.fn<HttpFetch>();
      const lbb = new LbbConnector({} as Env, http);

      expect((await failure(lbb)).reason).toBe('not_configured');
      expect(http).not.toHaveBeenCalled();
    });

    it.each([
      ['latitude NaN', { ...QUERY, latitude: Number.NaN }],
      ['rayon nul', { ...QUERY, radiusKm: 0 }],
      ['aucun code ROME', { ...QUERY, romeCodes: [] }],
    ])('refuse une requête invalide sans réseau (%s)', async (_name, query) => {
      const { lbb, http } = setup(() => json({ items: [] }));

      expect((await failure(lbb, query)).reason).toBe('invalid');
      expect(http).not.toHaveBeenCalled();
    });

    it.each([
      [401, 'unauthorized'],
      [429, 'rate_limited'],
      [422, 'invalid'],
      [500, 'unavailable'],
    ] as const)('traduit le statut %i de la recherche en « %s »', async (status, reason) => {
      const { lbb } = setup(() => json({}, status));

      expect((await failure(lbb)).reason).toBe(reason);
    });

    it('traduit un refus d’authentification, et oublie le jeton après un 401 de la recherche', async () => {
      const denied = setup(
        () => json({}),
        () => json({}, 401),
      );
      expect((await failure(denied.lbb)).reason).toBe('unauthorized');

      let calls = 0;
      const { lbb, http } = setup(() => (calls++ === 0 ? json({}, 401) : json({ items: [] })));
      await failure(lbb);
      await lbb.search(QUERY);
      expect(http.mock.calls.filter(([u]) => u.includes('/access_token'))).toHaveLength(2);
    });

    it('signale des réponses mal formées', async () => {
      expect((await failure(setup(() => json({ autre: 1 })).lbb)).reason).toBe('invalid');
      expect(
        (
          await failure(
            setup(
              () => json({ items: [] }),
              () => json({ nope: 1 }),
            ).lbb,
          )
        ).reason,
      ).toBe('invalid');
    });

    it('ne laisse jamais un secret dans un message d’erreur, réseau coupé compris', async () => {
      const secrets = [CLIENT_ID, CLIENT_SECRET, ACCESS_TOKEN];
      const cases = [
        setup(() => json({}, 401)),
        setup(() => json({}, 429)),
        setup(() => json({}, 500)),
        setup(
          () => json({}),
          () => json({}, 401),
        ),
        setup(() => {
          throw new Error(`échec vers ${CLIENT_SECRET} ${ACCESS_TOKEN}`);
        }),
      ];
      for (const { lbb } of cases) {
        const { message } = await failure(lbb);
        for (const secret of secrets) {
          expect(message).not.toContain(secret);
        }
      }
    });

    it('refuse les redirections', async () => {
      const { lbb, http } = setup(() => json({ items: [] }));

      await lbb.search(QUERY);

      expect(http.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
    });
  });
});
