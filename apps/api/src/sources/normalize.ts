// Outils communs aux connecteurs : tout ce qui vient d'une source est une donnée non fiable.

/** Bornes sur les textes venus d'une source : ils sont stockés, puis envoyés à un modèle de langage. */
export const MAX_TITLE = 200;
export const MAX_COMPANY = 200;
export const MAX_DESCRIPTION = 10_000;

/** Nom donné à une offre dont la source ne publie pas l'entreprise (exclu du dédoublonnage entre sources). */
export const UNKNOWN_COMPANY = 'Entreprise non indiquée';

/** Seules les URL http(s) sont conservées : un « javascript: » venu d'une source ne doit jamais atteindre l'interface. */
export function safeUrl(value?: string | null): string | undefined {
  if (!value || !URL.canParse(value)) {
    return undefined;
  }
  const { protocol } = new URL(value);
  return protocol === 'https:' || protocol === 'http:' ? value : undefined;
}

export function toDate(value?: string | null): Date | undefined {
  const date = value ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

/** Texte rogné et borné ; undefined s'il est vide. */
export function cleanText(value: string | null | undefined, max: number): string | undefined {
  return value?.trim().slice(0, max) || undefined;
}

/** La requête de recherche est-elle exploitable ? (pas de NaN, rayon positif) */
export function isValidGeoQuery(q: {
  latitude: number;
  longitude: number;
  radiusKm: number;
}): boolean {
  return (
    Number.isFinite(q.latitude) &&
    Number.isFinite(q.longitude) &&
    Number.isFinite(q.radiusKm) &&
    q.radiusKm > 0
  );
}

const DAY_MS = 86_400_000;

/**
 * « Il y a 3 jours », « il y a 8 heures », « il y a 1 mois », « 3 days ago » → date approximative.
 * Google n'indique qu'un âge arrondi : c'est une estimation, suffisante pour trier par fraîcheur.
 */
export function parsePostedAt(text: string | null | undefined, now: Date): Date | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase().replace(/[’‘]/g, "'");
  if (/aujourd|today|à l'instant|just now/.test(t)) return now;
  const match =
    /(\d{1,3})\s*\+?\s*(minute|min|heure|h|hour|jour|j|day|semaine|week|mois|month)/.exec(t);
  if (!match) return undefined;
  const n = Number(match[1]);
  const unit = match[2] ?? '';
  let ms: number;
  if (/^(minute|min)/.test(unit)) ms = n * 60_000;
  else if (/^(heure|h|hour)/.test(unit)) ms = n * 3_600_000;
  else if (/^(jour|j|day)/.test(unit)) ms = n * DAY_MS;
  else if (/^(semaine|week)/.test(unit)) ms = n * 7 * DAY_MS;
  else ms = n * 30 * DAY_MS;
  return new Date(now.getTime() - ms);
}
