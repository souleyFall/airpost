import type { ApplyChannel, OfferSource } from '../generated/prisma/enums';
import type { Profile } from '../profile/profile.schema';

/**
 * Grille de score sur 100 : fraîcheur 25, pile technique 25, rythme 15, trajet 15, concurrence 10, canal 10.
 * Fonctions pures (aucun accès à la base ni au réseau) : le même profil et la même offre donnent toujours
 * le même score, ce qui permet de tester chaque critère et de régler les seuils sans surprise.
 * Les seuils ci-dessous sont des réglages initiaux, à ajuster à l'usage ; chaque score garde son détail
 * pour que l'interface puisse expliquer « pourquoi 74 ? ».
 */
export const MAX_POINTS = {
  freshness: 25,
  stack: 25,
  rhythm: 15,
  commute: 15,
  competition: 10,
  channel: 10,
} as const;

export interface ScorableOffer {
  source: OfferSource;
  title: string;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  applyUrl?: string | null;
  contactEmail?: string | null;
  channel: ApplyChannel;
  publishedAt?: Date | null;
  firstSeenAt: Date;
}

export interface Position {
  latitude: number;
  longitude: number;
}

export interface ScoreDetail {
  total: number;
  freshness: number;
  stack: number;
  rhythm: number;
  commute: number;
  competition: number;
  channel: number;
  /** Compétences et mots-clés du profil retrouvés dans l'offre. */
  matchedTerms: string[];
  /** Rythme repéré dans le texte de l'offre, s'il y en a un. */
  detectedRhythm: string | null;
  /** Distance à vol d'oiseau et temps de trajet estimé, si l'offre est localisée. */
  distanceKm: number | null;
  estimatedMinutes: number | null;
}

