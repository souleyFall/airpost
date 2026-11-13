import { describe, expect, it, vi } from 'vitest';
import type { HttpFetch } from '../http/http-fetch';
import { GeocoderService } from './geocoder.service';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const FOUND = { features: [{ geometry: { type: 'Point', coordinates: [2.381844, 48.860162] } }] };

function setup(response: () => Response | Promise<Response>) {
  const http = vi.fn<HttpFetch>(async () => response());
  return { geocoder: new GeocoderService(http), http };
}

describe('GeocoderService', () => {
  it('convertit un code postal en latitude et longitude (GeoJSON : longitude d’abord)', async () => {
    const { geocoder, http } = setup(() => json(FOUND));

    expect(await geocoder.geocodePostcode('75011')).toEqual({
      latitude: 48.860162,
      longitude: 2.381844,
    });

    const called = new URL(http.mock.calls[0]?.[0] ?? '');
    expect(called.origin + called.pathname).toBe('https://data.geopf.fr/geocodage/search');
    expect(called.searchParams.get('q')).toBe('75011');
    expect(called.searchParams.get('type')).toBe('municipality');
    expect(http.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('garde le résultat en mémoire : un seul appel par code postal', async () => {
    const { geocoder, http } = setup(() => json(FOUND));

    await geocoder.geocodePostcode('75011');
    await geocoder.geocodePostcode('75011');

    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each(['', '7501', '750111', 'abcde', '75011 Paris', '75011&x=1', '../etc'])(
    'n’envoie rien au service pour « %s » (format invalide)',
    async (postcode) => {
      const { geocoder, http } = setup(() => json(FOUND));

      expect(await geocoder.geocodePostcode(postcode)).toBeNull();
      expect(http).not.toHaveBeenCalled();
    },
  );

  it('renvoie null pour un code inconnu, une panne, une réponse illisible ou un réseau coupé', async () => {
    expect(await setup(() => json({ features: [] })).geocoder.geocodePostcode('99999')).toBeNull();
    expect(await setup(() => json({}, 500)).geocoder.geocodePostcode('75011')).toBeNull();
    expect(await setup(() => json({ autre: 1 })).geocoder.geocodePostcode('75011')).toBeNull();
    expect(await setup(() => new Response('<html>')).geocoder.geocodePostcode('75011')).toBeNull();
    const down = setup(() => {
      throw new Error('réseau coupé');
    });
    expect(await down.geocoder.geocodePostcode('75011')).toBeNull();
  });

  it('ne met pas en mémoire un échec : le prochain appel réessaie', async () => {
    let calls = 0;
    const { geocoder } = setup(() => (calls++ === 0 ? json({}, 500) : json(FOUND)));

    expect(await geocoder.geocodePostcode('75011')).toBeNull();
    expect(await geocoder.geocodePostcode('75011')).not.toBeNull();
  });

  describe('bascule entre fournisseurs', () => {
    const API_GEO = [{ centre: { type: 'Point', coordinates: [2.03, 48.78] } }];
    const byHost = (primary: () => Response, secondary: () => Response) => {
      const http = vi.fn<HttpFetch>(async (url) =>
        new URL(url).hostname === 'data.geopf.fr' ? primary() : secondary(),
      );
      return { geocoder: new GeocoderService(http), http };
    };

    it.each([
      ['une erreur HTTP', () => json({}, 502)],
      ['une réponse illisible', () => new Response('<html>')],
    ])('passe au secours quand le principal répond par %s', async (_name, broken) => {
      const { geocoder, http } = byHost(broken, () => json(API_GEO));

      expect(await geocoder.geocodePostcode('78180')).toEqual({ latitude: 48.78, longitude: 2.03 });

      const hosts = http.mock.calls.map((c) => new URL(c[0]).hostname);
      expect(hosts).toEqual(['data.geopf.fr', 'geo.api.gouv.fr']);
      const fallback = new URL(http.mock.calls[1]?.[0] ?? '');
      expect(fallback.searchParams.get('codePostal')).toBe('78180');
    });

    it('passe au secours quand le principal est injoignable', async () => {
      const { geocoder } = byHost(
        () => {
          throw new Error('réseau coupé');
        },
        () => json(API_GEO),
      );

      expect(await geocoder.geocodePostcode('78180')).not.toBeNull();
    });

    it('passe à Nominatim quand les deux services de l’État sont en panne', async () => {
      const http = vi.fn<HttpFetch>(async (url) =>
        new URL(url).hostname === 'nominatim.openstreetmap.org'
          ? json([{ lat: '48.7798536', lon: '2.0297584' }])
          : json({}, 502),
      );
      const geocoder = new GeocoderService(http);

      expect(await geocoder.geocodePostcode('78180')).toEqual({
        latitude: 48.7798536,
        longitude: 2.0297584,
      });

      expect(http.mock.calls.map((c) => new URL(c[0]).hostname)).toEqual([
        'data.geopf.fr',
        'geo.api.gouv.fr',
        'nominatim.openstreetmap.org',
      ]);
      const last = http.mock.calls[2];
      expect(new URL(last?.[0] ?? '').searchParams.get('postalcode')).toBe('78180');
      expect(JSON.stringify(last?.[1]?.headers)).toContain('airpost-geocoder');
    });

    it('ne bascule pas sur un « aucun résultat » : c’est une vraie réponse', async () => {
      const { geocoder, http } = byHost(
        () => json({ features: [] }),
        () => json(API_GEO),
      );

      expect(await geocoder.geocodePostcode('99999')).toBeNull();
      expect(http).toHaveBeenCalledTimes(1);
    });

    it('renvoie null quand les deux fournisseurs sont en panne, sans rien mémoriser', async () => {
      let down = true;
      const { geocoder } = byHost(
        () => (down ? json({}, 502) : json(FOUND)),
        () => json({}, 503),
      );

      expect(await geocoder.geocodePostcode('78180')).toBeNull();
      down = false;
      expect(await geocoder.geocodePostcode('78180')).not.toBeNull();
    });

    it('au secours, choisit parmi les homonymes la commune la plus proche', async () => {
      const homonyms = [
        { centre: { type: 'Point', coordinates: [5.0, 45.0] } },
        { centre: { type: 'Point', coordinates: [2.03, 48.78] } },
      ];
      const { geocoder, http } = byHost(
        () => json({}, 502),
        () => json(homonyms),
      );

      const result = await geocoder.geocodeCity('Saint-Denis', { latitude: 48.8, longitude: 2.0 });

      expect(result).toEqual({ latitude: 48.78, longitude: 2.03 });
      expect(new URL(http.mock.calls[1]?.[0] ?? '').searchParams.get('nom')).toBe('Saint-Denis');
    });
  });

  describe('geocodeCity', () => {
    it('convertit un nom de commune et favorise la commune proche en cas d’homonymes', async () => {
      const { geocoder, http } = setup(() => json(FOUND));

      const result = await geocoder.geocodeCity('Élancourt', { latitude: 48.78, longitude: 2.03 });

      expect(result).toEqual({ latitude: 48.860162, longitude: 2.381844 });
      const called = new URL(http.mock.calls[0]?.[0] ?? '');
      expect(called.searchParams.get('q')).toBe('Élancourt');
      expect(called.searchParams.get('lat')).toBe('48.78');
      expect(called.searchParams.get('lon')).toBe('2.03');
    });

    it('garde en mémoire les communes trouvées ET celles sans résultat', async () => {
      const { geocoder, http } = setup(() => json({ features: [] }));

      expect(await geocoder.geocodeCity('Nullepart-sur-Mer')).toBeNull();
      expect(await geocoder.geocodeCity('nullepart-sur-mer')).toBeNull();

      expect(http).toHaveBeenCalledTimes(1);
    });

    it('ne mémorise pas une panne du service : le prochain appel réessaie', async () => {
      let calls = 0;
      const { geocoder } = setup(() => (calls++ === 0 ? json({}, 500) : json(FOUND)));

      expect(await geocoder.geocodeCity('Paris')).toBeNull();
      expect(await geocoder.geocodeCity('Paris')).not.toBeNull();
    });

    it.each([
      '',
      'P',
      'x'.repeat(81),
      'Paris&limit=99',
      '75011',
      'Paris/../x',
      '<script>',
      'Paris, France',
    ])('n’envoie rien au service pour « %s » (nom douteux)', async (name) => {
      const { geocoder, http } = setup(() => json(FOUND));

      expect(await geocoder.geocodeCity(name)).toBeNull();
      expect(http).not.toHaveBeenCalled();
    });

    it('accepte les noms composés (tirets, apostrophes, points)', async () => {
      const { geocoder, http } = setup(() => json(FOUND));

      await geocoder.geocodeCity('Saint-Quentin-en-Yvelines');
      await geocoder.geocodeCity("L'Haÿ-les-Roses");
      await geocoder.geocodeCity('St. Denis');

      expect(http).toHaveBeenCalledTimes(3);
    });
  });
});
