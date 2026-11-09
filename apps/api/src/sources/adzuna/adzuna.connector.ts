import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { HTTP_FETCH, type HttpFetch } from '../http-fetch';
import { MAX_COMPANY, MAX_DESCRIPTION, MAX_TITLE, cleanText, safeUrl, toDate } from '../normalize';
import {
  type NormalizedOffer,
  type SearchQuery,
  type SearchResult,
  SourceError,
} from '../source.types';

const BASE_URL = 'https://api.adzuna.com/v1/api/jobs/fr/search/1';
const TIMEOUT_MS = 10_000;
/** Maximum de l'API par page ; les formules gratuites sont limitées (≈ 25 appels/min, 250/jour). */
const RESULTS_PER_PAGE = 50;

const jobSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullish(),
  created: z.string().nullish(),
  redirect_url: z.string().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  company: z.object({ display_name: z.string().nullish() }).nullish(),
  location: z
    .object({
      display_name: z.string().nullish(),
      area: z.array(z.string()).nullish(),
    })
    .nullish(),
});
type Job = z.infer<typeof jobSchema>;

const responseSchema = z.object({ results: z.array(z.unknown()) });

/** Ville : niveau « département/ville » de la hiérarchie (France > Île-de-France > Paris > 9e), sinon libellé. */
function cityOf(job: Job): string | undefined {
  const fromArea = job.location?.area?.[2];
  const fromName = job.location?.display_name?.split(',')[0];
  return cleanText(fromArea ?? fromName, 80);
}

export function normalizeAdzunaJob(job: Job): NormalizedOffer {
  return {
    source: 'ADZUNA',
    externalId: job.id,
    title: cleanText(job.title, MAX_TITLE) ?? 'Offre sans titre',
    company: cleanText(job.company?.display_name, MAX_COMPANY) ?? 'Entreprise non indiquée',
    city: cityOf(job),
    // Adzuna ne fournit pas de code postal.
    latitude: job.latitude ?? undefined,
    longitude: job.longitude ?? undefined,
    // Description tronquée par Adzuna (≈ 500 caractères) : suffisante pour le score, pas pour la lettre.
    description: cleanText(job.description, MAX_DESCRIPTION),
    // Lien de redirection d'Adzuna vers l'annonce d'origine.
    applyUrl: safeUrl(job.redirect_url),
    channel: 'SITE',
    publishedAt: toDate(job.created),
  };
}

/**
 * Connecteur Adzuna (agrégateur d'annonces). La clé voyage dans l'URL (c'est la méthode de l'API) : aucun
 * message d'erreur, aucun journal ne doit donc jamais contenir l'URL de la requête.
 * Attribution : les conditions d'Adzuna demandent d'afficher « Jobs by Adzuna » près des annonces (interface).
 */
@Injectable()
export class AdzunaConnector {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_FETCH) private readonly http: HttpFetch,
  ) {}

  async search(query: SearchQuery): Promise<SearchResult> {
    const { ADZUNA_APP_ID: appId, ADZUNA_APP_KEY: appKey } = this.env;
    if (!appId || !appKey) {
      throw new SourceError(
        'ADZUNA',
        'not_configured',
        'Adzuna : ADZUNA_APP_ID et ADZUNA_APP_KEY absents.',
      );
    }
    const where = query.where?.trim();
    if (!where || !Number.isFinite(query.radiusKm) || query.radiusKm <= 0) {
      throw new SourceError('ADZUNA', 'invalid', 'Adzuna : lieu ou rayon de recherche invalide.');
    }

    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      'content-type': 'application/json',
      results_per_page: String(RESULTS_PER_PAGE),
      sort_by: 'date',
      what: 'alternance',
      where,
      distance: String(query.radiusKm),
    });
    // « what_or » : au moins un de ces mots (la pile technique recherchée).
    const keywords = (query.keywords ?? []).join(' ').trim();
    if (keywords) {
      params.set('what_or', keywords);
    }

    let response: Response;
    try {
      response = await this.http(`${BASE_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      // Pas de détail : le message d'origine peut contenir l'URL, donc la clé.
      throw new SourceError('ADZUNA', 'unavailable', 'Adzuna : service injoignable.');
    }

    if (response.status === 401 || response.status === 403) {
      throw new SourceError('ADZUNA', 'unauthorized', 'Adzuna : clés refusées.');
    }
    if (response.status === 429) {
      throw new SourceError('ADZUNA', 'rate_limited', 'Adzuna : limite d’appels atteinte.');
    }
    if (response.status === 400) {
      throw new SourceError('ADZUNA', 'invalid', 'Adzuna : requête refusée (400).');
    }
    if (!response.ok) {
      throw new SourceError('ADZUNA', 'unavailable', `Adzuna : réponse ${response.status}.`);
    }

    const body = responseSchema.safeParse(await response.json().catch(() => null));
    if (!body.success) {
      throw new SourceError('ADZUNA', 'invalid', 'Adzuna : réponse inattendue.');
    }

    const offers: NormalizedOffer[] = [];
    let skipped = 0;
    for (const raw of body.data.results) {
      // L'identifiant est une chaîne chez Adzuna ; on tolère un nombre.
      const candidate =
        raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'number'
          ? { ...raw, id: String((raw as { id: number }).id) }
          : raw;
      const job = jobSchema.safeParse(candidate);
      if (job.success) {
        offers.push(normalizeAdzunaJob(job.data));
      } else {
        skipped++;
      }
    }
    return { offers, skipped };
  }
}
