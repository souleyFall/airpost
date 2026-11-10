import { describe, expect, it } from 'vitest';
import {
  ageLabel,
  hasPlaceholder,
  newOffersLabel,
  place,
  scoreTone,
  shortAge,
  wordCount,
} from './format';

const NOW = new Date('2026-11-10T12:00:00Z');

describe('newOffersLabel', () => {
  it('additionne les offres nouvelles de toutes les sources, sans compter les mises à jour', () => {
    expect(newOffersLabel([{ created: 7 }, { created: 0 }, { created: 5 }])).toBe(
      '12 nouvelles offres',
    );
    expect(newOffersLabel([{ created: 1 }, { created: 0 }])).toBe('1 nouvelle offre');
    expect(newOffersLabel([{ created: 0 }])).toBe('Aucune nouvelle offre');
    expect(newOffersLabel([])).toBe('Aucune nouvelle offre');
  });

  it('ne dit rien sans bilan par source', () => {
    expect(newOffersLabel(undefined)).toBeNull();
  });
});

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
    expect(scoreTone(75)).toBe('high');
    expect(scoreTone(74)).toBe('mid');
    expect(scoreTone(55)).toBe('mid');
    expect(scoreTone(54)).toBe('low');
    expect(scoreTone(null)).toBe('low');
  });
});
