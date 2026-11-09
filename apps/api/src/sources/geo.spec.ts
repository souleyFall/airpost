import { describe, expect, it } from 'vitest';
import { distanceKm, roundedDistance } from './geo';

const MONTIGNY = { latitude: 48.7833, longitude: 2.0333 };
const PARIS = { latitude: 48.8566, longitude: 2.3522 };

describe('distanceKm', () => {
  it('vaut zéro entre deux points identiques', () => {
    expect(distanceKm(PARIS, PARIS)).toBe(0);
  });

  it('donne une distance plausible entre Montigny-le-Bretonneux et Paris (≈ 25 km)', () => {
    expect(distanceKm(MONTIGNY, PARIS)).toBeGreaterThan(22);
    expect(distanceKm(MONTIGNY, PARIS)).toBeLessThan(28);
  });

  it('est symétrique', () => {
    expect(distanceKm(MONTIGNY, PARIS)).toBeCloseTo(distanceKm(PARIS, MONTIGNY), 9);
  });
});

describe('roundedDistance', () => {
  it('arrondit au dixième de kilomètre', () => {
    const km = roundedDistance(MONTIGNY, PARIS.latitude, PARIS.longitude);
    expect(km).not.toBeNull();
    expect(Math.round((km ?? 0) * 10)).toBe((km ?? 0) * 10);
  });

  it('renvoie null pour une offre non localisée', () => {
    expect(roundedDistance(MONTIGNY, null, 2)).toBeNull();
    expect(roundedDistance(MONTIGNY, 48, undefined)).toBeNull();
  });

  it('accepte la latitude ou la longitude nulles (0 est une coordonnée valide)', () => {
    expect(roundedDistance({ latitude: 0, longitude: 0 }, 0, 0)).toBe(0);
  });
});
