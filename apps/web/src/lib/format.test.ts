import { describe, expect, it } from 'vitest';
import { ageLabel, hasPlaceholder, place, scoreTone, shortAge, wordCount } from './format';

const NOW = new Date('2026-11-10T12:00:00Z');

describe('format', () => {
  it('décrit l’âge d’une offre', () => {
    expect(ageLabel('2026-11-10T08:00:00Z', NOW)).toBe('aujourd’hui');
    expect(ageLabel('2026-11-09T08:00:00Z', NOW)).toBe('il y a 1 jour');
    expect(ageLabel('2026-11-05T08:00:00Z', NOW)).toBe('il y a 5 jours');
    expect(ageLabel(null, NOW)).toBe('date inconnue');
    expect(shortAge('2026-11-07T12:00:00Z', NOW)).toBe('3 j');
  });

  it('compte les mots', () => {
    expect(wordCount('  Bonjour   le monde\nentier ')).toBe(4);
    expect(wordCount('')).toBe(0);
  });

  it('repère les repères à compléter', () => {
    expect(hasPlaceholder('[À COMPLÉTER : fait précis] Bonjour')).toBe(true);
    expect(hasPlaceholder('Bonjour, je suis disponible.')).toBe(false);
  });

  it('formate le lieu avec le département', () => {
    expect(place('Élancourt', '78990')).toBe('Élancourt (78)');
    expect(place('Paris', null)).toBe('Paris');
    expect(place(null, null)).toBe('lieu non précisé');
  });

  it('choisit le ton du score', () => {
    expect(scoreTone(91)).toBe('high');
    expect(scoreTone(70)).toBe('mid');
    expect(scoreTone(69)).toBe('low');
    expect(scoreTone(null)).toBe('low');
  });
});
