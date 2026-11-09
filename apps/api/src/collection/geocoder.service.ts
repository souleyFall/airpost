import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HTTP_FETCH, type HttpFetch } from '../sources/http-fetch';

const URL_BASE = 'https://data.geopf.fr/geocodage/search';
const TIMEOUT_MS = 10_000;

const responseSchema = z.object({
  features: z.array(
    z.object({ geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }) }),
  ),
});

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Coordonnées d'un code postal (service public de géocodage de l'État, sans clé).
 * Minimisation : seul le code postal quitte le serveur, jamais le nom ni l'adresse du candidat.
 */
@Injectable()
export class GeocoderService {
  private readonly cache = new Map<string, Coordinates>();

  constructor(@Inject(HTTP_FETCH) private readonly http: HttpFetch) {}

  /** Renvoie null si le code postal est inconnu ou si le service ne répond pas. */
  async geocodePostcode(postcode: string): Promise<Coordinates | null> {
    // Format vérifié avant de construire l'URL : rien d'autre que 5 chiffres ne part vers le service.
    if (!/^\d{5}$/.test(postcode)) {
      return null;
    }
    const cached = this.cache.get(postcode);
    if (cached) {
      return cached;
    }

    try {
      const params = new URLSearchParams({ q: postcode, type: 'municipality', limit: '1' });
      const response = await this.http(`${URL_BASE}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) {
        return null;
      }
      const body = responseSchema.safeParse(await response.json());
      const coordinates = body.success ? body.data.features[0]?.geometry.coordinates : undefined;
      if (!coordinates) {
        return null;
      }
      // GeoJSON : [longitude, latitude].
      const result = { latitude: coordinates[1], longitude: coordinates[0] };
      this.cache.set(postcode, result);
      return result;
    } catch {
      return null;
    }
  }
}
