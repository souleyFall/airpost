import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { HTTP_FETCH, type HttpFetch } from '../../http/http-fetch';
import { GeocoderService } from '../geocoder.service';
import {
  MAX_COMPANY,
  MAX_DESCRIPTION,
  MAX_TITLE,
  UNKNOWN_COMPANY,
  cleanText,
  isValidGeoQuery,
  safeUrl,
} from '../normalize';
import { type Page, cityOf, locateOffers, runSearches, serpapiGet } from '../serpapi/serpapi';
import {
  type NormalizedOffer,
  type SearchQuery,
  type SearchResult,
  SourceError,
} from '../source.types';

// Outils communs aux connecteurs SerpApi, ré-exportés ici pour les tests et les appelants existants.
export { cityOf, isGeocodable, networkCause } from '../serpapi/serpapi';

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
  serpapi_pagination: z.object({ next_page_token: z.string().nullish() }).nullish(),
});

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

/**
 * Connecteur Google Jobs via SerpApi. Google Jobs reprend des annonces de LinkedIn, Indeed, Welcome to the Jungle...
 * sans que nous touchions à ces sites : seul SerpApi est appelé (voir `serpapi/serpapi.ts`).
 * Quota : 250 recherches par mois en formule gratuite ; `GOOGLE_JOBS_MAX_SEARCHES` borne chaque collecte, pages comprises.
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

    const { offers, skipped } = await runSearches({
      queries: buildQueries(query),
      budget: this.env.GOOGLE_JOBS_MAX_SEARCHES,
      fetchPage: (q, token) => this.fetchPage(key, q, token, where, query.radiusKm, now),
    });
    await locateOffers(this.geocoder, offers, {
      latitude: query.latitude,
      longitude: query.longitude,
    });
    return { offers, skipped };
  }

  private async fetchPage(
    key: string,
    q: string,
    token: string | undefined,
    where: string,
    radiusKm: number,
    now: Date,
  ): Promise<Page> {
    const params: Record<string, string> = {
      engine: 'google_jobs',
      q,
      location: `${where}, France`,
      gl: 'fr',
      hl: 'fr',
      lrad: String(radiusKm),
    };
    if (token) params.next_page_token = token;

    const raw = await serpapiGet(this.http, {
      source: 'GOOGLE_JOBS',
      label: 'Google Jobs',
      key,
      params,
    });
    if (raw === null) return { offers: [], skipped: 0 };
    const body = responseSchema.safeParse(raw);
    if (!body.success) {
      throw new SourceError('GOOGLE_JOBS', 'invalid', 'Google Jobs : réponse inattendue.');
    }

    const offers: NormalizedOffer[] = [];
    let skipped = 0;
    for (const entry of body.data.jobs_results ?? []) {
      const job = jobSchema.safeParse(entry);
      if (job.success) offers.push(normalizeGoogleJob(job.data, now));
      else skipped++;
    }
    return {
      offers,
      skipped,
      next: body.data.serpapi_pagination?.next_page_token ?? undefined,
    };
  }
}