/** Texte comparable : sans accents, en minuscules. */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Fraîcheur (25) : une offre récente reçoit moins de candidatures et a plus de chances d'être encore ouverte. */
export function scoreFreshness(
  offer: Pick<ScorableOffer, 'publishedAt' | 'firstSeenAt'>,
  now: Date,
): number {
  const reference = offer.publishedAt ?? offer.firstSeenAt;
  const days = Math.max(0, (now.getTime() - reference.getTime()) / 86_400_000);
  if (days <= 3) return 25;
  if (days <= 7) return 20;
  if (days <= 14) return 15;
  if (days <= 30) return 8;
  return 3;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Termes techniques du profil : mots-clés de recherche et compétences, sans doublon. */
export function profileTerms(profile: Profile): string[] {
  const all = [
    ...profile.search.keywords,
    ...profile.skills.languages,
    ...profile.skills.frameworks,
    ...profile.skills.tools,
  ];
  return [...new Map(all.map((term) => [fold(term.trim()), term.trim()])).values()].filter(Boolean);
}

/** Nombre de termes distincts à retrouver pour obtenir tous les points de la pile : au-delà, inutile d'insister. */
const STACK_TARGET = 4;

/** Pile technique (25) : part des termes du profil retrouvés dans l'intitulé et la description. */
export function scoreStack(
  offer: Pick<ScorableOffer, 'title' | 'description'>,
  profile: Profile,
): { points: number; matched: string[] } {
  const text = fold(`${offer.title}\n${offer.description ?? ''}`);
  const matched = profileTerms(profile).filter((term) => {
    // Le terme doit être un mot entier : « go » ne doit pas être trouvé dans « mongo ».
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(fold(term))}($|[^a-z0-9])`);
    return pattern.test(text);
  });
  const points = Math.round(MAX_POINTS.stack * Math.min(1, matched.length / STACK_TARGET));
  return { points, matched };
}

type Rhythm = 'ONE_ONE' | 'TWO_THREE' | 'THREE_TWO' | 'OTHER';

const RHYTHM_LABEL: Record<Rhythm, string> = {
  ONE_ONE: '1S_1S',
  TWO_THREE: '2J_3J',
  THREE_TWO: '3J_2J',
  OTHER: 'AUTRE',
};

/** Rythme annoncé dans le texte : « 2 jours en entreprise / 3 jours en cours », « 1 semaine / 1 semaine »... */
export function detectRhythm(text: string): Rhythm | null {
  const t = fold(text);
  if (/1 semaine[^.\d]{0,40}1 semaine|1s ?[/-] ?1s|une semaine sur deux|1 semaine sur 2/.test(t)) {
    return 'ONE_ONE';
  }
  // « N jours ... M jours » n'est un rythme que si l'entreprise, l'école ou le rythme sont évoqués tout près
  // (fenêtre de 60 caractères autour des deux durées), ou sous la forme compacte « 2j/3j » : « 5 jours de
  // congés, 2 jours de télétravail » n'en est pas un.
  const context = /entreprise|ecole|cfa|cours|formation|rythme|alternance|presentiel/;
  const pairs = /(\d) ?j(?:ours?)?\b[^\d]{0,40}?(\d) ?j(?:ours?)?\b/g;
  for (const match of t.matchAll(pairs)) {
    const start = match.index;
    const window = t.slice(Math.max(0, start - 60), start + match[0].length + 60);
    // Forme compacte : « 2j/3j », « 2 jours / 3 jours » (un séparateur entre les deux durées).
    const compact = /\d ?j(?:ours?)?\b ?[/-] ?\d ?j(?:ours?)?\b/.test(match[0]);
    if (compact || context.test(window)) {
      const pair = `${match[1]}${match[2]}`;
      if (pair === '23') return 'TWO_THREE';
      if (pair === '32') return 'THREE_TWO';
      return 'OTHER';
    }
  }
  return null;
}

/** Rythme (15) : conforme à ce que le candidat accepte = tout ; rythme inconnu = neutre ; incompatible = presque rien. */
export function scoreRhythm(
  offer: Pick<ScorableOffer, 'title' | 'description'>,
  profile: Profile,
): { points: number; detected: string | null } {
  const detected = detectRhythm(`${offer.title}\n${offer.description ?? ''}`);
  if (!detected) {
    // Beaucoup d'offres ne disent rien : on ne pénalise pas, on ne récompense pas non plus.
    return { points: 8, detected: null };
  }
  const label = RHYTHM_LABEL[detected];
  const accepted = (profile.search.rhythms as readonly string[]).includes(label);
  return { points: accepted ? MAX_POINTS.rhythm : 2, detected: label };
}

const EARTH_RADIUS_KM = 6371;

/** Distance à vol d'oiseau en kilomètres (formule de haversine). */
export function distanceKm(a: Position, b: Position): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Vitesse moyenne retenue : 30 km/h, soit 2 minutes par kilomètre. Aussi utilisée pour le rayon de recherche. */
export const MINUTES_PER_KM = 2;

/** Trajet (15) : plein tarif sous la moitié du temps accepté, dégressif jusqu'au maximum, rien au-delà. */
export function scoreCommute(
  offer: Pick<ScorableOffer, 'latitude' | 'longitude'>,
  home: Position,
  maxMinutes: number,
): { points: number; km: number | null; minutes: number | null } {
  if (offer.latitude === null || offer.latitude === undefined) {
    return { points: 7, km: null, minutes: null };
  }
  if (offer.longitude === null || offer.longitude === undefined) {
    return { points: 7, km: null, minutes: null };
  }
  const km = distanceKm(home, { latitude: offer.latitude, longitude: offer.longitude });
  const minutes = Math.round(km * MINUTES_PER_KM);
  let points: number;
  if (minutes <= maxMinutes / 2) {
    points = MAX_POINTS.commute;
  } else if (minutes <= maxMinutes) {
    // De 15 à 5 points entre la moitié et la totalité du temps accepté.
    const share = (minutes - maxMinutes / 2) / (maxMinutes / 2);
    points = Math.round(MAX_POINTS.commute - share * 10);
  } else {
    points = 0;
  }
  return { points, km: Math.round(km * 10) / 10, minutes };
}

/**
 * Concurrence (10) : estimée par la source, faute de nombre de candidats publié. Une candidature spontanée
 * (La Bonne Boîte) n'est en concurrence avec aucune autre annonce ; le portail officiel de l'alternance
 * est très fréquenté ; un agrégateur l'est encore plus (la même annonce y est vue partout).
 */
export function scoreCompetition(offer: Pick<ScorableOffer, 'source'>): number {
  switch (offer.source) {
    case 'LBB':
      return 8;
    case 'LBA':
      return 5;
    case 'ADZUNA':
      return 3;
  }
}

/** Canal (10) : un e-mail direct se prépare en un clic ; un site demande du temps, surtout sans lien direct. */
export function scoreChannel(
  offer: Pick<ScorableOffer, 'channel' | 'applyUrl' | 'contactEmail'>,
): number {
  if (offer.channel === 'EMAIL' && offer.contactEmail) return 10;
  if (offer.applyUrl) return 6;
  return 2;
}

/** Score complet d'une offre, avec le détail de chaque critère. */
export function scoreOffer(
  offer: ScorableOffer,
  profile: Profile,
  home: Position,
  now: Date,
): ScoreDetail {
  const freshness = scoreFreshness(offer, now);
  const stack = scoreStack(offer, profile);
  const rhythm = scoreRhythm(offer, profile);
  const commute = scoreCommute(offer, home, profile.search.maxCommuteMinutes);
  const competition = scoreCompetition(offer);
  const channel = scoreChannel(offer);
  return {
    total: freshness + stack.points + rhythm.points + commute.points + competition + channel,
    freshness,
    stack: stack.points,
    rhythm: rhythm.points,
    commute: commute.points,
    competition,
    channel,
    matchedTerms: stack.matched,
    detectedRhythm: rhythm.detected,
    distanceKm: commute.km,
    estimatedMinutes: commute.minutes,
  };
}
