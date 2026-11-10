import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { OfferSource } from '../generated/prisma/enums';
import type { Profile } from '../profile/profile.schema';
import { ProfileService } from '../profile/profile.service';
import { MatchService } from '../matching/match.service';
import { AdzunaConnector } from '../sources/adzuna/adzuna.connector';
import { dedupKey, normalizeText } from '../sources/dedup';
import { MINUTES_PER_KM } from '../sources/geo';
import { GlassdoorConnector } from '../sources/glassdoor/glassdoor.connector';
import { GoogleJobsConnector } from '../sources/google-jobs/google-jobs.connector';
import { IndeedAlertsConnector } from '../sources/alerts/indeed-alerts.connector';
import { ApiHealthService, statusFromReason } from '../api-health/api-health.service';
import { LinkedinAlertsConnector } from '../sources/alerts/linkedin-alerts.connector';
import { LbaConnector } from '../sources/lba/lba.connector';
import { LbbConnector } from '../sources/lbb/lbb.connector';
import { UNKNOWN_COMPANY } from '../sources/normalize';
import { OffersService } from '../sources/offers.service';
import { isRelevantOffer, isSchoolAd } from '../sources/relevance';
import {
  type NormalizedOffer,
  type SearchQuery,
  type SearchResult,
  SourceError,
} from '../sources/source.types';
import { GeocoderService } from '../sources/geocoder.service';

export interface SourceReport {
  source: OfferSource;
  /** ok : lue ; disabled : clé absente ; error : échec de la source (les autres continuent). */
  status: 'ok' | 'disabled' | 'error';
  /** Raison de l'échec, jamais de détail technique ni de secret. */
  reason?: SourceError['reason'] | 'unexpected';
  fetched: number;
  skipped: number;
  excluded: number;
  /** Écartées par le filtre de pertinence (hors développement/informatique). */
  irrelevant: number;
  duplicates: number;
  created: number;
  updated: number;
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  purged: number;
  /** Offres analysées par l'IA pendant cette collecte. */
  analyzed: number;
  /** Offres en base qui attendent encore une analyse (plafond par collecte ou quota du modèle). */
  pendingAnalysis: number;
  sources: SourceReport[];
}

interface Searcher {
  source: OfferSource;
  search(query: SearchQuery): Promise<SearchResult>;
}

/** Sources déjà filtrées par code ROME à la source : La Bonne Boîte, et La Bonne Alternance quand des codes sont configurés. */
export function trustedSources(romeCodes: string[]): OfferSource[] {
  return romeCodes.length > 0 ? ['LBB', 'LBA'] : ['LBB'];
}

/** Rayon de recherche (km) déduit du temps de trajet accepté, borné pour rester utile et raisonnable. */
export function radiusFromCommute(minutes: number): number {
  return Math.min(100, Math.max(5, Math.round(minutes / MINUTES_PER_KM)));
}

