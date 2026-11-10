import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { HTTP_FETCH, type HttpFetch } from '../../http/http-fetch';
import { GeocoderService } from '../geocoder.service';
import { assertOk } from '../http-errors';
import {
  MAX_COMPANY,
  MAX_DESCRIPTION,
  MAX_TITLE,
  UNKNOWN_COMPANY,
  cleanText,
  isValidGeoQuery,
  safeUrl,
} from '../normalize';
import {
  type NormalizedOffer,
  type SearchQuery,
  type SearchResult,
  SourceError,
} from '../source.types';

const BASE_URL = 'https://serpapi.com/search.json';
/** Une recherche Google Jobs non mise en cache peut prendre plusieurs secondes : marge confortable. */
const TIMEOUT_MS = 30_000;
/** Villes géocodées au plus par collecte : les annonces d'une même ville partagent une seule recherche. */
const MAX_CITIES = 40;
const DAY_MS = 86_400_000;
/** En dessous de cette longueur (caractères), la description est jugée courte et complétée par les « points forts ». */
const HIGHLIGHTS_ONLY_BELOW = 400;

const jobSchema = z.object({
  // Identifiant stable de l'annonce chez Google ; long (plusieurs centaines de caractères), borné par prudence.
  job_id: z.string().min(1).max(2_000),
  title: z.string().min(1),
  company_name: z.string().nullish(),
  location: z.string().nullish(),
  // « via LinkedIn », « via Indeed » : la plateforme d'origine de l'annonce.
  via: z.string().nullish(),
  description: z.string().nullish(),
  detected_extensions: z.object({ posted_at: z.string().nullish() }).nullish(),
  apply_options: z.array(z.object({ link: z.string().nullish() })).nullish(),
  share_link: z.string().nullish(),
  job_highlights: z
    .array(z.object({ title: z.string().nullish(), items: z.array(z.string()).nullish() }))
    .nullish(),
});
type Job = z.infer<typeof jobSchema>;

const responseSchema = z.object({
  jobs_results: z.array(z.unknown()).optional(),
  // SerpApi répond parfois 200 avec un champ « error » (clé invalide, plus de recherches, aucun résultat).
  error: z.string().optional(),
  serpapi_pagination: z.object({ next_page_token: z.string().nullish() }).nullish(),
});

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

/**
 * « Il y a 3 jours », « il y a 8 heures », « il y a 1 mois », « 3 days ago » → date approximative.
 * Google n'indique qu'un âge arrondi : c'est une estimation, suffisante pour trier par fraîcheur.
 */
export function parsePostedAt(text: string | null | undefined, now: Date): Date | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/aujourd|today|à l'instant|just now/.test(t)) return now;
  const match =
    /(\d{1,3})\s*\+?\s*(minute|min|heure|h|hour|jour|j|day|semaine|week|mois|month)/.exec(t);
  if (!match) return undefined;
  const n = Number(match[1]);
  const unit = match[2] ?? '';
  let ms: number;
  if (/^(minute|min)/.test(unit)) ms = n * 60_000;
  else if (/^(heure|h|hour)/.test(unit)) ms = n * 3_600_000;
  else if (/^(jour|j|day)/.test(unit)) ms = n * DAY_MS;
  else if (/^(semaine|week)/.test(unit)) ms = n * 7 * DAY_MS;
  else ms = n * 30 * DAY_MS;
  return new Date(now.getTime() - ms);
}

