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

export type ContractType = 'ALTERNANCE' | 'STAGE' | 'CDI' | 'CDD' | 'AUTRE';

export type Verdict = 'excellent' | 'good' | 'fair' | 'weak' | 'off_target';

/** Analyse de l'offre par le modèle de langage, validée côté API. */
export interface Analysis {
  verdict: Verdict;
  /** Une phrase qui justifie le score. */
  summary: string;
  /** Raison d'écarter l'offre (hors métier, contrat incompatible...), sinon null. */
  disqualifier: string | null;
  strengths: string[];
  gaps: string[];
  brief: {
    company: string | null;
    stack: string[];
    wantedProfile: string | null;
    rhythm: string | null;
  };
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
  contractType: ContractType;
  /** Distance à vol d'oiseau depuis ton domicile, en km ; null si l'offre n'est pas localisée. */
  distanceKm: number | null;
  applyUrl: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
  /** Taux de compatibilité calculé par l'IA ; null tant que l'offre n'est pas analysée. */
  score: number | null;
  application: ApplicationRef | null;
}

export interface OfferDetail extends OfferSummary {
  description: string | null;
  contactEmail: string | null;
  analysis: Analysis | null;
  analyzedAt: string | null;
  /** Écartée par l'IA : n'apparaît plus dans le fil « À valider ». */
  excluded: boolean;
}

export interface OfferList {
  total: number;
  limit: number;
  offset: number;
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
  analyzed: number;
  pendingAnalysis: number;
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
  irrelevant: number;
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