@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);
  private readonly searchers: Searcher[];
  private running = false;
  private last?: RunReport;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly profiles: ProfileService,
    private readonly geocoder: GeocoderService,
    private readonly offers: OffersService,
    private readonly matching: MatchService,
    lba: LbaConnector,
    lbb: LbbConnector,
    adzuna: AdzunaConnector,
    googleJobs: GoogleJobsConnector,
    glassdoor: GlassdoorConnector,
    indeedAlerts: IndeedAlertsConnector,
    linkedinAlerts: LinkedinAlertsConnector,
    private readonly health: ApiHealthService,
  ) {
    // L'ordre fixe la priorité en cas de doublon entre sources : de vraies annonces d'abord, les
    // entreprises « qui recrutent souvent » (candidatures spontanées) ensuite.
    this.searchers = [
      { source: 'LBA', search: (q) => lba.search(q) },
      { source: 'ADZUNA', search: (q) => adzuna.search(q) },
      { source: 'LBB', search: (q) => lbb.search(q) },
      // En dernier : les annonces de Google Jobs reprennent celles d'autres sites, les doublons cèdent la place aux
      // annonces des sources précédentes.
      { source: 'GOOGLE_JOBS', search: (q) => googleJobs.search(q) },
      { source: 'GLASSDOOR', search: (q) => glassdoor.search(q) },
      // Alertes lues dans Gmail : texte d'un tiers, donc non fiable comme les autres agrégateurs.
      { source: 'INDEED', search: (q) => indeedAlerts.search(q) },
      { source: 'LINKEDIN', search: (q) => linkedinAlerts.search(q) },
    ];
  }

  lastReport(): RunReport | undefined {
    return this.last;
  }

  /** Lance une collecte pour cet utilisateur. Une seule à la fois (les API ont des quotas serrés). */
  async run(userId: string): Promise<RunReport> {
    if (this.running) {
      throw new ConflictException('Une collecte est déjà en cours');
    }
    this.running = true;
    try {
      return await this.collect(userId);
    } finally {
      this.running = false;
    }
  }

  private async collect(userId: string): Promise<RunReport> {
    const startedAt = new Date();
    const profile = await this.profiles.get(userId);
    if (!profile) {
      throw new BadRequestException('Renseigne ton profil avant de lancer une collecte');
    }
    const position = await this.geocoder.geocodePostcode(profile.identity.postcode);
    if (!position) {
      throw new BadRequestException('Code postal du profil introuvable : collecte impossible');
    }

    const query: SearchQuery = {
      ...position,
      radiusKm: radiusFromCommute(profile.search.maxCommuteMinutes),
      romeCodes: profile.search.romeCodes,
      where: profile.identity.city,
      keywords: profile.search.keywords,
      contracts: profile.search.contracts,
    };

    const sources: SourceReport[] = [];
    // Empreintes déjà retenues pendant cette collecte, avec leur source : sert au dédoublonnage.
    const seen = new Map<string, OfferSource>();
    for (const searcher of this.searchers) {
      const sourceReport = await this.collectFrom(searcher, query, profile, seen);
      sources.push(sourceReport);
      // Voyant de santé : le résultat de cette source, sans appel de test en plus. Un échec d'écriture ne perd pas la collecte.
      await this.health
        .record(
          sourceReport.source,
          sourceReport.status === 'ok'
            ? 'OK'
            : sourceReport.status === 'disabled'
              ? 'OFF'
              : statusFromReason(sourceReport.reason),
        )
        .catch(() => undefined);
    }

    const stale = await this.offers.purgeStale(this.env.OFFER_RETENTION_DAYS);
    // Remise à niveau des offres déjà en base avec les règles actuelles (hors métier supprimées, contrat corrigé).
    const cleaned = await this.offers
      .cleanup(trustedSources(profile.search.romeCodes))
      .catch(() => ({ removed: 0, updated: 0 }));
    const purged = stale + cleaned.removed;
    // Distances recalculées (le domicile peut avoir changé), puis analyse IA des offres sans note à jour.
    // Un échec de l'une ou l'autre ne perd pas la collecte.
    await this.offers.refreshDistances(position).catch(() => 0);
    const analysis = await this.matching
      .analyzePending(profile)
      .catch(() => ({ analyzed: 0, remaining: 0 }));
    const report: RunReport = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      purged,
      analyzed: analysis.analyzed,
      pendingAnalysis: analysis.remaining,
      sources,
    };
    this.last = report;
    // Des comptes seulement : ni titre, ni entreprise, ni erreur détaillée dans les journaux.
    this.logger.log(
      `Collecte terminée : ${sources.map((s) => `${s.source} ${s.status} (+${s.created}/~${s.updated})`).join(', ')} ; ${purged} offre(s) purgée(s), ${analysis.analyzed} analysée(s), ${analysis.remaining} en attente.`,
    );
    return report;
  }

  private async collectFrom(
    searcher: Searcher,
    query: SearchQuery,
    profile: Profile,
    seen: Map<string, OfferSource>,
  ): Promise<SourceReport> {
    const report: SourceReport = {
      source: searcher.source,
      status: 'ok',
      fetched: 0,
      skipped: 0,
      excluded: 0,
      irrelevant: 0,
      duplicates: 0,
      created: 0,
      updated: 0,
    };

    let result: SearchResult;
    try {
      result = await searcher.search(query);
    } catch (error) {
      // Une source en panne ne bloque pas les autres.
      if (error instanceof SourceError) {
        report.status = error.reason === 'not_configured' ? 'disabled' : 'error';
        report.reason = error.reason;
        // Le message d'une SourceError ne contient jamais de secret, d'URL ni de corps de réponse (voir les connecteurs) :
        // on peut le journaliser, il dit POURQUOI la source est en panne (délai dépassé, réponse 503...).
        if (report.status === 'error') {
          this.logger.warn(`Source ${searcher.source} en erreur : ${error.message}`);
        }
      } else {
        report.status = 'error';
        report.reason = 'unexpected';
        // Le nom de l'erreur seulement : son message pourrait embarquer une URL ou un secret.
        this.logger.warn(
          `Source ${searcher.source} : erreur inattendue (${error instanceof Error ? error.name : 'inconnue'}).`,
        );
      }
      return report;
    }

    try {
      report.fetched = result.offers.length;
      report.skipped = result.skipped;

      const trusted = trustedSources(query.romeCodes).includes(searcher.source);
      const excludedNames = profile.search.excludedCompanies.map(normalizeText).filter(Boolean);
      const candidates: NormalizedOffer[] = [];
      for (const offer of result.offers) {
        const company = normalizeText(offer.company);
        // Mots entiers : « sa » ne doit pas exclure « casino ». Les mots sont séparés par des tirets (normalizeText).
        if (excludedNames.some((name) => `-${company}-`.includes(`-${name}-`))) {
          report.excluded++;
        } else if (
          !trusted &&
          (!isRelevantOffer(offer.title, offer.description) ||
            isSchoolAd(offer.company, offer.description))
        ) {
          // Déjà filtrées par code ROME à la source : La Bonne Boîte (qui n'a d'ailleurs pas d'intitulé de poste) et La
          // Bonne Alternance quand des codes sont configurés. Adzuna, elle, cherche par mots et renvoie du bruit.
          report.irrelevant++;
        } else {
          candidates.push(offer);
        }
      }

      // Doublons entre sources : la même annonce circule chez plusieurs partenaires. Une offre dont
      // l'entreprise est inconnue n'est jamais jugée doublon (on ne peut pas la comparer).
      const keyOf = (o: NormalizedOffer) => dedupKey(o.company, o.title, o.city);
      const comparable = candidates.filter((o) => o.company !== UNKNOWN_COMPANY);
      const inDatabase = await this.offers.sourcesByDedupKey(comparable.map(keyOf));
      const kept: NormalizedOffer[] = [];
      for (const offer of candidates) {
        const key = keyOf(offer);
        const elsewhere =
          offer.company !== UNKNOWN_COMPANY &&
          ((seen.has(key) && seen.get(key) !== offer.source) ||
            [...(inDatabase.get(key) ?? [])].some((s) => s !== offer.source));
        if (elsewhere) {
          report.duplicates++;
          continue;
        }
        kept.push(offer);
      }
      for (const offer of kept) {
        seen.set(keyOf(offer), offer.source);
      }

      const saved = await this.offers.saveMany(kept);
      report.created = saved.created;
      report.updated = saved.updated;
    } catch {
      // Enregistrement impossible (base...) : cette source est signalée en erreur, les autres continuent.
      report.status = 'error';
      report.reason = 'unexpected';
    }
    return report;
  }
}
