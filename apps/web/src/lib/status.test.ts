import { describe, expect, it } from 'vitest';
import { MANUAL_NEXT, daysSince, needsFollowUp } from './status';

const NOW = new Date('2026-11-20T12:00:00Z');

describe('statuts', () => {
  it('ne propose jamais le brouillon Gmail, réservé au module Gmail', () => {
    for (const targets of Object.values(MANUAL_NEXT)) {
      expect(targets).not.toContain('DRAFT_CREATED');
    }
  });

  it('les statuts finaux n’ont aucune suite', () => {
    expect(MANUAL_NEXT.REJECTED).toEqual([]);
    expect(MANUAL_NEXT.WITHDRAWN).toEqual([]);
  });

  it('compte les jours depuis l’envoi', () => {
    expect(daysSince('2026-11-10T12:00:00Z', NOW)).toBe(10);
    expect(daysSince(null, NOW)).toBeNull();
  });

  it('signale « à relancer » seulement pour une candidature envoyée depuis 14 jours ou plus', () => {
    expect(needsFollowUp('APPLIED', '2026-11-06T12:00:00Z', NOW)).toBe(true);
    expect(needsFollowUp('APPLIED', '2026-11-07T12:00:00Z', NOW)).toBe(false);
    expect(needsFollowUp('ACKNOWLEDGED', '2026-10-01T12:00:00Z', NOW)).toBe(false);
    expect(needsFollowUp('APPLIED', null, NOW)).toBe(false);
  });
});
