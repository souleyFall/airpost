import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { HTTP_FETCH, type HttpFetch } from '../http-fetch';
import { assertOk } from '../http-errors';
import { MAX_COMPANY, MAX_DESCRIPTION, MAX_TITLE, cleanText, isValidGeoQuery } from '../normalize';
import {
  type NormalizedOffer,
  type SearchQuery,
  type SearchResult,
  SourceError,
} from '../source.types';

const TOKEN_URL =
  'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire';
const SEARCH_URL = 'https://api.francetravail.io/partenaire/labonneboite/v2/recherche';
const SCOPE = 'api_labonneboitev2 search';
const TIMEOUT_MS = 10_000;
/** Maximum accepté par l'API (200 donne une erreur 422, testé). */
const PAGE_SIZE = 100;
/** Marge avant l'expiration du jeton (secondes) : on en redemande un avant qu'il ne meure en route. */
const TOKEN_MARGIN_S = 60;

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const companySchema = z.object({
  siret: z.string().regex(/^\d{14}$/),
  company_name: z.string().nullish(),
  office_name: z.string().nullish(),
  naf_label: z.string().nullish(),
  headcount_min: z.number().nullish(),
  headcount_max: z.number().nullish(),
  city: z.string().nullish(),
  postcode: z.string().nullish(),
  location: z.object({ lat: z.number(), lon: z.number() }).nullish(),
  hiring_potential: z.number().nullish(),
});
type Company = z.infer<typeof companySchema>;

const responseSchema = z.object({ items: z.array(z.unknown()) });

export function normalizeCompany(company: Company): NormalizedOffer {
  const name =
    cleanText(company.company_name, MAX_COMPANY) ?? cleanText(company.office_name, MAX_COMPANY);
  const lines = [
    company.naf_label ? `Activité : ${company.naf_label}.` : undefined,
    company.headcount_min !== null && company.headcount_min !== undefined
      ? `Effectif : ${company.headcount_min} à ${company.headcount_max ?? '?'} salariés.`
      : undefined,
    company.hiring_potential !== null && company.hiring_potential !== undefined
      ? `Potentiel d'embauche (La Bonne Boîte) : ${company.hiring_potential.toFixed(1)}.`
      : undefined,
    "Entreprise repérée comme recrutant souvent : il n'y a pas d'annonce, c'est une candidature spontanée.",
  ];
  return {
    source: 'LBB',
    externalId: company.siret,
    title:
      cleanText(`Candidature spontanée : ${company.naf_label ?? 'développement'}`, MAX_TITLE) ?? '',
    company: name ?? 'Entreprise non indiquée',
    city: cleanText(company.city, 80),
    postcode: cleanText(company.postcode, 10),
    latitude: company.location?.lat,
    longitude: company.location?.lon,
    description: cleanText(lines.filter(Boolean).join(' '), MAX_DESCRIPTION),
    // Fiche de l'entreprise sur La Bonne Boîte (le SIRET est validé : 14 chiffres, pas de caractère libre).
    applyUrl: `https://labonneboite.francetravail.fr/entreprise/${company.siret}`,
    // L'API indique seulement qu'un e-mail existe (« yes »), jamais l'adresse : on passe par le site.
    channel: 'SITE',
  };
}

/**
 * Connecteur La Bonne Boîte v2 (France Travail) : entreprises qui recrutent souvent, sans annonce.
 * Authentification OAuth2 « client credentials » ; le jeton est gardé en mémoire jusqu'à son expiration.
 */
@Injectable()
export class LbbConnector {
  private token?: { value: string; expiresAt: number };
  private pendingToken?: Promise<string>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_FETCH) private readonly http: HttpFetch,
  ) {}

  async search(query: SearchQuery): Promise<SearchResult> {
    if (!this.env.FT_CLIENT_ID || !this.env.FT_CLIENT_SECRET) {
      throw new SourceError(
        'LBB',
        'not_configured',
        'La Bonne Boîte : FT_CLIENT_ID et FT_CLIENT_SECRET absents.',
      );
    }
    if (!isValidGeoQuery(query)) {
      throw new SourceError('LBB', 'invalid', 'La Bonne Boîte : requête de recherche invalide.');
    }
    if (query.romeCodes.length === 0) {
      throw new SourceError('LBB', 'invalid', 'La Bonne Boîte : au moins un code ROME est requis.');
    }

    const byId = new Map<string, NormalizedOffer>();
    let skipped = 0;
    // Un appel par code ROME, l'un après l'autre : l'API répond 429 dès que l'on enchaîne trop vite.
    for (const rome of query.romeCodes) {
      // Jeton relu à chaque tour : en cache tant qu'il est valide, renouvelé s'il a expiré en route.
      const token = await this.getToken();
      const params = new URLSearchParams({
        rome,
        latitude: String(query.latitude),
        longitude: String(query.longitude),
        distance: String(query.radiusKm),
        page_size: String(PAGE_SIZE),
      });
      const body = await this.getJson(`${SEARCH_URL}?${params.toString()}`, {
        Authorization: `Bearer ${token}`,
      });
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) {
        throw new SourceError('LBB', 'invalid', 'La Bonne Boîte : réponse inattendue.');
      }
      for (const raw of parsed.data.items) {
        const company = companySchema.safeParse(raw);
        if (!company.success) {
          skipped++;
          continue;
        }
        byId.set(company.data.siret, normalizeCompany(company.data));
      }
    }
    return { offers: [...byId.values()], skipped };
  }

  /** Jeton d'accès valide : en mémoire tant qu'il n'expire pas, un seul appel même si plusieurs recherches se croisent. */
  private getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return Promise.resolve(this.token.value);
    }
    this.pendingToken ??= this.fetchToken().finally(() => {
      this.pendingToken = undefined;
    });
    return this.pendingToken;
  }

  private async fetchToken(): Promise<string> {
    const body = await this.getJson(
      TOKEN_URL,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.env.FT_CLIENT_ID ?? '',
        client_secret: this.env.FT_CLIENT_SECRET ?? '',
        scope: SCOPE,
      }),
    );
    const token = tokenSchema.safeParse(body);
    if (!token.success) {
      throw new SourceError(
        'LBB',
        'invalid',
        'La Bonne Boîte : réponse d’authentification inattendue.',
      );
    }
    this.token = {
      value: token.data.access_token,
      expiresAt: Date.now() + (token.data.expires_in - TOKEN_MARGIN_S) * 1000,
    };
    return token.data.access_token;
  }

  /** Appel HTTP commun : erreurs traduites, jamais de secret ni de corps de réponse dans un message. */
  private async getJson(
    url: string,
    headers: Record<string, string>,
    form?: URLSearchParams,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.http(url, {
        method: form ? 'POST' : 'GET',
        headers: { Accept: 'application/json', ...headers },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      throw new SourceError('LBB', 'unavailable', 'La Bonne Boîte : service injoignable.');
    }
    // Un accès refusé vient peut-être d'un jeton périmé : on l'oublie pour en redemander un au prochain appel.
    if (response.status === 401 || response.status === 403) {
      this.token = undefined;
    }
    assertOk(response, 'LBB', 'La Bonne Boîte');
    return response.json().catch(() => null);
  }
}
