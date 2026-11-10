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

const DAY_MS = 86_400_000;
/** Rayons acceptés par Glassdoor (kilomètres hors États-Unis). */
const RADIUS_STEPS = [5, 10, 15, 25, 50, 100] as const;
/** Annonces publiées depuis au plus 14 jours : au-delà, une offre est souvent pourvue. Valeurs admises : 1, 3, 7, 14, 30. */
const DATE_POSTED_DAYS = '14';

const jobSchema = z.object({
  // Identifiant Glassdoor de l'annonce : une chaîne ou un nombre selon les réponses.
  job_id: z.union([z.string().min(1), z.number()]).transform(String),
  title: z.string().min(1),
  company_name: z.string().nullish(),
  location: z.string().nullish(),
  // Fiche de l'annonce sur Glassdoor (pas de lien de candidature direct).
  link: z.string().nullish(),
  // Âge de l'annonce en jours (pas de date absolue).
  days_since_posted: z.number().nullish(),
  // Extrait tronqué : Glassdoor ne donne pas le texte complet.
  snippet: z.string().nullish(),
  skills: z.array(z.string()).nullish(),
});
type Job = z.infer<typeof jobSchema>;

const responseSchema = z.object({
  jobs_results: z.array(z.unknown()).optional(),
  serpapi_pagination: z.object({ next_page_token: z.string().nullish() }).nullish(),
});

export function normalizeGlassdoorJob(job: Job, now: Date): NormalizedOffer {
  // Les compétences listées par Glassdoor aident l'analyse de la pile technique quand l'extrait est court.
  const skills = (job.skills ?? []).map((s) => s.trim()).filter(Boolean);
  const description = [job.snippet, skills.length > 0 ? `Compétences : ${skills.join(', ')}` : '']
    .filter(Boolean)
    .join('\n\n');
  const age = job.days_since_posted;
  return {
    source: 'GLASSDOOR',
    externalId: job.job_id,
    title: cleanText(job.title, MAX_TITLE) ?? 'Offre sans titre',
    company: cleanText(job.company_name, MAX_COMPANY) ?? UNKNOWN_COMPANY,
    city: cityOf(job.location),
    // Pas de coordonnées chez SerpApi : elles sont ajoutées ensuite par géocodage de la ville.
    description: cleanText(description, MAX_DESCRIPTION),
    applyUrl: safeUrl(job.link),
    channel: 'SITE',
    publishedAt:
      age !== null && age !== undefined && Number.isFinite(age) && age >= 0
        ? new Date(now.getTime() - age * DAY_MS)
        : undefined,
  };
}

const CONTRACT_WORD = { ALTERNANCE: 'alternance', STAGE: 'stage' } as const;

/**
 * Une recherche par contrat recherché : « alternance développeur », « stage développeur ». Volontairement sans les
 * mots-clés de la pile technique : Glassdoor les traite comme des mots obligatoires et ne renverrait presque rien
 * (51 résultats pour « alternance développeur » à Paris) ; le tri fin est fait ensuite par le filtre de pertinence
 * et par l'IA.
 */
export function buildQueries(query: SearchQuery): string[] {
  const contracts = query.contracts?.length ? query.contracts : (['ALTERNANCE'] as const);
  return [...new Set(contracts)].map((c) => `${CONTRACT_WORD[c]} développeur`);
}

/** Plus petit rayon admis par Glassdoor qui couvre le rayon demandé (100 km au plus). */
export function radiusFor(km: number): string {
  return String(RADIUS_STEPS.find((step) => step >= km) ?? 100);
}

/**
 * Connecteur Glassdoor via SerpApi : seul SerpApi est appelé, jamais Glassdoor ni un compte de l'utilisateur.
 * 30 annonces par recherche ; `GLASSDOOR_MAX_SEARCHES` borne chaque collecte, pages comprises.
 * Limites : un extrait de l'annonce (pas le texte complet), pas de coordonnées, lien vers la fiche Glassdoor.
 */
@Injectable()
export class GlassdoorConnector {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_FETCH) private readonly http: HttpFetch,
    private readonly geocoder: GeocoderService,
  ) {}

  async search(query: SearchQuery, now = new Date()): Promise<SearchResult> {
    const key = this.env.SERPAPI_KEY;
    if (!key) {
      throw new SourceError('GLASSDOOR', 'not_configured', 'Glassdoor : SERPAPI_KEY absente.');
    }
    const where = query.where?.trim();
    if (!where || !isValidGeoQuery(query)) {
      throw new SourceError('GLASSDOOR', 'invalid', 'Glassdoor : lieu ou rayon invalide.');
    }

    const { offers, skipped } = await runSearches({
      queries: buildQueries(query),
      budget: this.env.GLASSDOOR_MAX_SEARCHES,
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
      engine: 'glassdoor_jobs',
      q,
      location: `${where}, France`,
      radius: radiusFor(radiusKm),
      date_posted: DATE_POSTED_DAYS,
    };
    if (token) params.next_page_token = token;

    const raw = await serpapiGet(this.http, {
      source: 'GLASSDOOR',
      label: 'Glassdoor',
      key,
      params,
    });
    if (raw === null) return { offers: [], skipped: 0 };
    const body = responseSchema.safeParse(raw);
    if (!body.success) {
      throw new SourceError('GLASSDOOR', 'invalid', 'Glassdoor : réponse inattendue.');
    }

    const offers: NormalizedOffer[] = [];
    let skipped = 0;
    for (const entry of body.data.jobs_results ?? []) {
      const job = jobSchema.safeParse(entry);
      if (job.success) offers.push(normalizeGlassdoorJob(job.data, now));
      else skipped++;
    }
    return {
      offers,
      skipped,
      next: body.data.serpapi_pagination?.next_page_token ?? undefined,
    };
  }
}
