const DAY = 86_400_000;

/**
 * Bilan d'une collecte en une phrase : le nombre d'offres NOUVELLES, c'est-à-dire qui n'étaient pas encore en base
 * (les offres déjà connues et simplement revues ne comptent pas).
 */
export function newOffersLabel(sources: { created: number }[] | undefined): string | null {
  if (!sources) return null;
  const created = sources.reduce((total, source) => total + source.created, 0);
  if (created === 0) return 'Aucune nouvelle offre';
  return created === 1 ? '1 nouvelle offre' : `${created} nouvelles offres`;
}

/** « aujourd’hui », « hier », « il y a 3 jours » : la fraîcheur d'une offre en un coup d'œil. */
export function ageLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) {
    return 'date inconnue';
  }
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);
  if (days <= 0) return 'aujourd’hui';
  if (days === 1) return 'il y a 1 jour';
  return `il y a ${days} jours`;
}

/** Version courte pour les listes : « 1 j », « 3 j ». */
export function shortAge(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const days = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY));
  return days === 0 ? 'auj.' : `${days} j`;
}

/** Offre rejetée : le temps qu'il reste pour la restaurer avant que son contenu soit supprimé. */
export function expiryLabel(expiresAt: string, now: Date = new Date()): string {
  const remaining = new Date(expiresAt).getTime() - now.getTime();
  if (remaining <= 0) return 'Suppression imminente';
  if (remaining < DAY) return 'Supprimée dans moins de 24 h';
  const days = Math.ceil(remaining / DAY);
  return days === 1 ? 'Supprimée dans 1 jour' : `Supprimée dans ${days} jours`;
}

export function wordCount(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

/** Bornes imposées par les garde-fous de l'API (apps/api/src/letters/guardrails.ts). */
export const MIN_WORDS = 120;
export const MAX_WORDS = 350;

/** Repères du type [À COMPLÉTER ...] laissés dans le texte : une lettre qui en contient ne doit pas partir. */
const PLACEHOLDER = /\[[^\]\n]{1,60}\]/;

export function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text);
}

export function place(city: string | null, postcode: string | null): string {
  if (city && postcode) return `${city} (${postcode.slice(0, 2)})`;
  return city ?? 'lieu non précisé';
}

export const SOURCE_LABEL = {
  LBA: 'La Bonne Alternance',
  LBB: 'La Bonne Boîte',
  // Mention d'attribution exigée par les conditions d'utilisation d'Adzuna.
  ADZUNA: 'Jobs by Adzuna',
  GOOGLE_JOBS: 'Google Jobs',
  GLASSDOOR: 'Glassdoor',
  INDEED: 'Indeed',
  LINKEDIN: 'LinkedIn',
  MANUAL: 'Ajoutée à la main',
} as const;

/** Classe de couleur du badge de compatibilité (≥75 plein, ≥55 contour, sinon discret) : mêmes seuils que le verdict de l'API. */
export function scoreTone(score: number | null): 'high' | 'mid' | 'low' {
  if (score !== null && score >= 75) return 'high';
  if (score !== null && score >= 55) return 'mid';
  return 'low';
}

export const CONTRACT_LABEL = {
  ALTERNANCE: 'Alternance',
  STAGE: 'Stage',
  CDI: 'CDI',
  CDD: 'CDD',
  SPONTANEE: 'Spontanée',
  AUTRE: 'Contrat non précisé',
} as const;

export const VERDICT_LABEL = {
  excellent: 'Excellente piste',
  good: 'Bonne piste',
  fair: 'Piste possible',
  weak: 'Peu adaptée',
  off_target: 'Hors cible',
} as const;

/** « 12 km » ou « < 1 km » ; chaîne vide si l'offre n'est pas localisée. */
export function distanceLabel(km: number | null): string {
  if (km === null) return '';
  return km < 1 ? '< 1 km' : `${Math.round(km)} km`;
}
