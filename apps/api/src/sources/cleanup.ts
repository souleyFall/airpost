import type { ContractType, OfferSource } from '../generated/prisma/enums';
import { detectContractType, isRelevantOffer, isSchoolAd } from './relevance';

export interface StoredOffer {
  id: string;
  source: OfferSource;
  title: string;
  company: string;
  description: string | null;
  contractType: ContractType;
}

export interface CleanupPlan {
  /** Offres hors développement, à supprimer. */
  deleteIds: string[];
  /** Offres dont le type de contrat doit être corrigé. */
  contractUpdates: { id: string; contractType: ContractType }[];
}

/**
 * Remise à niveau des offres déjà enregistrées avec les règles actuelles : le filtre de pertinence et la détection
 * du contrat évoluent, les offres collectées avant ne doivent pas rester sur les anciennes règles.
 * `trusted` : sources déjà filtrées par code ROME à la source, jamais supprimées ici.
 */
export function planCleanup(offers: StoredOffer[], trusted: ReadonlySet<OfferSource>): CleanupPlan {
  const deleteIds: string[] = [];
  const contractUpdates: CleanupPlan['contractUpdates'] = [];
  for (const offer of offers) {
    if (
      !trusted.has(offer.source) &&
      (!isRelevantOffer(offer.title, offer.description) ||
        isSchoolAd(offer.company, offer.description))
    ) {
      deleteIds.push(offer.id);
      continue;
    }
    const contractType = detectContractType(offer.title, offer.description, offer.source);
    if (contractType !== offer.contractType) contractUpdates.push({ id: offer.id, contractType });
  }
  return { deleteIds, contractUpdates };
}
