import { describe, expect, it } from 'vitest';
import { dedupKey } from './dedup';

describe('dedupKey', () => {
  it('ignore la casse, les accents et la ponctuation', () => {
    expect(dedupKey('Société Générale', 'Développeur Full-Stack (H/F)', 'Paris')).toBe(
      dedupKey('SOCIETE GENERALE', 'developpeur full stack h f', 'PARIS'),
    );
  });

  it('distingue deux entreprises, deux intitulés et deux villes', () => {
    const base = dedupKey('Exemple SA', 'Développeur', 'Paris');

    expect(dedupKey('Autre SA', 'Développeur', 'Paris')).not.toBe(base);
    expect(dedupKey('Exemple SA', 'Testeur', 'Paris')).not.toBe(base);
    expect(dedupKey('Exemple SA', 'Développeur', 'Lyon')).not.toBe(base);
  });

  it('accepte une ville absente', () => {
    expect(dedupKey('Exemple SA', 'Développeur')).toBe('exemple-sa|developpeur|');
  });
});
