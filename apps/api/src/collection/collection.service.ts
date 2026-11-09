import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { OfferSource } from '../generated/prisma/enums';
import type { Profile } from '../profile/profile.schema';
import { ProfileService } from '../profile/profile.service';
import { AdzunaConnector } from '../sources/adzuna/adzuna.connector';
import { dedupKey, normalizeText } from '../sources/dedup';
import { LbaConnector } from '../sources/lba/lba.connector';
import { LbbConnector } from '../sources/lbb/lbb.connector';
import { UNKNOWN_COMPANY } from '../sources/normalize';
import { OffersService } from '../sources/offers.service';
import {
  type NormalizedOffer,
  type SearchQuery,
  type SearchResult,
  SourceError,
} from '../sources/source.types';
import { GeocoderService } from './geocoder.service';

export interface SourceReport {
  source: OfferSource;
  /** ok : lue ; disabled : clé absente ; error : échec de la source (les autres continuent). */
  status: 'ok' | 'disabled' | 'error';
  /** Raison de l'échec, jamais de détail technique ni de secret. */
  reason?: SourceError['reason'] | 'unexpected';
  fetched: number;
  skipped: number;
  excluded: number;
  duplicates: number;
  created: number;
  updated: number;
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  purged: number;
  sources: SourceReport[];
}

interface Searcher {
  source: OfferSource;
  search(query: SearchQuery): Promise<SearchResult>;
}

/** Vitesse moyenne retenue pour passer du temps de trajet au rayon de recherche : 30 km/h. */
const KM_PER_COMMUTE_MINUTE = 0.5;

/** Rayon de recherche (km) déduit du temps de trajet accepté, borné pour rester utile et raisonnable. */
export function radiusFromCommute(minutes: number): number {
  return Math.min(100, Math.max(5, Math.round(minutes * KM_PER_COMMUTE_MINUTE)));
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
    lba: LbaConnector,
    lbb: LbbConnector,
    adzuna: AdzunaConnector,
  ) {
    // L'ordre fixe la priorité en cas de doublon entre sources : de vraies annonces d'abord, les
    // entreprises « qui recrutent souvent » (candidatures spontanées) ensuite.
    this.searchers = [
      { source: 'LBA', search: (q) => lba.search(q) },
      { source: 'ADZUNA', search: (q) => adzuna.search(q) },
      { source: 'LBB', search: (q) => lbb.search(q) },
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
    };

    const sources: SourceReport[] = [];
    // Empreintes déjà retenues pendant cette collecte, avec leur source : sert au dédoublonnage.
    const seen = new Map<string, OfferSource>();
    for (const searcher of this.searchers) {
      sources.push(await this.collectFrom(searcher, query, profile, seen));
    }

    const purged = await this.offers.purgeStale(this.env.OFFER_RETENTION_DAYS);
    const report: RunReport = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      purged,
      sources,
    };
    this.last = report;
    // Des comptes seulement : ni titre, ni entreprise, ni erreur détaillée dans les journaux.
    this.logger.log(
      `Collecte terminée : ${sources.map((s) => `${s.source} ${s.status} (+${s.created}/~${s.updated})`).join(', ')} ; ${purged} offre(s) purgée(s).`,
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
      } else {
        report.status = 'error';
        report.reason = 'unexpected';
      }
      return report;
    }

    try {
      report.fetched = result.offers.length;
      report.skipped = result.skipped;

      const excludedNames = profile.search.excludedCompanies.map(normalizeText).filter(Boolean);
      const candidates: NormalizedOffer[] = [];
      for (const offer of result.offers) {
        const company = normalizeText(offer.company);
        // Mots entiers : « sa » ne doit pas exclure « casino ». Les mots sont séparés par des tirets (normalizeText).
        if (excludedNames.some((name) => `-${company}-`.includes(`-${name}-`))) {
          report.excluded++;
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
