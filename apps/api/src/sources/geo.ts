export interface Position {
  latitude: number;
  longitude: number;
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

/** Vitesse moyenne retenue : 30 km/h, soit 2 minutes par kilomètre. Sert au rayon de recherche et au brief. */
export const MINUTES_PER_KM = 2;

/** Distance arrondie au dixième de km, ou null si l'offre n'est pas localisée. */
export function roundedDistance(
  home: Position,
  latitude?: number | null,
  longitude?: number | null,
): number | null {
  if (latitude === null || latitude === undefined) return null;
  if (longitude === null || longitude === undefined) return null;
  return Math.round(distanceKm(home, { latitude, longitude }) * 10) / 10;
}
