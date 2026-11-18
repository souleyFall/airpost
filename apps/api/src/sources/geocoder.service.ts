import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HTTP_FETCH, type HttpFetch } from '../http/http-fetch';

const URL_BASE = 'https://data.geopf.fr/geocodage/search';
const TIMEOUT_MS = 10_000;
/** Nombre de villes mémorisées : borne la mémoire, un seul utilisateur n'en croise jamais autant. */
const CITY_CACHE_MAX = 500;

const URL_BASE_API_GEO = 'https://geo.api.gouv.fr/communes';

const geoplateformeSchema = z.object({
  features: z.array(
    z.object({ geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }) }),
  ),
});

const URL_BASE_NOMINATIM = 'https://nominatim.openstreetmap.org/search';

const nominatimSchema = z.array(z.object({ lat: z.string(), lon: z.string() }));

const apiGeoSchema = z.array(
  z.object({
    centre: z.object({ coordinates: z.tuple([z.number(), z.number()]) }).optional(),
  }),
);

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
    const result = await this.search({ postcode });
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
    const validNear =
      near && Number.isFinite(near.latitude) && Number.isFinite(near.longitude) ? near : undefined;
    const result = await this.search({ city, near: validNear });
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

  /**
   * Interroge les fournisseurs dans l'ordre. On passe au suivant seulement si le précédent est en panne
   * (injoignable, erreur HTTP, réponse illisible) : un « aucun résultat » est une vraie réponse.
   * null : aucun résultat ; undefined : tous les fournisseurs sont en panne.
   */
  private async search(query: GeoQuery): Promise<Coordinates | null | undefined> {
    for (const provider of PROVIDERS) {
      const result = await this.ask(provider, query);
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  }

  private async ask(provider: Provider, query: GeoQuery): Promise<Coordinates | null | undefined> {
    try {
      const response = await this.http(provider.url(query), {
        headers: { Accept: 'application/json', ...provider.headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) {
        return undefined;
      }
      return provider.parse(await response.json(), query);
    } catch {
      return undefined;
    }
  }
}

/** Ce qu'on cherche : un code postal, ou un nom de commune (avec un point de repère pour les homonymes). */
type GeoQuery = { postcode: string } | { city: string; near?: Coordinates };

interface Provider {
  /** En-têtes propres au fournisseur (Nominatim exige un User-Agent identifiable). */
  headers?: Record<string, string>;
  url(query: GeoQuery): string;
  /** null : aucun résultat ; undefined : réponse illisible. */
  parse(body: unknown, query: GeoQuery): Coordinates | null | undefined;
}

/** Principal : Géoplateforme de l'IGN (GeoJSON, longitude d'abord). */
const geoplateforme: Provider = {
  url(query) {
    const params: Record<string, string> = {
      q: 'postcode' in query ? query.postcode : query.city,
      type: 'municipality',
      limit: '1',
    };
    if ('city' in query && query.near) {
      params.lat = String(query.near.latitude);
      params.lon = String(query.near.longitude);
    }
    return `${URL_BASE}?${new URLSearchParams(params).toString()}`;
  },
  parse(body) {
    const parsed = geoplateformeSchema.safeParse(body);
    if (!parsed.success) return undefined;
    const coordinates = parsed.data.features[0]?.geometry.coordinates;
    return coordinates ? { latitude: coordinates[1], longitude: coordinates[0] } : null;
  },
};

/** Secours : API Géo (communes), autre service public sur une autre infrastructure. */
const apiGeo: Provider = {
  url(query) {
    const params: Record<string, string> =
      'postcode' in query
        ? { codePostal: query.postcode, fields: 'centre', limit: '1' }
        : { nom: query.city, fields: 'centre', boost: 'population', limit: '5' };
    return `${URL_BASE_API_GEO}?${new URLSearchParams(params).toString()}`;
  },
  parse(body, query) {
    const parsed = apiGeoSchema.safeParse(body);
    if (!parsed.success) return undefined;
    const points = parsed.data.flatMap((c) =>
      c.centre ? [{ latitude: c.centre.coordinates[1], longitude: c.centre.coordinates[0] }] : [],
    );
    return pick(points, query);
  },
};

/** Dernier recours : Nominatim (OpenStreetMap), indépendant des services de l'État. Seul un code postal ou un nom de commune lui est envoyé. */
const nominatim: Provider = {
  headers: { 'User-Agent': 'airpost-geocoder/1.0 (usage personnel)' },
  url(query) {
    const params: Record<string, string> =
      'postcode' in query
        ? { postalcode: query.postcode, country: 'fr', format: 'jsonv2', limit: '1' }
        : { city: query.city, country: 'fr', format: 'jsonv2', limit: '5' };
    return `${URL_BASE_NOMINATIM}?${new URLSearchParams(params).toString()}`;
  },
  parse(body, query) {
    const parsed = nominatimSchema.safeParse(body);
    if (!parsed.success) return undefined;
    const points = parsed.data.map((r) => ({ latitude: Number(r.lat), longitude: Number(r.lon) }));
    return pick(
      points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)),
      query,
    );
  },
};

/** Parmi plusieurs résultats, la commune la plus proche du repère (homonymes) ; sinon la première. */
function pick(points: Coordinates[], query: GeoQuery): Coordinates | null {
  if ('city' in query && query.near) {
    const near = query.near;
    const distance = (p: Coordinates) =>
      (p.latitude - near.latitude) ** 2 + (p.longitude - near.longitude) ** 2;
    return points.reduce<Coordinates | null>(
      (best, p) => (best === null || distance(p) < distance(best) ? p : best),
      null,
    );
  }
  return points[0] ?? null;
}

const PROVIDERS: Provider[] = [geoplateforme, apiGeo, nominatim];
