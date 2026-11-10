import { followUpState } from '../applications/follow-up';
import type { ApplicationStatus, OfferSource, ReplyKind } from '../generated/prisma/enums';

const DAY = 86_400_000;

export interface StatsApplication {
  status: ApplicationStatus;
  appliedAt: Date | null;
  followedUpAt: Date | null;
  source: OfferSource;
  replies: { kind: ReplyKind; receivedAt: Date }[];
}

export interface StatsOffer {
  source: OfferSource;
  firstSeenAt: Date;
}

export interface SourceStats {
  source: OfferSource;
  applied: number;
  answered: number;
  interviews: number;
}

export interface Stats {
  /** Où en sont les candidatures aujourd'hui. */
  pipeline: { toReview: number; toSend: number; waiting: number; toFollowUp: number };
  /** Candidatures ENVOYÉES (date d'envoi connue) et ce qu'elles ont donné. */
  funnel: {
    applied: number;
    answered: number;
    interviews: number;
    rejections: number;
    unanswered: number;
    /** Part de candidatures ayant reçu une réponse, de 0 à 1 ; null sans candidature envoyée. */
    answerRate: number | null;
    interviewRate: number | null;
    /** Délai médian, en jours, entre l'envoi et la première réponse ; null sans réponse. */
    medianDaysToFirstReply: number | null;
  };
  bySource: SourceStats[];
  /** Huit dernières semaines (lundi de la semaine, AAAA-MM-JJ), semaines sans envoi comprises. */
  weekly: { weekStart: string; applied: number }[];
  followUps: { sent: number; answeredAfter: number };
  offers: {
    total: number;
    newThisWeek: number;
    newThisWeekBySource: { source: OfferSource; count: number }[];
  };
  /** Peu de candidatures : les pourcentages ne prouvent rien. */
  smallSample: boolean;
}

/** Seuil en dessous duquel les pourcentages sont indicatifs seulement. */
export const SMALL_SAMPLE = 5;
export const WEEKS = 8;

/** Lundi (UTC) de la semaine de cette date, à minuit. */
function mondayOf(date: Date): Date {
  const day = (date.getUTCDay() + 6) % 7; // lundi = 0
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? sorted[middle]
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return Math.round((value ?? 0) * 10) / 10;
}

const ANSWERED_STATUSES: readonly ApplicationStatus[] = ['ACKNOWLEDGED', 'INTERVIEW', 'REJECTED'];

/**
 * Chiffres du tableau de bord, calculés à partir des candidatures et des offres. Fonction pure : testée sans base.
 * « Réponse » = au moins un mail classé OU un statut posé à la main (accusé, entretien, refus).
 */
export function computeStats(
  applications: StatsApplication[],
  offers: StatsOffer[],
  now = new Date(),
): Stats {
  const count = (statuses: readonly ApplicationStatus[]) =>
    applications.filter((a) => statuses.includes(a.status)).length;

  const sent = applications.filter((a) => a.appliedAt !== null);
  const isAnswered = (a: StatsApplication) =>
    a.replies.length > 0 || ANSWERED_STATUSES.includes(a.status);
  const isInterview = (a: StatsApplication) =>
    a.status === 'INTERVIEW' || a.replies.some((r) => r.kind === 'INTERVIEW');
  const isRejection = (a: StatsApplication) =>
    a.status === 'REJECTED' || a.replies.some((r) => r.kind === 'REJECTION');

  const answered = sent.filter(isAnswered).length;
  const interviews = sent.filter(isInterview).length;
  const delays: number[] = [];
  for (const a of sent) {
    if (!a.appliedAt || a.replies.length === 0) continue;
    const first = Math.min(...a.replies.map((r) => r.receivedAt.getTime()));
    delays.push(Math.max(0, (first - a.appliedAt.getTime()) / DAY));
  }

  const bySourceMap = new Map<OfferSource, SourceStats>();
  for (const a of sent) {
    const entry = bySourceMap.get(a.source) ?? {
      source: a.source,
      applied: 0,
      answered: 0,
      interviews: 0,
    };
    entry.applied++;
    if (isAnswered(a)) entry.answered++;
    if (isInterview(a)) entry.interviews++;
    bySourceMap.set(a.source, entry);
  }

  // Huit semaines glissantes, la semaine en cours comprise : toutes présentes, même à zéro.
  const currentMonday = mondayOf(now);
  const weekly = Array.from({ length: WEEKS }, (_, i) => {
    const start = new Date(currentMonday.getTime() - (WEEKS - 1 - i) * 7 * DAY);
    const end = new Date(start.getTime() + 7 * DAY);
    return {
      weekStart: start.toISOString().slice(0, 10),
      applied: sent.filter((a) => a.appliedAt && a.appliedAt >= start && a.appliedAt < end).length,
    };
  });

  const followed = applications.filter((a) => a.followedUpAt !== null);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const newOffers = offers.filter((o) => o.firstSeenAt >= weekAgo);
  const newBySource = new Map<OfferSource, number>();
  for (const o of newOffers) newBySource.set(o.source, (newBySource.get(o.source) ?? 0) + 1);

  return {
    pipeline: {
      toReview: count(['TO_REVIEW']),
      toSend: count(['VALIDATED', 'DRAFT_CREATED']),
      waiting: count(['APPLIED', 'ACKNOWLEDGED']),
      toFollowUp: applications.filter(
        (a) =>
          followUpState(
            {
              status: a.status,
              appliedAt: a.appliedAt,
              followedUpAt: a.followedUpAt,
              lastReplyAt: a.replies.reduce<Date | null>(
                (latest, r) => (latest === null || r.receivedAt > latest ? r.receivedAt : latest),
                null,
              ),
            },
            now,
          ) === 'due',
      ).length,
    },
    funnel: {
      applied: sent.length,
      answered,
      interviews,
      rejections: sent.filter(isRejection).length,
      unanswered: sent.length - answered,
      answerRate: sent.length === 0 ? null : answered / sent.length,
      interviewRate: sent.length === 0 ? null : interviews / sent.length,
      medianDaysToFirstReply: median(delays),
    },
    bySource: [...bySourceMap.values()].sort(
      (a, b) => b.applied - a.applied || a.source.localeCompare(b.source),
    ),
    weekly,
    followUps: {
      sent: followed.length,
      answeredAfter: followed.filter((a) =>
        a.replies.some((r) => a.followedUpAt !== null && r.receivedAt > a.followedUpAt),
      ).length,
    },
    offers: {
      total: offers.length,
      newThisWeek: newOffers.length,
      newThisWeekBySource: [...newBySource.entries()]
        .map(([source, n]) => ({ source, count: n }))
        .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
    },
    smallSample: sent.length < SMALL_SAMPLE,
  };
}
