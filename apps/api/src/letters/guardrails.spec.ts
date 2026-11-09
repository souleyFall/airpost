import { describe, expect, it } from 'vitest';
import { exampleProfile } from '../profile/profile.fixture';
import {
  MAX_WORDS,
  MIN_WORDS,
  checkLetter,
  claimedTechNotInProfile,
  inventedNumbers,
  numbersIn,
  profileCorpus,
  ungroundedFacts,
} from './guardrails';
import { FACT_ACHIEVEMENT, FACT_DEGREE, validLetter } from './letter.fixture';

const profile = exampleProfile();
const context = {
  profile,
  offerText: 'Alternance développeur, rythme 2 jours / 3 jours, 12 mois.',
};
const NOW = new Date('2026-11-10T00:00:00Z');

describe('checkLetter', () => {
  it('accepte une lettre conforme', () => {
    expect(checkLetter(validLetter(), { ...context, now: NOW }).violations).toEqual([]);
  });

  it.each([
    ['trop courte', () => 'Madame, Monsieur, je postule. '.repeat(3), 'length'],
    ['trop longue', () => 'mot '.repeat(MAX_WORDS + 10), 'length'],
    [
      'avec un texte à compléter [entreprise]',
      () => validLetter().body.replace('Votre offre', '[Nom de l’entreprise], votre offre'),
      'placeholder',
    ],
    ['avec une accolade de gabarit', () => validLetter().body + ' {{poste}}', 'placeholder'],
    [
      'avec une adresse e-mail',
      () => validLetter().body + ' Écrivez-moi à moi@exemple.test.',
      'contact_data',
    ],
    [
      'avec un téléphone',
      () => validLetter().body + ' Appelez-moi au 06 12 34 56 78.',
      'contact_data',
    ],
    [
      'avec un lien',
      () => validLetter().body + ' Mon site : https://exemple.test/moi',
      'contact_data',
    ],
    ['qui se dit IA', () => validLetter().body + " En tant qu'IA, je ne peux pas…", 'ai_mention'],
    [
      'qui se dit modèle de langage',
      () => validLetter().body + ' Je suis un modèle de langage.',
      'ai_mention',
    ],
    [
      'avec un chiffre inventé',
      () => validLetter().body.replace('Concrètement', 'Après 5 ans d’expérience, concrètement'),
      'invented_number',
    ],
  ])('refuse une lettre %s', (_name, makeBody, violation) => {
    const result = checkLetter(validLetter({ body: makeBody() }), { ...context, now: NOW });

    expect(result.violations).toContain(violation);
  });

  it('refuse un objet contenant une coordonnée ou un chiffre inventé', () => {
    expect(
      checkLetter(validLetter({ subject: 'Candidature, rappelez-moi au 06 12 34 56 78' }), context)
        .violations,
    ).toContain('contact_data');
    expect(
      checkLetter(validLetter({ subject: 'Candidature n° 987' }), { ...context, now: NOW })
        .violations,
    ).toContain('invented_number');
  });

  it('refuse une citation qui n’est pas dans le profil, ou une lettre sans citation', () => {
    const invented = checkLetter(
      validLetter({ usedFacts: [FACT_DEGREE, 'Diplômé de Polytechnique avec mention'] }),
      context,
    );
    expect(invented.violations).toContain('ungrounded_fact');
    expect(invented.details.facts).toEqual(['Diplômé de Polytechnique avec mention']);

    expect(checkLetter(validLetter({ usedFacts: [] }), context).violations).toContain('no_fact');
  });

  it('cumule les violations', () => {
    const result = checkLetter(
      { subject: 'Objet de test', body: 'Trop court, 99 %', usedFacts: [] },
      { ...context, now: NOW },
    );

    expect(result.violations).toEqual(
      expect.arrayContaining(['length', 'invented_number', 'no_fact']),
    );
  });

  it('les bornes de longueur sont inclusives', () => {
    const exactly = (n: number) => Array.from({ length: n }, () => 'mot').join(' ');

    expect(
      checkLetter(validLetter({ body: exactly(MIN_WORDS) }), context).violations,
    ).not.toContain('length');
    expect(
      checkLetter(validLetter({ body: exactly(MIN_WORDS - 1) }), context).violations,
    ).toContain('length');
    expect(
      checkLetter(validLetter({ body: exactly(MAX_WORDS) }), context).violations,
    ).not.toContain('length');
    expect(
      checkLetter(validLetter({ body: exactly(MAX_WORDS + 1) }), context).violations,
    ).toContain('length');
  });
});

