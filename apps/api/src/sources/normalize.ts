// Outils communs aux connecteurs : tout ce qui vient d'une source est une donnée non fiable.

/** Bornes sur les textes venus d'une source : ils sont stockés, puis envoyés à un modèle de langage. */
export const MAX_TITLE = 200;
export const MAX_COMPANY = 200;
export const MAX_DESCRIPTION = 10_000;

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
