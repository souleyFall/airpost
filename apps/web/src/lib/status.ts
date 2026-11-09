import type { ApplicationStatus } from '../api/types';

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  TO_REVIEW: 'À valider',
  VALIDATED: 'Validée',
  DRAFT_CREATED: 'Brouillon créé',
  APPLIED: 'Envoyée',
  ACKNOWLEDGED: 'Accusé',
  INTERVIEW: 'Entretien',
  NO_RESPONSE: 'Sans réponse',
  REJECTED: 'Refus',
  WITHDRAWN: 'Retirée',
};

/**
 * Passages que l'utilisateur peut demander à la main. Copie de apps/api/src/applications/transitions.ts
 * (sans DRAFT_CREATED, réservé à Gmail) : l'API reste l'autorité, elle refuse tout passage invalide (409).
 * Le test `status.test.ts` fige cette table.
 */
export const MANUAL_NEXT: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  TO_REVIEW: ['VALIDATED', 'WITHDRAWN'],
  VALIDATED: ['TO_REVIEW', 'APPLIED', 'WITHDRAWN'],
  DRAFT_CREATED: ['VALIDATED', 'APPLIED', 'WITHDRAWN'],
  APPLIED: ['ACKNOWLEDGED', 'INTERVIEW', 'REJECTED', 'NO_RESPONSE', 'WITHDRAWN'],
  ACKNOWLEDGED: ['INTERVIEW', 'REJECTED', 'NO_RESPONSE', 'WITHDRAWN'],
  INTERVIEW: ['REJECTED', 'WITHDRAWN'],
  NO_RESPONSE: ['ACKNOWLEDGED', 'INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  REJECTED: [],
  WITHDRAWN: [],
};

/** Délai après lequel une candidature envoyée sans réponse devient « à relancer ». */
export const FOLLOW_UP_DAYS = 14;

const DAY = 86_400_000;

export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY));
}

export function needsFollowUp(
  status: ApplicationStatus,
  appliedAt: string | null,
  now: Date = new Date(),
): boolean {
  const days = daysSince(appliedAt, now);
  return status === 'APPLIED' && days !== null && days >= FOLLOW_UP_DAYS;
}

export function shortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
