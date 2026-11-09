import type { ApplicationStatus } from '../generated/prisma/enums';

/**
 * Cycle de vie d'une candidature. Une seule définition, utilisée par l'API et testée en entier :
 *
 *   à valider ⇄ validée → brouillon Gmail → postulée → accusé → entretien → ...
 *
 * Les statuts « DRAFT_CREATED » et les réponses (accusé, entretien, refus) sont posés par le module Gmail
 * (PR n°20 et n°21), jamais à la main : l'utilisateur ne peut pas prétendre qu'un brouillon existe.
 */
export const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  TO_REVIEW: ['VALIDATED', 'WITHDRAWN'],
  VALIDATED: ['TO_REVIEW', 'DRAFT_CREATED', 'APPLIED', 'WITHDRAWN'],
  DRAFT_CREATED: ['VALIDATED', 'APPLIED', 'WITHDRAWN'],
  APPLIED: ['ACKNOWLEDGED', 'INTERVIEW', 'REJECTED', 'NO_RESPONSE', 'WITHDRAWN'],
  ACKNOWLEDGED: ['INTERVIEW', 'REJECTED', 'NO_RESPONSE', 'WITHDRAWN'],
  INTERVIEW: ['REJECTED', 'WITHDRAWN'],
  NO_RESPONSE: ['ACKNOWLEDGED', 'INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  REJECTED: [],
  WITHDRAWN: [],
};

/** Statuts que seul le module Gmail peut poser. */
export const AUTOMATIC_ONLY: readonly ApplicationStatus[] = ['DRAFT_CREATED'];

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Transition autorisée à l'utilisateur depuis l'API (hors statuts réservés à l'automatisme). */
export function canTransitionManually(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return canTransition(from, to) && !AUTOMATIC_ONLY.includes(to);
}

export const TERMINAL: readonly ApplicationStatus[] = (
  Object.keys(TRANSITIONS) as ApplicationStatus[]
).filter((status) => TRANSITIONS[status].length === 0);
