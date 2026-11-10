import { describe, expect, it } from 'vitest';
import { alertExternalId, parseIndeedAlert } from './indeed-alert';

const RECEIVED = new Date('2026-11-10T02:44:05Z');
const link = (id: string) => `https://engage.indeed.com/f/a/${id}~~/AAR9hBA~/jeton-factice-${id}~~`;

/**
 * Message anonymisé, à la structure d'un vrai message d'alerte Indeed (relevé le 2026-11-10) : entreprises, textes et
 * liens remplacés par des valeurs d'exemple, aucune donnée du destinataire.
 */
const ALERT = `Votre alerte emploi est active

Vous recevrez votre première alerte emploi quotidienne pour développeur full stack : Paris (75) quand de nouveaux emplois seront disponibles.

En attendant, vous pouvez consulter les nouvelles offres d'emploi sur Indeed à tout moment en copiant-collant le lien ci-dessous

${link('CONSULTER')}

Si vous avez reçu cet email par erreur, vous pouvez vous désinscrire en copiant-collant le lien ci-dessous.

${link('DESINSCRIPTION')}

9 nouveaux emplois développeur full stack - Paris (75)

Développeur full stack (H/F)
Atelier Exemple - Nanterre (92)
De 42 000 € à 46 000 € par an
Développement Back-End : concevoir et développer des API REST, microservices et services d'intégration.
Publié à l'instant
${link('OFFRE1')}

Développeur (euse) Senior Full Stack H/F
Nordlys Logiciels - Malakoff (92)
De 38 000 € à 42 000 € par an
Candidature simplifiée
De préférence sur une stack Java / ReactJS ou ouvert à se former sur ces langages…
Publié à l'instant
${link('OFFRE2')}

Alternance Développeur Front-End & IA (F/H)
Studio Exemple - Paris (75)
Candidature simplifiée
Participer au développement front-end de la plateforme, avec React et TypeScript.
il y a 5 jours
${link('OFFRE3')}

Tech Lead Full Stack Web
Groupe Exemple - Conseil - Paris (75)
Encadrer techniquement les développeurs frontend et full stack.
il y a 3 jours
${link('OFFRE4')}

Alternance Développeur Web (F/H)
Maison Exemple - Versailles (78)
Candidature simplifiée
Publié à l'instant
${link('OFFRE5')}

Afficher tous les emplois

${link('TOUS')}

Ces emplois sont-ils pertinents ?

Mettez à jour vos paramètres d'alertes emploi afin de recevoir les emplois correspondant à vos critères.

${link('MODIFIER')}

© 2026 Indeed Ireland Operations, Ltd.
`;

