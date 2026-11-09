import type { ApplicationStatus, ReplyKind } from '../generated/prisma/enums';

/** Texte comparable : sans accents, en minuscules, apostrophes typographiques unifiées. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’‘`]/g, "'");
}

// Expressions repérées dans l'objet et l'extrait du message. Volontairement prudentes : mieux vaut « autre »
// (l'utilisateur corrige d'un clic) qu'un refus déclaré à tort.
const REJECTION = [
  'ne donnons pas suite',
  'ne pouvons pas donner suite',
  'ne pouvons donner suite',
  'ne pouvons pas donner une suite favorable',
  'pas retenu',
  "n'a pas ete retenu",
  "n'avons pas retenu",
  'ne retenons pas',
  'ne correspond pas',
  'au regret de',
  'nous regrettons',
  'we regret',
  'not moving forward',
  'will not be moving forward',
  'unfortunately we',
];
const INTERVIEW = [
  'entretien',
  'echange telephonique',
  'appel telephonique',
  'echanger avec vous',
  'echanger ensemble',
  'rendez-vous',
  'visioconference',
  ' visio',
  'vos disponibilites',
  'quelles sont vos disponibilites',
  'rencontrer',
  'interview',
  'schedule a call',
];
const ACKNOWLEDGEMENT = [
  'bien recu votre candidature',
  'avons bien recu',
  'accuse de reception',
  'candidature a bien ete',
  'nous avons recu votre',
  'prise en compte de votre candidature',
  'we received your application',
  'thank you for applying',
  'merci pour votre candidature',
];

function matches(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

/**
 * Classement par règles (aucun envoi du texte à un service externe : RGPD). Ordre de priorité : un refus
 * l'emporte sur un accusé (« bien reçu… mais nous ne donnons pas suite »), un entretien sur un accusé.
 */
export function classifyReply(message: { subject: string; snippet: string }): ReplyKind {
  const text = fold(`${message.subject} ${message.snippet}`);
  if (matches(text, REJECTION)) return 'REJECTION';
  if (matches(text, INTERVIEW)) return 'INTERVIEW';
  if (matches(text, ACKNOWLEDGEMENT)) return 'ACKNOWLEDGEMENT';
  return 'OTHER';
}

const KIND_STATUS: Record<ReplyKind, ApplicationStatus | null> = {
  REJECTION: 'REJECTED',
  INTERVIEW: 'INTERVIEW',
  ACKNOWLEDGEMENT: 'ACKNOWLEDGED',
  OTHER: null,
};

/** Statuts dont la valeur découle des réponses reçues (les autres sont décidés par l'utilisateur). */
const REPLY_DRIVEN: readonly ApplicationStatus[] = [
  'APPLIED',
  'ACKNOWLEDGED',
  'INTERVIEW',
  'REJECTED',
  'NO_RESPONSE',
];

export function isReplyDriven(status: ApplicationStatus): boolean {
  return REPLY_DRIVEN.includes(status);
}

/** Statut qui résulte d'un ensemble de réponses : refus > entretien > accusé > envoyée. */
export function statusFromReplies(kinds: ReplyKind[]): ApplicationStatus {
  for (const kind of ['REJECTION', 'INTERVIEW', 'ACKNOWLEDGEMENT'] as const) {
    if (kinds.includes(kind)) {
      return KIND_STATUS[kind] ?? 'APPLIED';
    }
  }
  return 'APPLIED';
}
