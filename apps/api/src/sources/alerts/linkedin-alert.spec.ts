import { describe, expect, it } from 'vitest';
import { parseLinkedinAlert } from './linkedin-alert';

/** Lien tel que LinkedIn l'envoie : numéro d'annonce puis jetons personnels (ici factices). */
const link = (id: string) =>
  `https://www.linkedin.com/comm/jobs/view/${id}/?trackingId=abc%3D%3D&midToken=JETON&otpToken=SECRET-A-NE-PAS-GARDER`;
const SEP = '---------------------------------------------------------';

/** Formats relevés sur de vrais messages, contenu anonymisé. */
const DIGEST = [
  `Sélection d’offres d’emploi pour vous : https://www.linkedin.com/comm/jobs/collections/recommended?otpToken=X`,
  '',
  'Ingénieur Développement web, mobile Alternance',
  'Banque Exemple',
  'Boulogne-Billancourt',
  '',
  '1 ancien élève',
  `Voir l’offre d’emploi : ${link('4381718241')}`,
  '',
  SEP,
  '',
  'Développeuse / Développeur Fullstack- Alternance',
  'Conseil Exemple',
  'Massy',
  '',
  'Cette entreprise recrute activement',
  `Voir l’offre d’emploi : ${link('4379940701')}`,
  '',
  SEP,
  '',
  `Voir toutes les offres d’emploi https://www.linkedin.com/comm/jobs/collections/recommended?otpToken=X`,
  '',
  'La recherche d’emploi prend en moyenne 4 mois. Allez plus vite avec Premium.',
  'http://www.linkedin.com/comm/premium/products/?x=1',
].join('\n');

const REMINDER = [
  'Votre offre d’emploi enregistrée chez Atelier Exemple est toujours disponible.',
  '',
  'Software Engineer (H/F) - Stage - Paris',
  'Atelier Exemple',
  'Paris, Île-de-France, France',
  `Voir l’offre d’emploi : ${link('4477928448')}`,
  '',
  SEP,
  '',
  'Postuler maintenant',
  '',
  `      ${link('4477928448')}`,
  '',
  'Vos autres offres d’emploi enregistrées',
  'Apprenti(e) Data & Intelligence Artificielle',
  'Usine Exemple',
  'Eure-et-Loir, Centre-Val de Loire, France',
  `Voir l’offre d’emploi : ${link('4480512136')}`,
  '',
  SEP,
  '',
  'Alternant Ingénieur IA (H/F)',
  "Studio Exemple'",
  'Boulogne-Billancourt, Île-de-France, France',
  'Postulez avec un CV et un profil',
  `Voir l’offre d’emploi : ${link('4483950518')}`,
].join('\n');

const CONFIRMATION = [
  'Votre candidature a été envoyée à Agence Exemple',
  '',
  'Software Engineer Fullstack - Stage',
  'Agence Exemple',
  'Paris et périphérie',
  `Voir l’offre d’emploi : ${link('4461562913')}`,
  '',
  SEP,
  '',
  `Candidature envoyée le 6 novembre 2026----------------------------------------------------------------`,
  '        À vous de jouer, suivez les étapes suivantes pour encore plus de succès',
  '',
  'Voir des offres d’emploi similaires qui pourraient vous intéresser',
  '',
  'Développeur fullstack PHP/Javascript - Alternance (H/F)',
  'Éditeur Exemple',
  'Paris et périphérie',
  '',
  '3 anciens élèves',
  `Voir l’offre d’emploi : ${link('4485762301')}`,
].join('\n');

