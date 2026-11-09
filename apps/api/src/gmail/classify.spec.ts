import { describe, expect, it } from 'vitest';
import { classifyReply, isReplyDriven, statusFromReplies } from './classify';

const kind = (subject: string, snippet = '') => classifyReply({ subject, snippet });

describe('classifyReply', () => {
  it.each([
    ['Re: Candidature développeur', 'Nous avons bien reçu votre candidature et la transmettons.'],
    ['Accusé de réception', ''],
    ['Votre candidature', 'Merci pour votre candidature.'],
    ['Application', 'We received your application.'],
  ])('reconnaît un accusé de réception : %s', (subject, snippet) => {
    expect(kind(subject, snippet)).toBe('ACKNOWLEDGEMENT');
  });

  it.each([
    ['Proposition d’échange téléphonique', ''],
    ['Entretien', 'Seriez-vous disponible jeudi ?'],
    ['Re: candidature', 'Pourriez-vous m’indiquer vos disponibilités pour un rendez-vous ?'],
    ['Next steps', 'We would like to schedule a call'],
  ])('reconnaît une invitation à un entretien : %s', (subject, snippet) => {
    expect(kind(subject, snippet)).toBe('INTERVIEW');
  });

  it.each([
    ['Votre candidature', 'Nous ne donnons pas suite à votre candidature.'],
    ['Réponse', 'Votre profil n’a pas été retenu.'],
    ['Réponse', 'Après étude, nous regrettons de ne pouvoir…'],
    ['Update', 'Unfortunately we will not be moving forward.'],
  ])('reconnaît un refus : %s', (subject, snippet) => {
    expect(kind(subject, snippet)).toBe('REJECTION');
  });

  it('un refus l’emporte sur un accusé dans le même message', () => {
    expect(
      kind('Candidature', 'Nous avons bien reçu votre candidature mais nous ne donnons pas suite.'),
    ).toBe('REJECTION');
  });

  it('prudence : un message ordinaire reste « autre »', () => {
    expect(kind('Newsletter', 'Offres du jour : appel d’offres et promotions')).toBe('OTHER');
    expect(kind('Facture', 'Votre facture du mois')).toBe('OTHER');
    expect(kind('', '')).toBe('OTHER');
  });

  it('ne se laisse pas tromper par la casse ni par les accents', () => {
    expect(kind('ENTRETIEN', '')).toBe('INTERVIEW');
    expect(kind('Accuse de reception', '')).toBe('ACKNOWLEDGEMENT');
  });
});

describe('statusFromReplies', () => {
  it('refus > entretien > accusé > envoyée', () => {
    expect(statusFromReplies([])).toBe('APPLIED');
    expect(statusFromReplies(['OTHER'])).toBe('APPLIED');
    expect(statusFromReplies(['ACKNOWLEDGEMENT'])).toBe('ACKNOWLEDGED');
    expect(statusFromReplies(['ACKNOWLEDGEMENT', 'INTERVIEW'])).toBe('INTERVIEW');
    expect(statusFromReplies(['INTERVIEW', 'REJECTION'])).toBe('REJECTED');
  });

  it('seuls les statuts issus des réponses sont concernés', () => {
    expect(isReplyDriven('APPLIED')).toBe(true);
    expect(isReplyDriven('VALIDATED')).toBe(false);
    expect(isReplyDriven('WITHDRAWN')).toBe(false);
    expect(isReplyDriven('DRAFT_CREATED')).toBe(false);
  });
});
