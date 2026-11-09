import type { ApplyChannel, OfferSource } from '../generated/prisma/enums';

/** Une offre dans le format commun à toutes les sources (voir le modèle `Offer`). */
export interface NormalizedOffer {
  source: OfferSource;
  /** Identifiant chez la source : sert à ne pas réimporter la même offre. */
  externalId: string;
  title: string;
  company: string;
  city?: string;
  postcode?: string;
  latitude?: number;
  longitude?: number;
  description?: string;
  applyUrl?: string;
  /** Donnée d'un tiers (recruteur) : seulement si la source la publie. */
  contactEmail?: string;
  channel: ApplyChannel;
  publishedAt?: Date;
}

export interface SearchQuery {
  latitude: number;
  longitude: number;
  radiusKm: number;
  romeCodes: string[];
  /** Nom de la ville (pour les sources qui cherchent par lieu plutôt que par coordonnées). */
  where?: string;
  /** Mots-clés de la pile technique (pour les sources qui cherchent par texte). */
  keywords?: string[];
}

export interface SearchResult {
  offers: NormalizedOffer[];
  /** Entrées de la réponse que l'on n'a pas pu lire (format inattendu) : comptées, jamais détaillées. */
  skipped: number;
}

/** Erreur d'une source, sans détail sensible : ni clé, ni en-têtes, ni corps de réponse. */
export class SourceError extends Error {
  constructor(
    readonly source: OfferSource,
    readonly reason: 'not_configured' | 'unauthorized' | 'rate_limited' | 'unavailable' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}
