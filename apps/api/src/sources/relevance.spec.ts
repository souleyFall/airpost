import { describe, expect, it } from 'vitest';
import { detectContractType, isRelevantOffer } from './relevance';

describe('isRelevantOffer', () => {
  it.each([
    'Alternance Développeur Full Stack',
    'Développeur(se) web en alternance',
    'Alternant ingénieur logiciel',
    'Apprenti Dev Front-End React',
    'Alternance Data Analyst',
    'Alternance DevOps',
    'Technicien informatique en alternance',
    'Alternance chargé de projet IA',
    'Alternance développeur PHP Symfony',
    'Responsable SI en alternance',
    'Alternant développeur mobile',
  ])('garde « %s »', (title) => {
    expect(isRelevantOffer(title)).toBe(true);
  });

  it.each([
    'Alternance comptable',
    'Apprenti boulanger',
    'Alternance assistant(e) RH',
    'Conseiller commercial en alternance',
    'Alternance Community Manager',
    'Vendeur en prêt-à-porter (alternance)',
    'Alternance assistant juridique',
    'Chargé de recrutement en alternance',
    // Un mot technique ne suffit pas à faire un poste de développeur.
    'Commercial web en alternance',
    'Chargé de marketing digital',
  ])('écarte « %s »', (title) => {
    expect(isRelevantOffer(title)).toBe(false);
  });

  it('l’intitulé « développeur » l’emporte sur un mot hors sujet', () => {
    expect(isRelevantOffer('Développeur logiciel pour banque')).toBe(true);
  });

  it('un intitulé neutre est gardé si la description cite au moins deux technologies', () => {
    expect(isRelevantOffer('Alternance - Mission polyvalente', 'React, TypeScript et Docker')).toBe(
      true,
    );
    expect(isRelevantOffer('Alternance - Mission polyvalente', 'Maîtrise d’Excel')).toBe(false);
    expect(isRelevantOffer('Alternance - Mission polyvalente', 'Une seule techno : Python')).toBe(
      false,
    );
    expect(isRelevantOffer('Alternance - Mission polyvalente')).toBe(false);
  });

  it('un intitulé hors sujet reste écarté même si la description cite des technologies', () => {
    expect(isRelevantOffer('Alternance comptable', 'Excel, SQL, API, Python')).toBe(false);
  });

  it('ne se laisse pas tromper par des fragments de mots (« aussi » n’est pas « SI »)', () => {
    expect(isRelevantOffer('Aussi bien en cuisine')).toBe(false);
    expect(isRelevantOffer('Assistant administratif, maîtrise de Word')).toBe(false);
  });
});

describe('detectContractType', () => {
  it.each([
    ['Alternance développeur', undefined, 'ALTERNANCE'],
    ['Développeur en contrat d’apprentissage', undefined, 'ALTERNANCE'],
    ['Apprenti développeur', undefined, 'ALTERNANCE'],
    ['Contrat de professionnalisation - dev', undefined, 'ALTERNANCE'],
    ['Stage développeur web', undefined, 'STAGE'],
    ['Stagiaire développeur', undefined, 'STAGE'],
    ['Développeur React CDI', undefined, 'CDI'],
    ['Développeur React CDD 6 mois', undefined, 'CDD'],
    ['Développeur React', undefined, 'AUTRE'],
    ['Développeur React', 'Poste en CDI à pourvoir', 'CDI'],
    ['Développeur React', 'Dans le cadre d’une alternance de 12 mois', 'ALTERNANCE'],
  ] as const)('« %s » (%s) → %s', (title, description, expected) => {
    expect(detectContractType(title, description)).toBe(expected);
  });

  it('l’intitulé prime sur la description', () => {
    expect(detectContractType('Stage développeur', 'Possibilité de CDI ensuite')).toBe('STAGE');
  });

  it('« alternance » l’emporte sur « stage » dans la description', () => {
    expect(
      detectContractType('Développeur', 'Alternance de 12 mois, après un stage de découverte'),
    ).toBe('ALTERNANCE');
  });
});
