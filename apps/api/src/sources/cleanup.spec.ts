import { describe, expect, it } from 'vitest';
import { type StoredOffer, planCleanup } from './cleanup';

const stored = (id: string, extra: Partial<StoredOffer> = {}): StoredOffer => ({
  id,
  source: 'ADZUNA',
  title: 'Alternance développeur web',
  description: null,
  contractType: 'AUTRE',
  ...extra,
});

describe('planCleanup', () => {
  it('supprime les offres hors développement des sources non filtrées', () => {
    const plan = planCleanup(
      [stored('dev'), stored('compta', { title: 'Alternance comptable' })],
      new Set(['LBB']),
    );
    expect(plan.deleteIds).toEqual(['compta']);
  });

  it('ne supprime jamais une offre d’une source de confiance, même au titre atypique', () => {
    const plan = planCleanup(
      [stored('x', { source: 'LBA', title: 'Mission polyvalente' })],
      new Set(['LBA', 'LBB']),
    );
    expect(plan.deleteIds).toEqual([]);
  });

  it('classe La Bonne Boîte en candidature spontanée, pas en alternance', () => {
    const plan = planCleanup(
      [
        stored('lbb', {
          source: 'LBB',
          title: 'Candidature spontanée : logiciels',
          contractType: 'ALTERNANCE',
        }),
      ],
      new Set(['LBB']),
    );
    expect(plan.contractUpdates).toEqual([{ id: 'lbb', contractType: 'SPONTANEE' }]);
  });

  it('corrige le type de contrat, seulement quand il change', () => {
    const plan = planCleanup(
      [
        stored('a'),
        stored('lba', { source: 'LBA', title: 'Développeur React' }),
        stored('ok', { contractType: 'ALTERNANCE' }),
        stored('stage', { title: 'Stage développeur', contractType: 'STAGE' }),
      ],
      new Set(['LBA']),
    );
    expect(plan.contractUpdates).toEqual([
      { id: 'a', contractType: 'ALTERNANCE' },
      { id: 'lba', contractType: 'ALTERNANCE' },
    ]);
  });

  it('ne corrige pas le contrat d’une offre qu’il supprime', () => {
    const plan = planCleanup([stored('compta', { title: 'Comptable en alternance' })], new Set());
    expect(plan.deleteIds).toEqual(['compta']);
    expect(plan.contractUpdates).toEqual([]);
  });
});
