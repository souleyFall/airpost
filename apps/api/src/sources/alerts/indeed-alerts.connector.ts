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
import { INDEED_SENDER, parseIndeedAlert } from './indeed-alert';

/** Alertes lues au plus par collecte (les plus récentes d'abord) et fenêtre de recherche : une alerte par jour environ. */
const MAX_MESSAGES = 50;
const WINDOW = '14d';
/** Messages lus en parallèle : assez pour aller vite, peu pour ne pas saturer l'API Gmail. */
const CONCURRENCY = 5;

const LABEL = 'Indeed (alertes e-mail)';

/** Erreur Gmail -> erreur de source : même nature, message sans détail (ni adresse, ni contenu de message). */
function toSourceError(error: GmailError): SourceError {
  return new SourceError('INDEED', error.reason, `${LABEL} : ${error.message}`);
}

/**
 * Source « alertes Indeed » : lit les e-mails d'alerte qu'Indeed envoie à la boîte Gmail de l'utilisateur. Aucun appel
 * à Indeed, aucun compte, aucun lien suivi : seule la boîte de l'utilisateur est lue, en lecture seule, et seulement
 * les messages de l'expéditeur connu (recherche Gmail bornée par expéditeur et par date).
 * Le corps est analysé en mémoire et jamais stocké : seules les annonces extraites sont enregistrées.
 */
@Injectable()
export class IndeedAlertsConnector {
  constructor(
    private readonly gmail: GmailClient,
    private readonly geocoder: GeocoderService,
  ) {}

  isConfigured(): boolean {
    return this.gmail.isConfigured();
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    if (!this.gmail.isConfigured()) {
      throw new SourceError('INDEED', 'not_configured', `${LABEL} : Gmail n'est pas configuré.`);
    }
    const offers = new Map<string, NormalizedOffer>();
    let skipped = 0;
    try {
      const ids = await this.gmail.searchMessageIds(
        `from:${INDEED_SENDER.address} newer_than:${WINDOW}`,
        MAX_MESSAGES,
      );
      for (let i = 0; i < ids.length; i += CONCURRENCY) {
        const batch = await Promise.all(
          ids.slice(i, i + CONCURRENCY).map((id) => this.gmail.messageContent(id)),
        );
        // Les messages arrivent du plus récent au plus ancien : une annonce déjà vue garde sa version la plus récente.
        for (const message of batch) {
          skipped += this.read(message, offers);
        }
      }
    } catch (error) {
      if (error instanceof GmailError) throw toSourceError(error);
      throw error;
    }

    const list = [...offers.values()];
    await locateOffers(this.geocoder, list, {
      latitude: query.latitude,
      longitude: query.longitude,
    });
    return { offers: list, skipped };
  }

  /** Ajoute les annonces d'un message ; renvoie le nombre d'éléments écartés (message douteux ou illisible). */
  private read(message: MessageContent, offers: Map<string, NormalizedOffer>): number {
    // Expéditeur et signature : un message qui n'est pas authentifié par Gmail comme venant d'Indeed est ignoré.
    if (!isAuthentic(message, INDEED_SENDER) || message.text === null) {
      return 1;
    }
    const parsed = parseIndeedAlert(message.text, message.receivedAt);
    for (const offer of parsed.offers) {
      if (!offers.has(offer.externalId)) offers.set(offer.externalId, offer);
    }
    return parsed.skipped;
  }
}
