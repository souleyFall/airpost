import { describe, expect, it } from 'vitest';
import { type Profile, emptyForm, splitList, toForm, toPayload } from './profileForm';

const profile: Profile = {
  identity: {
    firstName: 'Souleymane',
    lastName: 'Fall',
    phone: '+33 6 00 00 00 00',
    city: 'Montigny-le-Bretonneux',
    postcode: '78180',
  },
  headline: 'Développeur Full Stack & IA',
  summary: 'Résumé',
  education: [
    { school: 'IPSSI', degree: 'Master', startYear: 2026 },
    { school: 'IPSSI', degree: 'Bachelor', startYear: 2025, endYear: 2025 },
  ],
  experiences: [
    { company: 'Bridgeness', role: 'Stage', startDate: '2026-07', achievements: [] },
    {
      company: 'Cash Flow Positif',
      role: 'Stage',
      startDate: '2025-09',
      endDate: '2025-12',
      achievements: ['A', 'B'],
    },
  ],
  skills: {
    languages: ['TypeScript', 'Python'],
    frameworks: ['NestJS'],
    tools: ['Docker'],
    other: [],
  },
  search: {
    contracts: ['ALTERNANCE', 'STAGE'],
    rhythms: ['AUTRE'],
    startDate: 'asap',
    maxCommuteMinutes: 75,
    keywords: ['React'],
    romeCodes: ['M1805'],
    excludedCompanies: [],
  },
};

describe('profileForm', () => {
  it('aller-retour : le formulaire redonne exactement le profil de l’API', () => {
    expect(toPayload(toForm(profile))).toEqual(profile);
  });

  it('un profil enregistré avant le champ « contrats » reste en alternance', () => {
    const { contracts, ...searchWithout } = profile.search;
    void contracts;
    const old = { ...profile, search: searchWithout } as unknown as Profile;
    expect(toForm(old).contracts).toEqual(['ALTERNANCE']);
    expect(emptyForm().contracts).toEqual(['ALTERNANCE']);
  });

  it('omet les champs facultatifs vides', () => {
    const form = { ...toForm(profile), email: '  ', websiteUrl: '' };
    const payload = toPayload(form);
    expect(payload.identity).not.toHaveProperty('email');
    expect(payload.identity).not.toHaveProperty('websiteUrl');
    expect(payload.education[0]).not.toHaveProperty('endYear');
    expect(payload.experiences[0]).not.toHaveProperty('endDate');
  });

  it('nettoie les listes (virgules, retours à la ligne, doublons d’espaces)', () => {
    expect(splitList(' a, b ,, c\n d ')).toEqual(['a', 'b', 'c', 'd']);
    expect(toPayload({ ...toForm(profile), romeCodes: 'm1805, m1806' }).search.romeCodes).toEqual([
      'M1805',
      'M1806',
    ]);
  });

  it('une réalisation par ligne, lignes vides ignorées', () => {
    const form = toForm(profile);
    form.experiences[0] = { ...form.experiences[0], achievements: 'Une\n\n  Deux  \n' };
    expect(toPayload(form).experiences[0]?.achievements).toEqual(['Une', 'Deux']);
  });

  it('laisse une saisie numérique illisible à l’API (NaN), sans planter', () => {
    const payload = toPayload({ ...toForm(profile), maxCommuteMinutes: 'abc' });
    expect(Number.isNaN(payload.search.maxCommuteMinutes)).toBe(true);
  });

  it('le formulaire vide a des valeurs de départ raisonnables', () => {
    expect(emptyForm()).toMatchObject({
      startDate: 'asap',
      maxCommuteMinutes: '60',
      romeCodes: 'M1805',
    });
  });
});
