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
});
