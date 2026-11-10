import { z } from 'zod';
import type { OfferSource } from '../../generated/prisma/enums';
import type { HttpFetch } from '../../http/http-fetch';
import type { GeocoderService } from '../geocoder.service';
import { assertOk } from '../http-errors';
import { cleanText } from '../normalize';
import { type NormalizedOffer, SourceError } from '../source.types';

/**
 * Outils communs aux connecteurs qui passent par SerpApi (Google Jobs, Glassdoor) : requête, traduction des erreurs,
 * pagination bornée par un budget de recherches, géocodage des villes. La clé voyage dans l'URL (méthode de l'API) :
 * aucun message d'erreur, aucun journal ne doit donc jamais contenir l'URL de la requête.
 */
const SERPAPI_URL = 'https://serpapi.com/search.json';
/** Une recherche non mise en cache peut prendre plusieurs secondes : marge confortable. */
const TIMEOUT_MS = 30_000;
/** Villes géocodées au plus par collecte : les annonces d'une même ville partagent une seule recherche. */
const MAX_CITIES = 40;

const REGIONS = new Set(
  [
    'france',
    'anywhere',
    'remote',
    'télétravail',
    'île-de-france',
    'ile-de-france',
    'auvergne-rhône-alpes',
    'bourgogne-franche-comté',
    'bretagne',
    'centre-val de loire',
    'corse',
    'grand est',
    'hauts-de-france',
    'normandie',
    'nouvelle-aquitaine',
    'occitanie',
    'pays de la loire',
    "provence-alpes-côte d'azur",
  ].map((name) => name.toLowerCase()),
);

/** « Paris, Île-de-France, France » → « Paris » ; « France » ou une région seule → rien à géocoder. */
export function cityOf(location?: string | null): string | undefined {
  // « Paris 8e Arrondissement » → « Paris » : le service de géocodage cherche des communes, pas des arrondissements.
  const first = location
    ?.split(',')[0]
    ?.replace(/\s+\d+\s*(?:er|e|ème|è)?\s*arrondissement.*$/i, '')
    .trim();
  return first ? cleanText(first, 80) : undefined;
}

export function isGeocodable(city?: string): city is string {
  return Boolean(city) && !REGIONS.has((city ?? '').toLowerCase());
}

/** Nature d'une panne réseau, sans détail sensible : « délai dépassé », un code système (ECONNRESET...) ou « réseau ». */
export function networkCause(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'délai dépassé';
  }
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{3,30}$/.test(code) ? code : 'réseau';
}

/** Traduction du champ « error » d'une réponse 200 de SerpApi. `null` : « aucun résultat », pas une panne. */
function errorFromBody(
  source: OfferSource,
  label: string,
  message: string,
  key: string,
): SourceError | null {
  const m = message.toLowerCase();
  if (/hasn'?t returned any results|no results|did not return any results/.test(m)) return null;
  if (/invalid api key|api key/.test(m)) {
    return new SourceError(source, 'unauthorized', `${label} : clé SerpApi refusée.`);
  }
  if (/run out of searches|plan|limit|quota|exceeded/.test(m)) {
    return new SourceError(source, 'rate_limited', `${label} : quota SerpApi atteint.`);
  }
  // Extrait du message de SerpApi pour comprendre la panne, sans lien ni clé.
  const excerpt = message
    .replaceAll(key, '[clé]')
    .replace(/https?:\/\/\S+/g, '[lien]')
    .slice(0, 100);
  return new SourceError(source, 'unavailable', `${label} : réponse en erreur (${excerpt}).`);
}

const envelope = z.object({ error: z.string().optional() }).loose();

/**
 * Une requête SerpApi. Renvoie le corps JSON, ou `null` quand Google/Glassdoor n'ont « aucun résultat » (pas une panne).
 * Toute erreur est une `SourceError` sans clé, sans URL et sans corps de réponse.
 */
export async function serpapiGet(
  http: HttpFetch,
  options: { source: OfferSource; label: string; key: string; params: Record<string, string> },
): Promise<unknown> {
  const { source, label, key } = options;
  const query = new URLSearchParams({ ...options.params, api_key: key });
  let response: Response;
  try {
    response = await http(`${SERPAPI_URL}?${query.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
  } catch (error) {
    // Jamais le message d'origine (il peut contenir l'URL, donc la clé) : seulement la nature de la panne.
    throw new SourceError(
      source,
      'unavailable',
      `${label} : service injoignable (${networkCause(error)}).`,
    );
  }
  assertOk(response, source, label);

  const raw: unknown = await response.json().catch(() => null);
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) {
    throw new SourceError(source, 'invalid', `${label} : réponse inattendue.`);
  }
  if (parsed.data.error !== undefined) {
    const failure = errorFromBody(source, label, parsed.data.error, key);
    if (failure) throw failure;
    return null;
  }
  return raw;
}

export interface Page {
  offers: NormalizedOffer[];
  skipped: number;
  /** Jeton de la page suivante ; absent : dernière page. */
  next?: string;
}

/**
 * Exécute des recherches dans la limite d'un budget, en tour de rôle : la page 1 de chaque requête d'abord, puis les
 * pages 2, etc. Une erreur après des résultats (quota atteint en route...) garde ce qui a été lu ; dès la première
 * recherche, la source est en erreur.
 */
export async function runSearches(options: {
  queries: string[];
  budget: number;
  fetchPage: (query: string, token: string | undefined) => Promise<Page>;
}): Promise<{ offers: NormalizedOffer[]; skipped: number }> {
  const offers = new Map<string, NormalizedOffer>();
  let skipped = 0;
  let used = 0;
  let active = options.queries.map((q) => ({ q, token: undefined as string | undefined }));
  try {
    while (active.length > 0 && used < options.budget) {
      const next: typeof active = [];
      for (const state of active) {
        if (used >= options.budget) break;
        used++;
        const page = await options.fetchPage(state.q, state.token);
        skipped += page.skipped;
        for (const offer of page.offers) offers.set(offer.externalId, offer);
        if (page.next) next.push({ q: state.q, token: page.next });
      }
      active = next;
    }
  } catch (error) {
    if (offers.size === 0 || !(error instanceof SourceError)) throw error;
  }
  return { offers: [...offers.values()], skipped };
}

/** Ajoute les coordonnées des villes (service public de géocodage) : sans elles, pas de distance ni de filtre de rayon. */
export async function locateOffers(
  geocoder: GeocoderService,
  offers: NormalizedOffer[],
  home: { latitude: number; longitude: number },
): Promise<void> {
  const found = new Map<string, { latitude: number; longitude: number } | null>();
  for (const offer of offers) {
    if (!isGeocodable(offer.city)) continue;
    const name = offer.city.toLowerCase();
    if (!found.has(name)) {
      if (found.size >= MAX_CITIES) continue;
      found.set(name, await geocoder.geocodeCity(offer.city, home));
    }
    const coordinates = found.get(name);
    if (coordinates) {
      offer.latitude = coordinates.latitude;
      offer.longitude = coordinates.longitude;
    }
  }
}
