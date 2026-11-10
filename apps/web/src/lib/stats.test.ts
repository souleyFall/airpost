import { describe, expect, it } from 'vitest';
import { percent, weekLabel } from './stats';

describe('percent', () => {
  it('arrondit, et ne dit rien quand il n’y a rien à diviser', () => {
    expect(percent(0.6)).toBe('60 %');
    expect(percent(1 / 3)).toBe('33 %');
    expect(percent(0)).toBe('0 %');
    expect(percent(null)).toBe('—');
    expect(percent(Number.NaN)).toBe('—');
  });
});

describe('weekLabel', () => {
  it('donne le lundi de la semaine, sans décalage de fuseau', () => {
    expect(weekLabel('2026-11-09')).toMatch(/^Sem\. du 9 nov/);
    expect(weekLabel('2026-09-21')).toMatch(/^Sem\. du 21 sept/);
  });
});