describe('parseIndeedAlert', () => {
  const parsed = () => parseIndeedAlert(ALERT, RECEIVED);

  it('extrait chaque annonce : intitulé, entreprise, ville, salaire et extrait, lien, source', () => {
    const { offers, skipped } = parsed();

    expect(skipped).toBe(0);
    expect(offers).toHaveLength(5);
    expect(offers[0]).toMatchObject({
      source: 'INDEED',
      title: 'Développeur full stack (H/F)',
      company: 'Atelier Exemple',
      city: 'Nanterre',
      channel: 'SITE',
      applyUrl: link('OFFRE1'),
      description:
        "Salaire : De 42 000 € à 46 000 € par an\n\nDéveloppement Back-End : concevoir et développer des API REST, microservices et services d'intégration.",
    });
  });

  it('ignore l’en-tête (liens de consultation et de désinscription) et le pied de page', () => {
    const urls = parsed().offers.map((o) => o.applyUrl);

    expect(urls).toEqual([
      link('OFFRE1'),
      link('OFFRE2'),
      link('OFFRE3'),
      link('OFFRE4'),
      link('OFFRE5'),
    ]);
    expect(urls.join(' ')).not.toMatch(/CONSULTER|DESINSCRIPTION|TOUS|MODIFIER/);
  });

  it('retire « Candidature simplifiée » du texte et traite les champs facultatifs absents', () => {
    const { offers } = parsed();

    expect(offers[1]?.description).toBe(
      'Salaire : De 38 000 € à 42 000 € par an\n\nDe préférence sur une stack Java / ReactJS ou ouvert à se former sur ces langages…',
    );
    // Ni salaire, ni extrait : pas de description.
    expect(offers[4]?.description).toBeUndefined();
    expect(offers[2]?.description).toBe(
      'Participer au développement front-end de la plateforme, avec React et TypeScript.',
    );
  });

  it('découpe sur le DERNIER « - » : un nom d’entreprise peut en contenir un', () => {
    const offer = parsed().offers[3];

    expect(offer?.company).toBe('Groupe Exemple - Conseil');
    expect(offer?.city).toBe('Paris');
  });

  it('retire le département de la ville', () => {
    expect(parsed().offers.map((o) => o.city)).toEqual([
      'Nanterre',
      'Malakoff',
      'Paris',
      'Paris',
      'Versailles',
    ]);
  });

  it('date l’annonce d’après son âge et la date de réception du message', () => {
    const dates = parsed().offers.map((o) => o.publishedAt);

    expect(dates[0]).toEqual(RECEIVED);
    expect(dates[2]).toEqual(new Date('2026-11-05T02:44:05Z'));
    expect(dates[3]).toEqual(new Date('2026-11-07T02:44:05Z'));
  });

  it('donne le même identifiant à la même annonce vue dans deux alertes (idempotence)', () => {
    const later = parseIndeedAlert(
      ALERT.replace("Publié à l'instant", 'il y a 1 jour'),
      new Date('2026-11-11T02:00:00Z'),
    );

    expect(later.offers.map((o) => o.externalId)).toEqual(parsed().offers.map((o) => o.externalId));
    expect(new Set(parsed().offers.map((o) => o.externalId)).size).toBe(5);
  });

  it('l’identifiant ignore la casse, les accents et les espaces, pas le poste ni le lieu', () => {
    expect(alertExternalId('Développeur  Web', 'Société Exemple', 'Paris')).toBe(
      alertExternalId('developpeur web', 'SOCIETE EXEMPLE', 'paris'),
    );
    expect(alertExternalId('Développeur Web', 'Société Exemple', 'Paris')).not.toBe(
      alertExternalId('Développeur Web', 'Société Exemple', 'Lyon'),
    );
    expect(alertExternalId('Développeur Web', 'Société Exemple', 'Paris')).not.toBe(
      alertExternalId('Développeur Mobile', 'Société Exemple', 'Paris'),
    );
  });

  describe('contenu non fiable', () => {
    it('écarte une annonce dont le lien ne vient pas d’Indeed (message imité)', () => {
      const text = `3 nouveaux emplois dev - Paris (75)

Développeur piégé
Pirate SAS - Paris (75)
Publié à l'instant
https://evil.example/phishing

Développeur légitime
Atelier Exemple - Paris (75)
Publié à l'instant
${link('OK')}
`;
      const { offers, skipped } = parseIndeedAlert(text, RECEIVED);

      expect(offers.map((o) => o.title)).toEqual(['Développeur légitime']);
      expect(skipped).toBe(1);
    });

    it.each([
      'https://engage.indeed.com.evil.example/f/a/x',
      'https://evil.example/engage.indeed.com/f/a/x',
      'http://engage.indeed.com/f/a/x',
      'https://indeed.com/f/a/x',
      'javascript:alert(1)',
    ])('refuse le lien « %s »', (url) => {
      const text = `1 nouvel emploi dev - Paris (75)\n\nDéveloppeur\nAtelier Exemple - Paris (75)\nPublié à l'instant\n${url}\n`;

      expect(parseIndeedAlert(text, RECEIVED).offers).toHaveLength(0);
    });

    it('compte les blocs illisibles : trop courts, sans « Entreprise - Ville », trop longs', () => {
      const text = `3 nouveaux emplois dev - Paris (75)

Titre seul
${link('A')}

Titre
Entreprise sans ville
${link('B')}

Titre
Entreprise - Paris (75)
${Array.from({ length: 20 }, (_, i) => `ligne ${i}`).join('\n')}
${link('C')}
`;
      const { offers, skipped } = parseIndeedAlert(text, RECEIVED);

      expect(offers).toHaveLength(0);
      expect(skipped).toBe(3);
    });

    it('borne la longueur des champs venus du message', () => {
      const text = `1 nouvel emploi dev - Paris (75)\n\n${'T'.repeat(500)}\n${'E'.repeat(500)} - Paris (75)\n${'x'.repeat(30_000)}\nPublié à l'instant\n${link('LONG')}\n`;

      const [offer] = parseIndeedAlert(text, RECEIVED).offers;

      expect(offer?.title.length).toBeLessThanOrEqual(200);
      expect(offer?.company.length).toBeLessThanOrEqual(200);
      expect(offer?.description?.length).toBeLessThanOrEqual(10_000);
    });

    it('un texte sans en-tête « N nouveaux emplois » ne donne rien (message d’un autre type)', () => {
      expect(parseIndeedAlert('Bonjour, ceci est un message ordinaire.', RECEIVED)).toEqual({
        offers: [],
        skipped: 0,
      });
      expect(parseIndeedAlert('', RECEIVED)).toEqual({ offers: [], skipped: 0 });
    });

    it('ne se bloque pas sur un texte énorme de lignes vides ou de longues lignes', () => {
      const started = Date.now();

      parseIndeedAlert(
        `1 nouvel emploi dev\n${'\n'.repeat(200_000)}${'a '.repeat(100_000)}`,
        RECEIVED,
      );

      expect(Date.now() - started).toBeLessThan(2_000);
    });
  });

  it('reconnaît l’en-tête au singulier (« 1 nouvel emploi ») : un message à une seule annonce n’est pas ignoré', () => {
    const text = `1 nouvel emploi développeur - Paris (75)\n\nDéveloppeur Web\nAtelier Exemple - Paris (75)\nPublié à l'instant\n${link('SEUL')}\n`;

    const { offers } = parseIndeedAlert(text, RECEIVED);

    expect(offers.map((o) => o.title)).toEqual(['Développeur Web']);
  });

  it('accepte les sauts de ligne Windows et les espaces insécables', () => {
    const windows = ALERT.replaceAll('\n', '\r\n').replaceAll('De 42 000', 'De 42 000');

    const { offers } = parseIndeedAlert(windows, RECEIVED);

    expect(offers).toHaveLength(5);
    expect(offers[0]?.description).toContain('Salaire : De 42 000 €');
  });
});
