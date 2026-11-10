import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HTTP_FETCH, type HttpFetch } from '../http/http-fetch';

const URL_BASE = 'https://data.geopf.fr/geocodage/search';
const TIMEOUT_MS = 10_000;
/** Nombre de villes mémorisées : borne la mémoire, un seul utilisateur n'en croise jamais autant. */
const CITY_CACHE_MAX = 500;

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
 * Coordonnées d'un code postal ou d'une commune (service public de géocodage de l'État, sans clé).
 * Minimisation : seul le code postal ou le nom de commune d'une offre quitte le serveur, jamais le nom ni l'adresse
 * du candidat.
 */
@Injectable()
export class GeocoderService {
  private readonly cache = new Map<string, Coordinates>();
  /** Communes déjà cherchées, y compris celles qui n'ont rien donné (null) : on ne les redemande pas. */
  private readonly cities = new Map<string, Coordinates | null>();

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
    const result = await this.search({ q: postcode, type: 'municipality', limit: '1' });
    if (result) {
      this.cache.set(postcode, result);
    }
    return result ?? null;
  }

  /**
   * Coordonnées d'une commune d'après son nom (« Élancourt », « Paris »). `near` départage les homonymes : le
   * service favorise la commune la plus proche. Renvoie null si le nom est douteux, inconnu ou si le service est en panne.
   */
  async geocodeCity(name: string, near?: Coordinates): Promise<Coordinates | null> {
    const city = name.trim();
    // Seul un nom de commune plausible part vers le service : lettres, espaces, tirets, apostrophes, points.
    if (city.length < 2 || city.length > 80 || !/^[\p{L}][\p{L}\s.'’-]*$/u.test(city)) {
      return null;
    }
    const key = city.toLowerCase();
    if (this.cities.has(key)) {
      return this.cities.get(key) ?? null;
    }
    const params: Record<string, string> = { q: city, type: 'municipality', limit: '1' };
    if (near && Number.isFinite(near.latitude) && Number.isFinite(near.longitude)) {
      params.lat = String(near.latitude);
      params.lon = String(near.longitude);
    }
    const result = await this.search(params);
    // Une panne du service n'est pas mémorisée comme « commune inconnue » : on pourra réessayer.
    if (result !== undefined) {
      if (this.cities.size >= CITY_CACHE_MAX) {
        const oldest = this.cities.keys().next().value;
        if (oldest !== undefined) this.cities.delete(oldest);
      }
      this.cities.set(key, result);
    }
    return result ?? null;
  }

  /** null : réponse sans résultat ; undefined : service injoignable ou réponse illisible. */
  private async search(params: Record<string, string>): Promise<Coordinates | null | undefined> {
    try {
      const response = await this.http(`${URL_BASE}?${new URLSearchParams(params).toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) {
        return undefined;
      }
      const body = responseSchema.safeParse(await response.json());
      if (!body.success) {
        return undefined;
      }
      const coordinates = body.data.features[0]?.geometry.coordinates;
      // GeoJSON : [longitude, latitude].
      return coordinates ? { latitude: coordinates[1], longitude: coordinates[0] } : null;
    } catch {
      return undefined;
    }
  }
}