describe('parseLinkedinAlert', () => {
  it('sélection d’offres : intitulé, entreprise, ville, numéro d’annonce', () => {
    const { offers, skipped } = parseLinkedinAlert(DIGEST);

    expect(skipped).toBe(0);
    expect(offers).toEqual([
      {
        source: 'LINKEDIN',
        externalId: '4381718241',
        title: 'Ingénieur Développement web, mobile Alternance',
        company: 'Banque Exemple',
        city: 'Boulogne-Billancourt',
        applyUrl: 'https://www.linkedin.com/jobs/view/4381718241/',
        channel: 'SITE',
      },
      expect.objectContaining({
        externalId: '4379940701',
        title: 'Développeuse / Développeur Fullstack- Alternance',
        company: 'Conseil Exemple',
        city: 'Massy',
      }),
    ]);
  });

  it('rappel d’offres enregistrées : rubrique et mention collées ignorées, ville avant la virgule', () => {
    const { offers, skipped } = parseLinkedinAlert(REMINDER);

    expect(skipped).toBe(0);
    expect(offers.map((o) => [o.externalId, o.title, o.company, o.city])).toEqual([
      ['4477928448', 'Software Engineer (H/F) - Stage - Paris', 'Atelier Exemple', 'Paris'],
      [
        '4480512136',
        'Apprenti(e) Data & Intelligence Artificielle',
        'Usine Exemple',
        'Eure-et-Loir',
      ],
      ['4483950518', 'Alternant Ingénieur IA (H/F)', "Studio Exemple'", 'Boulogne-Billancourt'],
    ]);
  });

  it('confirmation de candidature : l’annonce déjà postulée est laissée de côté, les offres similaires gardées', () => {
    const { offers, skipped } = parseLinkedinAlert(CONFIRMATION);

    expect(skipped).toBe(0);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      externalId: '4485762301',
      company: 'Éditeur Exemple',
      city: 'Paris',
    });
  });

  describe('sécurité', () => {
    it('ne conserve aucun jeton du lien reçu (jeton de connexion compris)', () => {
      const stored = JSON.stringify(parseLinkedinAlert(DIGEST + REMINDER + CONFIRMATION));

      expect(stored).not.toMatch(/otpToken|midToken|trackingId|SECRET|JETON|\/comm\//);
    });

    it.each([
      ['hôte étranger', 'https://www.linkedin.com.evil.test/comm/jobs/view/4381718241/'],
      ['sous-domaine inattendu', 'https://fr.linkedin.com/comm/jobs/view/4381718241/'],
      ['http', 'http://www.linkedin.com/comm/jobs/view/4381718241/'],
      ['autre page', 'https://www.linkedin.com/comm/redirect?url=https://evil.test'],
      ['numéro non numérique', 'https://www.linkedin.com/comm/jobs/view/abc/'],
    ])('écarte un lien douteux (%s) en le comptant', (_label, url) => {
      const text = ['Développeur', 'Exemple', 'Paris', `Voir l’offre d’emploi : ${url}`].join('\n');

      expect(parseLinkedinAlert(text)).toEqual({ offers: [], skipped: 1 });
    });

    it('écarte un bloc qui n’a pas exactement intitulé, entreprise et lieu', () => {
      const text = ['Développeur', 'Paris', `Voir l’offre d’emploi : ${link('4381718241')}`].join(
        '\n',
      );

      expect(parseLinkedinAlert(text)).toEqual({ offers: [], skipped: 1 });
    });

    it('borne la longueur des champs', () => {
      const text = [
        'T'.repeat(5000),
        'E'.repeat(5000),
        'Paris',
        `Voir l’offre d’emploi : ${link('4381718241')}`,
      ].join('\n');

      const [offer] = parseLinkedinAlert(text).offers;

      expect(offer?.title.length).toBeLessThanOrEqual(300);
      expect(offer?.company.length).toBeLessThanOrEqual(300);
    });
  });

  it('retire les caractères invisibles des champs (relevé sur un vrai nom d’entreprise)', () => {
    const text = [
      'Développeur',
      `Studio Exemple${String.fromCharCode(0x200b)}`,
      'Paris',
      `Voir l’offre d’emploi : ${link('4381718241')}`,
    ].join('\n');

    expect(parseLinkedinAlert(text).offers[0]?.company).toBe('Studio Exemple');
  });

  it('un message sans annonce (notification de profil) ne donne rien', () => {
    expect(parseLinkedinAlert('14 personnes ont consulté votre profil\nhttps://x.test')).toEqual({
      offers: [],
      skipped: 0,
    });
  });
});