export function normalizeGoogleJob(job: Job, now: Date): NormalizedOffer {
  const highlights = (job.job_highlights ?? [])
    .map((h) => [h.title, ...(h.items ?? [])].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n');
  // Les « points forts » de Google reprennent des extraits de la description : on ne les ajoute que si elle est
  // courte ou absente (sinon le texte serait dupliqué, et le modèle paierait deux fois les mêmes jetons).
  const description = [
    job.description,
    (job.description?.length ?? 0) < HIGHLIGHTS_ONLY_BELOW ? highlights : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    source: 'GOOGLE_JOBS',
    externalId: job.job_id,
    title: cleanText(job.title, MAX_TITLE) ?? 'Offre sans titre',
    company: cleanText(job.company_name, MAX_COMPANY) ?? UNKNOWN_COMPANY,
    city: cityOf(job.location),
    // Pas de coordonnées chez SerpApi : elles sont ajoutées ensuite par géocodage de la ville.
    description: cleanText(description, MAX_DESCRIPTION),
    // Lien de candidature direct s'il existe, sinon lien de partage de Google.
    applyUrl:
      safeUrl(job.apply_options?.find((option) => safeUrl(option.link))?.link) ??
      safeUrl(job.share_link),
    channel: 'SITE',
    via: cleanText(job.via?.replace(/^via\s+/i, ''), 60),
    publishedAt: parsePostedAt(job.detected_extensions?.posted_at, now),
  };
}

const CONTRACT_WORD = { ALTERNANCE: 'alternance', STAGE: 'stage' } as const;

/** Une recherche par contrat recherché : « alternance développeur TypeScript React », « stage développeur … ». */
export function buildQueries(query: SearchQuery): string[] {
  const contracts = query.contracts?.length ? query.contracts : (['ALTERNANCE'] as const);
  const keywords = (query.keywords ?? [])
    .slice(0, 2)
    .map((k) => k.trim())
    .filter(Boolean)
    .join(' ');
  return [...new Set(contracts)].map((c) =>
    `${CONTRACT_WORD[c]} développeur ${keywords}`.trim().slice(0, 100),
  );
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
function errorFromBody(message: string, key: string): SourceError | null {
  const m = message.toLowerCase();
  if (/hasn'?t returned any results|no results|did not return any results/.test(m)) return null;
  if (/invalid api key|api key/.test(m)) {
    return new SourceError('GOOGLE_JOBS', 'unauthorized', 'Google Jobs : clé SerpApi refusée.');
  }
  if (/run out of searches|plan|limit|quota|exceeded/.test(m)) {
    return new SourceError('GOOGLE_JOBS', 'rate_limited', 'Google Jobs : quota SerpApi atteint.');
  }
  // Extrait du message de SerpApi pour comprendre la panne, sans lien ni clé (la clé voyage dans l'URL).
  const excerpt = message
    .replaceAll(key, '[clé]')
    .replace(/https?:\/\/\S+/g, '[lien]')
    .slice(0, 100);
  return new SourceError(
    'GOOGLE_JOBS',
    'unavailable',
    `Google Jobs : réponse en erreur (${excerpt}).`,
  );
}

/**
 * Connecteur Google Jobs via SerpApi. Google Jobs reprend des annonces de LinkedIn, Indeed, Welcome to the Jungle...
 * sans que nous touchions à ces sites : seul SerpApi est appelé. La clé voyage dans l'URL (méthode de l'API) :
 * aucun message d'erreur, aucun journal ne doit donc jamais contenir l'URL de la requête.
 * Quota : 250 recherches par mois en formule gratuite ; `SERPAPI_MAX_SEARCHES` borne chaque collecte, pages comprises.
 */
@Injectable()
export class GoogleJobsConnector {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_FETCH) private readonly http: HttpFetch,
    private readonly geocoder: GeocoderService,
  ) {}

  async search(query: SearchQuery, now = new Date()): Promise<SearchResult> {
    const key = this.env.SERPAPI_KEY;
    if (!key) {
      throw new SourceError('GOOGLE_JOBS', 'not_configured', 'Google Jobs : SERPAPI_KEY absente.');
    }
    const where = query.where?.trim();
    if (!where || !isValidGeoQuery(query)) {
      throw new SourceError('GOOGLE_JOBS', 'invalid', 'Google Jobs : lieu ou rayon invalide.');
    }

    const budget = this.env.SERPAPI_MAX_SEARCHES;
    const offers = new Map<string, NormalizedOffer>();
    let skipped = 0;
    let used = 0;

    // Un état par requête : sa prochaine page, ou rien (terminée). Tour de rôle : la page 1 de chaque requête
    // d'abord, puis les pages 2, jusqu'à épuisement du budget.
    const pending = buildQueries(query).map((q) => ({ q, token: undefined as string | undefined }));
    let active = pending;
    try {
      while (active.length > 0 && used < budget) {
        const next: typeof pending = [];
        for (const state of active) {
          if (used >= budget) break;
          used++;
          const page = await this.fetchPage(key, state.q, state.token, where, query.radiusKm, now);
          skipped += page.skipped;
          for (const offer of page.offers) offers.set(offer.externalId, offer);
          if (page.next) next.push({ q: state.q, token: page.next });
        }
        active = next;
      }
    } catch (error) {
      // Échec après des résultats (quota atteint en route...) : on garde ce qui a été lu. Échec dès la première
      // recherche : la source est en erreur.
      if (offers.size === 0 || !(error instanceof SourceError)) throw error;
    }

    const list = [...offers.values()];
    await this.locate(list, { latitude: query.latitude, longitude: query.longitude });
    return { offers: list, skipped };
  }

  private async fetchPage(
    key: string,
    q: string,
    token: string | undefined,
    where: string,
    radiusKm: number,
    now: Date,
  ): Promise<{ offers: NormalizedOffer[]; skipped: number; next?: string }> {
    const params = new URLSearchParams({
      engine: 'google_jobs',
      q,
      location: `${where}, France`,
      gl: 'fr',
      hl: 'fr',
      lrad: String(radiusKm),
      api_key: key,
    });
    if (token) params.set('next_page_token', token);

    let response: Response;
    try {
      response = await this.http(`${BASE_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      // Jamais le message d'origine (il peut contenir l'URL, donc la clé) : seulement la nature de la panne.
      throw new SourceError(
        'GOOGLE_JOBS',
        'unavailable',
        `Google Jobs : service injoignable (${networkCause(error)}).`,
      );
    }
    assertOk(response, 'GOOGLE_JOBS', 'Google Jobs');

    const body = responseSchema.safeParse(await response.json().catch(() => null));
    if (!body.success) {
      throw new SourceError('GOOGLE_JOBS', 'invalid', 'Google Jobs : réponse inattendue.');
    }
    if (body.data.error !== undefined) {
      const failure = errorFromBody(body.data.error, key);
      if (failure) throw failure;
      return { offers: [], skipped: 0 };
    }

    const offers: NormalizedOffer[] = [];
    let skipped = 0;
    for (const raw of body.data.jobs_results ?? []) {
      const job = jobSchema.safeParse(raw);
      if (job.success) offers.push(normalizeGoogleJob(job.data, now));
      else skipped++;
    }
    return {
      offers,
      skipped,
      next: body.data.serpapi_pagination?.next_page_token ?? undefined,
    };
  }

  /** Ajoute les coordonnées des villes (service public de géocodage) : sans elles, pas de distance ni de filtre de rayon. */
  private async locate(
    offers: NormalizedOffer[],
    home: { latitude: number; longitude: number },
  ): Promise<void> {
    const found = new Map<string, { latitude: number; longitude: number } | null>();
    for (const offer of offers) {
      if (!isGeocodable(offer.city)) continue;
      const name = offer.city.toLowerCase();
      if (!found.has(name)) {
        if (found.size >= MAX_CITIES) continue;
        found.set(name, await this.geocoder.geocodeCity(offer.city, home));
      }
      const coordinates = found.get(name);
      if (coordinates) {
        offer.latitude = coordinates.latitude;
        offer.longitude = coordinates.longitude;
      }
    }
  }
}
