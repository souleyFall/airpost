import { describe, expect, it } from 'vitest';
import { exampleProfile } from '../profile/profile.fixture';
import {
  MAX_POINTS,
  type ScorableOffer,
  detectRhythm,
  distanceKm,
  profileTerms,
  scoreChannel,
  scoreCommute,
  scoreCompetition,
  scoreFreshness,
  scoreOffer,
  scoreRhythm,
  scoreStack,
} from './scoring';

const NOW = new Date('2026-11-10T12:00:00Z');
const PARIS_11 = { latitude: 48.860162, longitude: 2.381844 };
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function offer(extra: Partial<ScorableOffer> = {}): ScorableOffer {
  return {
    source: 'LBA',
    title: 'Alternance développeur',
    channel: 'SITE',
    firstSeenAt: NOW,
    ...extra,
  };
}

describe('grille', () => {
  it('totalise 100 points', () => {
    expect(Object.values(MAX_POINTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('scoreFreshness', () => {
  it.each([
    [0, 25],
    [3, 25],
    [4, 20],
    [7, 20],
    [8, 15],
    [14, 15],
    [15, 8],
    [30, 8],
    [31, 3],
    [400, 3],
  ])('publiée il y a %i jours → %i', (days, expected) => {
    expect(scoreFreshness(offer({ publishedAt: daysAgo(days) }), NOW)).toBe(expected);
  });

  it('se rabat sur la première apparition quand la date de publication manque', () => {
    expect(scoreFreshness(offer({ publishedAt: null, firstSeenAt: daysAgo(10) }), NOW)).toBe(15);
  });

  it('traite une date dans le futur comme « aujourd’hui »', () => {
    expect(scoreFreshness(offer({ publishedAt: daysAgo(-5) }), NOW)).toBe(25);
  });
});

describe('scoreStack', () => {
  const profile = exampleProfile(); // TypeScript, React, Node.js, Python, NestJS, Docker, PostgreSQL

  it('compte les termes du profil sans doublon', () => {
    expect(
      profileTerms(profile)
        .map((t) => t.toLowerCase())
        .sort(),
    ).toEqual(['docker', 'nestjs', 'node.js', 'postgresql', 'python', 'react', 'typescript']);
  });

  it('donne tous les points à partir de 4 termes retrouvés', () => {
    const result = scoreStack(
      offer({ title: 'Dev TypeScript / React', description: 'Node.js, NestJS et Docker.' }),
      profile,
    );

    expect(result.points).toBe(25);
    expect(result.matched).toHaveLength(5);
  });

  it('est proportionnel en dessous de 4 termes', () => {
    expect(scoreStack(offer({ title: 'Développeur TypeScript' }), profile).points).toBe(6); // 1/4
    expect(scoreStack(offer({ title: 'TypeScript et React' }), profile).points).toBe(13); // 2/4
    expect(scoreStack(offer({ title: 'Java, Spring' }), profile).points).toBe(0);
  });

  it('ignore la casse et les accents, et exige un mot entier', () => {
    const p = exampleProfile();
    p.skills.languages = ['Go', 'Développement'];
    p.search.keywords = [];
    p.skills.frameworks = [];
    p.skills.tools = [];

    expect(scoreStack(offer({ title: 'GO et MongoDB' }), p).matched).toEqual(['Go']);
    expect(scoreStack(offer({ title: 'Mongo' }), p).matched).toEqual([]);
    expect(scoreStack(offer({ title: 'DEVELOPPEMENT web' }), p).matched).toEqual(['Développement']);
  });

  it('gère les termes à caractères spéciaux (C++, Node.js) sans erreur de motif', () => {
    const p = exampleProfile();
    p.skills.languages = ['C++', '.NET'];
    p.search.keywords = ['(Node.js'];
    p.skills.frameworks = [];
    p.skills.tools = [];

    expect(() => scoreStack(offer({ title: 'C++ et .NET' }), p)).not.toThrow();
    expect(scoreStack(offer({ title: 'Expert C++ ' }), p).matched).toEqual(['C++']);
  });

  it('donne 0 sans terme dans le profil', () => {
    const p = exampleProfile();
    p.search.keywords = [];
    p.skills = { languages: [], frameworks: [], tools: [], other: [] };

    expect(scoreStack(offer({ title: 'TypeScript React' }), p).points).toBe(0);
  });
});

describe('detectRhythm / scoreRhythm', () => {
  it.each([
    ['Rythme : 2 jours en entreprise / 3 jours en cours', 'TWO_THREE'],
    ['rythme 3 jours / 2 jours', 'THREE_TWO'],
    ['2j/3j', 'TWO_THREE'],
    ['1 semaine en entreprise, 1 semaine en cours', 'ONE_ONE'],
    ['Une semaine sur deux en cours', 'ONE_ONE'],
    ['4 jours en entreprise et 1 jour à l’école', 'OTHER'],
    ['Alternance de 12 mois', null],
    ['5 jours de congés payés, 2 jours de télétravail possibles', null],
    ['Rythme : 3 jours en entreprise. 2 jours à l’école', 'THREE_TWO'],
    ['', null],
  ])('« %s » → %s', (text, expected) => {
    expect(detectRhythm(text)).toBe(expected);
  });

  it('récompense un rythme accepté, pénalise un rythme refusé, reste neutre sans information', () => {
    const profile = exampleProfile(); // accepte 2J_3J et 1S_1S

    expect(scoreRhythm(offer({ description: '2 jours / 3 jours' }), profile)).toEqual({
      points: 15,
      detected: '2J_3J',
    });
    expect(scoreRhythm(offer({ description: '3 jours / 2 jours' }), profile)).toEqual({
      points: 2,
      detected: '3J_2J',
    });
    expect(scoreRhythm(offer({ description: 'Une belle équipe' }), profile)).toEqual({
      points: 8,
      detected: null,
    });
  });
});

describe('distanceKm / scoreCommute', () => {
  it('calcule la distance à vol d’oiseau (Paris 11e → Vélizy ≈ 17 km)', () => {
    const km = distanceKm(PARIS_11, { latitude: 48.785916, longitude: 2.190427 });
    expect(km).toBeGreaterThan(15);
    expect(km).toBeLessThan(19);
    expect(distanceKm(PARIS_11, PARIS_11)).toBe(0);
  });

  it('donne le maximum sous la moitié du trajet accepté', () => {
    // 60 min acceptées : jusqu'à 15 km (30 min) → 15 points.
    const near = { latitude: 48.87, longitude: 2.4 };
    expect(scoreCommute(near, PARIS_11, 60).points).toBe(15);
  });

  it('diminue ensuite jusqu’au maximum accepté, puis tombe à 0', () => {
    const veliz = { latitude: 48.785916, longitude: 2.190427 }; // ≈ 17 km ≈ 34 min
    const mid = scoreCommute(veliz, PARIS_11, 60);
    expect(mid.points).toBeGreaterThanOrEqual(5);
    expect(mid.points).toBeLessThan(15);
    expect(mid.minutes).toBeGreaterThan(30);

    const far = { latitude: 49.5, longitude: 3.0 }; // > 80 km
    expect(scoreCommute(far, PARIS_11, 60).points).toBe(0);
  });

  it('reste neutre (7) quand l’offre n’est pas localisée', () => {
    expect(scoreCommute({ latitude: null, longitude: null }, PARIS_11, 60)).toEqual({
      points: 7,
      km: null,
      minutes: null,
    });
    expect(scoreCommute({ latitude: 48.8, longitude: undefined }, PARIS_11, 60).points).toBe(7);
  });

  it('n’est jamais négatif ni supérieur au maximum', () => {
    for (const km of [0, 5, 20, 30, 45, 80, 500]) {
      const target = { latitude: PARIS_11.latitude + km / 111, longitude: PARIS_11.longitude };
      const { points } = scoreCommute(target, PARIS_11, 60);
      expect(points).toBeGreaterThanOrEqual(0);
      expect(points).toBeLessThanOrEqual(15);
    }
  });
});

describe('scoreCompetition et scoreChannel', () => {
  it('classe les sources : candidature spontanée > portail officiel > agrégateur', () => {
    expect(scoreCompetition({ source: 'LBB' })).toBeGreaterThan(
      scoreCompetition({ source: 'LBA' }),
    );
    expect(scoreCompetition({ source: 'LBA' })).toBeGreaterThan(
      scoreCompetition({ source: 'ADZUNA' }),
    );
  });

  it('privilégie l’e-mail direct, puis un lien de candidature, puis rien', () => {
    expect(
      scoreChannel({ channel: 'EMAIL', contactEmail: 'rh@exemple.test', applyUrl: null }),
    ).toBe(10);
    expect(
      scoreChannel({ channel: 'SITE', applyUrl: 'https://exemple.test/a', contactEmail: null }),
    ).toBe(6);
    expect(scoreChannel({ channel: 'SITE', applyUrl: null, contactEmail: null })).toBe(2);
    // Canal « e-mail » sans adresse : on ne promet pas ce qu'on ne peut pas faire.
    expect(scoreChannel({ channel: 'EMAIL', contactEmail: null, applyUrl: null })).toBe(2);
  });
});

describe('scoreOffer', () => {
  it('additionne les critères et garde le détail', () => {
    const detail = scoreOffer(
      offer({
        title: 'Alternance développeur TypeScript React',
        description: 'Node.js, Docker. Rythme 2 jours / 3 jours.',
        publishedAt: daysAgo(1),
        latitude: 48.87,
        longitude: 2.4,
        applyUrl: 'https://exemple.test/a',
      }),
      exampleProfile(),
      PARIS_11,
      NOW,
    );

    expect(detail).toMatchObject({
      freshness: 25,
      stack: 25,
      rhythm: 15,
      commute: 15,
      competition: 5,
      channel: 6,
      total: 91,
      detectedRhythm: '2J_3J',
    });
    expect(detail.matchedTerms).toEqual(
      expect.arrayContaining(['TypeScript', 'React', 'Node.js', 'Docker']),
    );
    expect(detail.distanceKm).toBeGreaterThan(0);
    expect(detail.total).toBe(
      detail.freshness +
        detail.stack +
        detail.rhythm +
        detail.commute +
        detail.competition +
        detail.channel,
    );
  });

  it('reste dans [0, 100] pour une offre sans aucune information', () => {
    const detail = scoreOffer(
      offer({ title: 'x', firstSeenAt: daysAgo(500) }),
      exampleProfile(),
      PARIS_11,
      NOW,
    );

    expect(detail.total).toBeGreaterThanOrEqual(0);
    expect(detail.total).toBeLessThanOrEqual(100);
    expect(Number.isInteger(detail.total)).toBe(true);
  });

  it('est déterministe : mêmes entrées, même score', () => {
    const o = offer({ title: 'TypeScript', publishedAt: daysAgo(5) });

    expect(scoreOffer(o, exampleProfile(), PARIS_11, NOW)).toEqual(
      scoreOffer(o, exampleProfile(), PARIS_11, NOW),
    );
  });
});
