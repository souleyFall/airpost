import { describe, expect, it } from 'vitest';
import { exampleProfile } from './profile.fixture';
import { profileSchema } from './profile.schema';

describe('profileSchema', () => {
  it('accepte un profil complet', () => {
    expect(profileSchema.safeParse(exampleProfile()).success).toBe(true);
  });

  it('applique les valeurs par défaut de la recherche (asap, 60 min, ROME M1805)', () => {
    const { search, ...rest } = exampleProfile();
    const { startDate, maxCommuteMinutes, romeCodes, ...searchRest } = search;
    void startDate;
    void maxCommuteMinutes;
    void romeCodes;

    const parsed = profileSchema.parse({ ...rest, search: searchRest });

    expect(parsed.search).toMatchObject({
      startDate: 'asap',
      maxCommuteMinutes: 60,
      romeCodes: ['M1805'],
    });
  });

  it('un profil enregistré avant le champ « contrats » reste en alternance', () => {
    const { search, ...rest } = exampleProfile();
    const { contracts, ...searchRest } = search;
    void contracts;

    const parsed = profileSchema.parse({ ...rest, search: searchRest });

    expect(parsed.search.contracts).toEqual(['ALTERNANCE']);
  });

  it('accepte alternance et stage ensemble, refuse un contrat inconnu, doublon ou une liste vide', () => {
    const both = exampleProfile();
    both.search.contracts = ['ALTERNANCE', 'STAGE'];
    expect(profileSchema.safeParse(both).success).toBe(true);
    for (const contracts of [[], ['CDI'], ['ALTERNANCE', 'STAGE', 'ALTERNANCE']]) {
      const bad = { ...exampleProfile(), search: { ...exampleProfile().search, contracts } };
      expect(profileSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('refuse un champ inconnu, à la racine comme en profondeur', () => {
    expect(profileSchema.safeParse({ ...exampleProfile(), admin: true }).success).toBe(false);
    const profile = exampleProfile();
    const withExtra = { ...profile, identity: { ...profile.identity, role: 'admin' } };
    expect(profileSchema.safeParse(withExtra).success).toBe(false);
  });

  it.each([
    ['code postal', (p: ReturnType<typeof exampleProfile>) => ((p.identity.postcode = '7501'), p)],
    ['e-mail', (p: ReturnType<typeof exampleProfile>) => ((p.identity.email = 'pas-un-mail'), p)],
    [
      'site en http',
      (p: ReturnType<typeof exampleProfile>) => (
        (p.identity.websiteUrl = 'http://exemple.test'),
        p
      ),
    ],
    [
      'site javascript:',
      (p: ReturnType<typeof exampleProfile>) => (
        (p.identity.websiteUrl = 'javascript:alert(1)'),
        p
      ),
    ],
    [
      'date de début de poste',
      (p: ReturnType<typeof exampleProfile>) => ((p.experiences[0].startDate = '2025-13'), p),
    ],
    [
      'rythme inconnu',
      (p: ReturnType<typeof exampleProfile>) => (
        ((p.search.rhythms as string[]) = ['TOUT_LE_TEMPS']),
        p
      ),
    ],
    [
      'trajet trop long',
      (p: ReturnType<typeof exampleProfile>) => ((p.search.maxCommuteMinutes = 600), p),
    ],
    ['code ROME', (p: ReturnType<typeof exampleProfile>) => ((p.search.romeCodes = ['1805M']), p)],
    [
      'date de démarrage',
      (p: ReturnType<typeof exampleProfile>) => ((p.search.startDate = '2026-02-30'), p),
    ],
  ])('refuse un(e) %s invalide', (_name, mutate) => {
    expect(profileSchema.safeParse(mutate(exampleProfile())).success).toBe(false);
  });

  it('refuse une fin antérieure au début, accepte une même date', () => {
    const experience = exampleProfile();
    experience.experiences[0].startDate = '2025-09';
    experience.experiences[0].endDate = '2025-04';
    expect(profileSchema.safeParse(experience).success).toBe(false);
    experience.experiences[0].endDate = '2025-09';
    expect(profileSchema.safeParse(experience).success).toBe(true);

    const education = exampleProfile();
    education.education[0].startYear = 2025;
    education.education[0].endYear = 2024;
    expect(profileSchema.safeParse(education).success).toBe(false);
    education.education[0].endYear = 2027;
    expect(profileSchema.safeParse(education).success).toBe(true);
  });

  it('borne la taille des textes et des listes (le profil part vers un modèle de langage)', () => {
    const tooLong = exampleProfile();
    tooLong.summary = 'x'.repeat(1001);
    expect(profileSchema.safeParse(tooLong).success).toBe(false);

    const tooMany = exampleProfile();
    tooMany.experiences = Array.from({ length: 21 }, () => exampleProfile().experiences[0]);
    expect(profileSchema.safeParse(tooMany).success).toBe(false);

    const longAchievement = exampleProfile();
    longAchievement.experiences[0].achievements = ['x'.repeat(301)];
    expect(profileSchema.safeParse(longAchievement).success).toBe(false);
  });

  it('refuse les textes vides ou faits d’espaces et rogne les espaces autour', () => {
    const blank = exampleProfile();
    blank.headline = '   ';
    expect(profileSchema.safeParse(blank).success).toBe(false);

    const padded = exampleProfile();
    padded.identity.firstName = '  Camille  ';
    expect(profileSchema.parse(padded).identity.firstName).toBe('Camille');
  });
});
