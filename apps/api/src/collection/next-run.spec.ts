import { describe, expect, it } from 'vitest';
import { nextDailyRun } from './next-run';

const iso = (ms: number) => new Date(ms).toISOString();

describe('nextDailyRun (heure de Paris)', () => {
  it('hiver (UTC+1) : 08:30 à Paris = 07:30 UTC, le jour même si l’heure n’est pas passée', () => {
    const now = Date.parse('2026-11-10T06:00:00Z');
    expect(iso(nextDailyRun(now, '08:30'))).toBe('2026-11-10T07:30:00.000Z');
  });

  it('le lendemain quand l’heure est déjà passée', () => {
    const now = Date.parse('2026-11-10T09:00:00Z');
    expect(iso(nextDailyRun(now, '08:30'))).toBe('2026-11-11T07:30:00.000Z');
  });

  it('jamais à l’instant même : strictement dans le futur', () => {
    const now = Date.parse('2026-11-10T07:30:00Z');
    expect(iso(nextDailyRun(now, '08:30'))).toBe('2026-11-11T07:30:00.000Z');
  });

  it('été (UTC+2) : 08:30 à Paris = 06:30 UTC', () => {
    const now = Date.parse('2026-07-10T01:00:00Z');
    expect(iso(nextDailyRun(now, '08:30'))).toBe('2026-07-10T06:30:00.000Z');
  });

  it('passage à l’heure d’été (29 mars 2026) : l’heure murale reste 08:30', () => {
    const now = Date.parse('2026-03-28T10:00:00Z');
    expect(iso(nextDailyRun(now, '08:30'))).toBe('2026-03-29T06:30:00.000Z');
  });

  it('passage à l’heure d’hiver (25 octobre 2026)', () => {
    const now = Date.parse('2026-10-24T10:00:00Z');
    expect(iso(nextDailyRun(now, '08:30'))).toBe('2026-10-25T07:30:00.000Z');
  });
});