describe('inventedNumbers', () => {
  it('permet les chiffres du profil, de l’offre et de l’année en cours', () => {
    const sources = [profileCorpus(profile), context.offerText];

    expect(
      inventedNumbers(
        '40 % plus rapide, 2025, 2026, rythme 2 jours / 3 jours, 12 mois',
        sources,
        NOW,
      ),
    ).toEqual([]);
  });

  it('relève les chiffres absents, sans doublon', () => {
    expect(inventedNumbers('5 ans, 5 projets, 80 %', [profileCorpus(profile)], NOW)).toEqual([
      '5',
      '80',
    ]);
  });

  it('traite 3,5 et 3.5 comme le même nombre', () => {
    expect(inventedNumbers('3,5 points', ['gain de 3.5 points'], NOW)).toEqual([]);
  });
});

describe('numbersIn', () => {
  it('extrait entiers et décimaux', () => {
    expect(numbersIn('En 2025, 40 % et 3,5 pts, 12.')).toEqual(['2025', '40', '3.5', '12']);
    expect(numbersIn('aucun')).toEqual([]);
  });
});

describe('ungroundedFacts', () => {
  it('accepte une citation exacte, même avec des accents ou des espaces différents', () => {
    expect(ungroundedFacts([FACT_ACHIEVEMENT, 'master  DEVELOPPEMENT et ia'], profile)).toEqual([]);
  });

  it('accepte une compétence du profil même courte, et les éléments de disponibilité', () => {
    expect(ungroundedFacts(['React', 'typescript', 'Node.js'], profile)).toEqual([]);
    expect(ungroundedFacts(['asap', '2J_3J'], profile)).toEqual([]);
    // Une technologie absente du profil n'est pas une citation valable, même courte.
    expect(ungroundedFacts(['Angular'], profile)).toEqual(['Angular']);
  });

  it('refuse une citation modifiée, trop courte ou inventée', () => {
    expect(ungroundedFacts(['Réduit le temps de chargement de 90 %'], profile)).toHaveLength(1);
    expect(ungroundedFacts(['Master'], profile)).toHaveLength(1);
    expect(ungroundedFacts(['Expert Kubernetes certifié'], profile)).toHaveLength(1);
  });
});

describe('claimedTechNotInProfile', () => {
  it('signale les technologies citées mais absentes du profil', () => {
    expect(
      claimedTechNotInProfile(
        'Je souhaite découvrir Kubernetes et Angular. J’utilise React.',
        profile,
      ),
    ).toEqual(['Angular', 'Kubernetes']);
  });

  it('ne signale rien quand tout figure au profil, ou quand rien n’est cité', () => {
    expect(claimedTechNotInProfile('TypeScript, React, Node.js et Docker.', profile)).toEqual([]);
    expect(claimedTechNotInProfile('Une lettre sans technologie.', profile)).toEqual([]);
  });

  it('exige un mot entier : « Go » n’est pas dans « Django-like »... ni « Java » dans « JavaScript »', () => {
    const p = exampleProfile();
    p.skills.languages = ['JavaScript'];
    p.search.keywords = [];

    expect(claimedTechNotInProfile('Je maîtrise JavaScript.', p)).toEqual([]);
    expect(claimedTechNotInProfile('Je maîtrise Java.', p)).toEqual(['Java']);
  });
});
