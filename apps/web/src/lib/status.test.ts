import { describe, expect, it } from 'vitest';
import { MANUAL_NEXT, daysSince } from './status';

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
});
