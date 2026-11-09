/** Formes des réponses de l'API utilisées par l'interface (à garder alignées avec apps/api). */

export type ApplyChannel = 'EMAIL' | 'SITE';
export type OfferSource = 'LBA' | 'LBB' | 'ADZUNA';

export type ApplicationStatus =
  | 'TO_REVIEW'
  | 'VALIDATED'
  | 'DRAFT_CREATED'
  | 'APPLIED'
  | 'ACKNOWLEDGED'
  | 'INTERVIEW'
  | 'NO_RESPONSE'
  | 'REJECTED'
  | 'WITHDRAWN';

export interface ScoreDetail {
  total: number;
  freshness: number;
  stack: number;
  rhythm: number;
  commute: number;
  competition: number;
  channel: number;
  matchedTerms: string[];
  detectedRhythm: string | null;
  distanceKm: number | null;
  estimatedMinutes: number | null;
}

export interface ApplicationRef {
  id: string;
  status: ApplicationStatus;
}

export interface OfferSummary {
  id: string;
  source: OfferSource;
  title: string;
  company: string;
  city: string | null;
  postcode: string | null;
  channel: ApplyChannel;
  applyUrl: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
  score: number | null;
  scoreDetail: ScoreDetail | null;
  application: ApplicationRef | null;
}

export interface OfferDetail extends OfferSummary {
  description: string | null;
  contactEmail: string | null;
}

export interface OfferList {
  total: number;
  items: OfferSummary[];
}

export interface ApplicationDetail {
  id: string;
  status: ApplicationStatus;
  subject: string | null;
  body: string | null;
}

export interface LetterResult {
  applicationId: string;
  subject: string;
  body: string;
  preview: string;
  warnings: string[];
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  purged: number;
  scored: number;
}

export interface ApplicationRow {
  id: string;
  status: ApplicationStatus;
  subject: string | null;
  validatedAt: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replies: ReplyRow[];
  offer: {
    id: string;
    source: OfferSource;
    title: string;
    company: string;
    city: string | null;
    channel: ApplyChannel;
    applyUrl: string | null;
    score: number | null;
  };
}

export interface SourcesStatus {
  sources: Record<OfferSource, boolean>;
  gemini: { configured: boolean; model: string };
}

export interface SourceReport {
  source: OfferSource;
  status: 'ok' | 'disabled' | 'error';
  reason?: string;
  fetched: number;
  skipped: number;
  excluded: number;
  duplicates: number;
  created: number;
  updated: number;
}

export interface FullRunReport extends RunReport {
  sources: SourceReport[];
}

export type ReplyKind = 'ACKNOWLEDGEMENT' | 'INTERVIEW' | 'REJECTION' | 'OTHER';

export interface ReplyRow {
  id: string;
  kind: ReplyKind;
  receivedAt: string;
  snippet: string | null;
}

export interface SyncReport {
  checked: number;
  newReplies: number;
  statusChanges: number;
  noResponse: number;
  skipped: number;
  finishedAt: string;
}
