import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { HTTP_FETCH, type HttpFetch } from '../http-fetch';
import { assertOk } from '../http-errors';
import {
  MAX_COMPANY,
  MAX_DESCRIPTION,
  MAX_TITLE,
  UNKNOWN_COMPANY,
  cleanText,
  isValidGeoQuery,
  safeUrl,
  toDate,
} from '../normalize';
import {
  type NormalizedOffer,
  type SearchQuery,
  type SearchResult,
  SourceError,
} from '../source.types';

const BASE_URL = 'https://api.apprentissage.beta.gouv.fr/api/job/v1/search';
const TIMEOUT_MS = 10_000;

/** Ce que l'on lit d'une offre. Le reste de la réponse est ignoré : on ne dépend que de ce qui sert. */
const jobSchema = z.object({
  identifier: z.object({ id: z.string().min(1) }),
  workplace: z.object({
    name: z.string().nullish(),
    brand: z.string().nullish(),
    legal_name: z.string().nullish(),
    location: z
      .object({
        address: z.string().nullish(),
        geopoint: z.object({ coordinates: z.tuple([z.number(), z.number()]) }).nullish(),
      })
      .nullish(),
  }),
  apply: z.object({ url: z.string().nullish() }).nullish(),
  offer: z.object({
    title: z.string().min(1),
    description: z.string().nullish(),
    status: z.string().nullish(),
    publication: z
      .object({ creation: z.string().nullish(), expiration: z.string().nullish() })
      .nullish(),
  }),
});
type Job = z.infer<typeof jobSchema>;

const responseSchema = z.object({ jobs: z.array(z.unknown()) });

/**
 * « 99 RUE DE LA VERRERIE 75004 PARIS » → code postal et ville. Le préfixe gourmand fait choisir le DERNIER
 * groupe de 5 chiffres suivi d'un espace : « ZAC 12345 Bât A 75004 PARIS » donne bien 75004.
 */
export function parseAddress(address?: string | null): { postcode?: string; city?: string } {
  const match = /^.*\b(\d{5})\s+(\D.*)$/.exec(address?.trim() ?? '');
  return match ? { postcode: match[1], city: match[2]?.trim() } : {};
}

export function normalizeJob(job: Job): NormalizedOffer | null {
  const expiration = toDate(job.offer.publication?.expiration);
  if (
    (job.offer.status && job.offer.status !== 'Active') ||
    (expiration && expiration < new Date())
  ) {
    return null;
  }
  const coordinates = job.workplace.location?.geopoint?.coordinates;
  const { postcode, city } = parseAddress(job.workplace.location?.address);
  const applyUrl = safeUrl(job.apply?.url);
  return {
    source: 'LBA',
    externalId: job.identifier.id,
    title: job.offer.title.trim().slice(0, MAX_TITLE),
    company: (
      (job.workplace.name ?? job.workplace.brand ?? job.workplace.legal_name)?.trim() ||
      UNKNOWN_COMPANY
    ).slice(0, MAX_COMPANY),
    city,
    postcode,
    // GeoJSON : [longitude, latitude].
    latitude: coordinates?.[1],
    longitude: coordinates?.[0],
    description: cleanText(job.offer.description, MAX_DESCRIPTION),
    applyUrl,
    // La Bonne Alternance ne publie ni e-mail ni téléphone de recruteur : on postule par le site.
    channel: 'SITE',
    publishedAt: toDate(job.offer.publication?.creation),
  };
}

/** Connecteur La Bonne Alternance (API officielle de l'apprentissage, État). Limite : 60 appels/min. */
@Injectable()
export class LbaConnector {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_FETCH) private readonly http: HttpFetch,
  ) {}

  async search(query: SearchQuery): Promise<SearchResult> {
    const key = this.env.LBA_API_KEY;
    if (!key) {
      throw new SourceError(
        'LBA',
        'not_configured',
        'La Bonne Alternance : clé API absente (LBA_API_KEY).',
      );
    }

    // Une requête absurde (NaN d'un géocodage raté...) ne doit pas consommer un des 60 appels par minute.
    if (!isValidGeoQuery(query)) {
      throw new SourceError(
        'LBA',
        'invalid',
        'La Bonne Alternance : requête de recherche invalide.',
      );
    }

    const params = new URLSearchParams({
      latitude: String(query.latitude),
      longitude: String(query.longitude),
      radius: String(query.radiusKm),
    });
    // Plusieurs codes ROME : séparés par des virgules (répéter le paramètre est refusé par l'API, testé).
    if (query.romeCodes.length > 0) {
      params.set('romes', query.romeCodes.join(','));
    }

    let response: Response;
    try {
      response = await this.http(`${BASE_URL}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Pas de redirection : la clé ne doit jamais partir ailleurs que vers le domaine prévu.
        redirect: 'error',
      });
    } catch {
      // Réseau coupé ou délai dépassé. Pas de détail : le message d'origine peut contenir l'URL.
      throw new SourceError('LBA', 'unavailable', 'La Bonne Alternance : service injoignable.');
    }

    assertOk(response, 'LBA', 'La Bonne Alternance');

    const body = responseSchema.safeParse(await response.json().catch(() => null));
    if (!body.success) {
      throw new SourceError('LBA', 'invalid', 'La Bonne Alternance : réponse inattendue.');
    }

    const offers: NormalizedOffer[] = [];
    let skipped = 0;
    for (const raw of body.data.jobs) {
      const job = jobSchema.safeParse(raw);
      if (!job.success) {
        skipped++;
        continue;
      }
      const offer = normalizeJob(job.data);
      if (offer) {
        offers.push(offer);
      }
    }
    return { offers, skipped };
  }
}
