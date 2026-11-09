import type { OfferSource } from '../generated/prisma/enums';
import { SourceError } from './source.types';

/**
 * Traduction unique d'un statut HTTP en erreur de source, pour tous les connecteurs. Le message ne contient
 * ni secret, ni URL, ni corps de réponse : seulement le nom de la source et la nature du problème.
 */
export function assertOk(response: Response, source: OfferSource, label: string): void {
  const { status } = response;
  if (status === 401 || status === 403) {
    throw new SourceError(source, 'unauthorized', `${label} : accès refusé (clés ou jeton).`);
  }
  if (status === 429) {
    throw new SourceError(source, 'rate_limited', `${label} : trop d’appels, réessayer plus tard.`);
  }
  if (status === 400 || status === 422) {
    // Notre requête est fautive : inutile de la réessayer telle quelle.
    throw new SourceError(source, 'invalid', `${label} : requête refusée (${status}).`);
  }
  if (!response.ok) {
    throw new SourceError(source, 'unavailable', `${label} : réponse ${status}.`);
  }
}
