import type { ApplicationStatus } from '../generated/prisma/enums';

/** Délai avant de relancer : une relance trop tôt agace, trop tard n'a plus d'effet (7 à 10 jours recommandés). */
export const FOLLOW_UP_AFTER_DAYS = 8;
/** Au-delà, la relance n'a plus de sens : on ne la propose plus (la candidature reste suivie). */
export const FOLLOW_UP_MAX_DAYS = 30;
/** Délai après la relance au-delà duquel on propose de classer la candidature « sans suite ». */
export const GIVE_UP_AFTER_DAYS = 10;

const DAY = 86_400_000;

/**
 * Statuts pour lesquels une relance a un sens : candidature envoyée sans entretien ni refus. « Sans réponse » en fait
 * partie : la synchronisation Gmail classe ainsi une candidature après 14 jours, et la relance reste possible une fois.
 */
export const FOLLOW_UP_STATUSES: readonly ApplicationStatus[] = [
  'APPLIED',
  'ACKNOWLEDGED',
  'NO_RESPONSE',
];

/**
 * - `due` : envoyée depuis assez longtemps (et pas trop), sans nouvelle, jamais relancée → à relancer ;
 * - `done` : relancée, on attend ;
 * - `give_up` : relancée depuis assez longtemps sans réponse → proposer « sans suite » ;
 * - `null` : rien à faire (trop tôt, trop tard, ou candidature qui n'est pas dans l'attente d'une réponse).
 */
export type FollowUpState = 'due' | 'done' | 'give_up' | null;

export interface FollowUpInput {
  status: ApplicationStatus;
  appliedAt: Date | null;
  followedUpAt: Date | null;
  /** Date du dernier message reçu (accusé de réception compris), le cas échéant. */
  lastReplyAt: Date | null;
}

const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY;

export function followUpState(application: FollowUpInput, now = new Date()): FollowUpState {
  if (!FOLLOW_UP_STATUSES.includes(application.status)) return null;
  if (application.followedUpAt) {
    // Déjà « sans réponse » : rien à proposer de plus que d'attendre.
    return application.status !== 'NO_RESPONSE' &&
      daysBetween(application.followedUpAt, now) >= GIVE_UP_AFTER_DAYS
      ? 'give_up'
      : 'done';
  }
  if (!application.appliedAt) return null;
  // Dernier contact : l'envoi, ou le dernier message reçu s'il est plus récent (un accusé de réception repart le délai).
  const lastContact =
    application.lastReplyAt && application.lastReplyAt > application.appliedAt
      ? application.lastReplyAt
      : application.appliedAt;
  const days = daysBetween(lastContact, now);
  return days >= FOLLOW_UP_AFTER_DAYS && days <= FOLLOW_UP_MAX_DAYS ? 'due' : null;
}
