import { Injectable } from '@nestjs/common';
import { GmailClient, GmailError, type MessageContent } from '../../gmail/gmail.client';
import { GeocoderService } from '../geocoder.service';
import { locateOffers } from '../serpapi/serpapi';
import {
  type NormalizedOffer,
  type SearchQuery,
  type SearchResult,
  SourceError,
} from '../source.types';
import { isAuthentic } from './alert-sender';
import { LINKEDIN_SENDERS, parseLinkedinAlert } from './linkedin-alert';

/** Messages lus au plus par collecte (les plus récents d'abord) et fenêtre de recherche. */
const MAX_MESSAGES = 50;
const WINDOW = '14d';
const CONCURRENCY = 5;

const LABEL = 'LinkedIn (e-mails d’offres)';

/** Recherche Gmail bornée aux expéditeurs connus : `{a b}` signifie « a OU b ». */
export const LINKEDIN_QUERY = `{${LINKEDIN_SENDERS.map((s) => `from:${s.address}`).join(' ')}} newer_than:${WINDOW}`;

/**
 * Source « e-mails d'offres LinkedIn » : lit les messages que LinkedIn envoie à la boîte Gmail de l'utilisateur
 * (offres recommandées, offres enregistrées, offres similaires, alertes). Aucun appel à LinkedIn, aucun compte, aucun
 * lien suivi : seule la boîte de l'utilisateur est lue, en lecture seule. Le corps est analysé en mémoire et jamais
 * stocké ; les liens reçus (qui portent des jetons personnels) ne sont pas conservés.
 */
@Injectable()
export class LinkedinAlertsConnector {
  constructor(
    private readonly gmail: GmailClient,
    private readonly geocoder: GeocoderService,
  ) {}

  isConfigured(): boolean {
    return this.gmail.isConfigured();
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    if (!this.gmail.isConfigured()) {
      throw new SourceError('LINKEDIN', 'not_configured', `${LABEL} : Gmail n'est pas configuré.`);
    }
    const offers = new Map<string, NormalizedOffer>();
    let skipped = 0;
    try {
      const ids = await this.gmail.searchMessageIds(LINKEDIN_QUERY, MAX_MESSAGES);
      for (let i = 0; i < ids.length; i += CONCURRENCY) {
        const batch = await Promise.all(
          ids.slice(i, i + CONCURRENCY).map((id) => this.gmail.messageContent(id)),
        );
        for (const message of batch) {
          skipped += this.read(message, offers);
        }
      }
    } catch (error) {
      if (error instanceof GmailError) {
        throw new SourceError('LINKEDIN', error.reason, `${LABEL} : ${error.message}`);
      }
      throw error;
    }

    const list = [...offers.values()];
    await locateOffers(this.geocoder, list, {
      latitude: query.latitude,
      longitude: query.longitude,
    });
    return { offers: list, skipped };
  }

  /** Ajoute les annonces d'un message ; renvoie le nombre d'éléments écartés (message douteux ou bloc illisible). */
  private read(message: MessageContent, offers: Map<string, NormalizedOffer>): number {
    const authentic = LINKEDIN_SENDERS.some((rule) => isAuthentic(message, rule));
    if (!authentic || message.text === null) {
      return 1;
    }
    const parsed = parseLinkedinAlert(message.text);
    for (const offer of parsed.offers) {
      if (!offers.has(offer.externalId)) offers.set(offer.externalId, offer);
    }
    return parsed.skipped;
  }
}
