import { describe, expect, it } from 'vitest';
import { buildLetterPdf, letterContent, letterFileName } from './letterPdf';

const SENDER = {
  firstName: 'Alice',
  lastName: 'Martin',
  headline: 'Développeuse Full Stack',
  email: 'alice@exemple.test',
  phone: '+33 6 00 00 00 00',
  city: 'Versailles',
};
const DATE = new Date('2026-11-10T12:00:00Z');

describe('letterContent', () => {
  it('compose l’en-tête, la date, l’objet, le corps et la signature', () => {
    const content = letterContent(
      SENDER,
      'Candidature alternance',
      'Bonjour,\n\nPremier paragraphe.\nSuite.\n\nCordialement,',
      DATE,
      { company: 'Atelier Exemple', postcode: '75011', city: 'Paris' },
    );

    expect(content).toEqual({
      recipient: ['Atelier Exemple', '75011 Paris'],
      header: [
        'Alice Martin',
        'Développeuse Full Stack',
        'alice@exemple.test',
        '+33 6 00 00 00 00',
      ],
      dateLine: 'Versailles, le 10 novembre 2026',
      subjectLine: 'Objet : Candidature alternance',
      paragraphs: ['Bonjour,', 'Premier paragraphe.\nSuite.', 'Cordialement,'],
      signature: 'Alice Martin',
    });
  });

  it('omet les lignes absentes du profil (mail, téléphone, ville)', () => {
    const content = letterContent(
      { firstName: 'Alice', lastName: 'Martin', headline: 'Développeuse' },
      'Objet',
      'Texte.',
      DATE,
    );

    expect(content.header).toEqual(['Alice Martin', 'Développeuse']);
    expect(content.dateLine).toBe('Le 10 novembre 2026');
    expect(content.recipient).toEqual([]);
    expect(
      letterContent(SENDER, 'O', 'T.', DATE, {
        company: 'Atelier Exemple',
        postcode: null,
        city: 'Paris',
      }).recipient,
    ).toEqual(['Atelier Exemple', 'Paris']);
  });

  it('ne signe pas deux fois quand le texte se termine déjà par le nom', () => {
    const seul = letterContent(SENDER, 'Objet', 'Texte.\n\nCordialement,\n\nalice martin', DATE);
    const colle = letterContent(SENDER, 'Objet', 'Texte.\n\nCordialement,\nAlice Martin', DATE);

    expect(seul.paragraphs).toEqual(['Texte.', 'Cordialement,']);
    expect(colle.paragraphs).toEqual(['Texte.', 'Cordialement,']);
    expect(seul.signature).toBe('Alice Martin');
  });
});

describe('letterFileName', () => {
  it('donne un nom de fichier sans accent ni caractère spécial', () => {
    expect(letterFileName({ ...SENDER, firstName: 'Zoé' }, 'Société Générale / IT')).toBe(
      'LM_Societe_Generale_IT_Zoe_Martin.pdf',
    );
    expect(letterFileName(SENDER, '../../etc')).toBe('LM_etc_Alice_Martin.pdf');
  });
});

describe('buildLetterPdf', () => {
  it('produit un PDF, même avec des accents, des apostrophes courbes et un émoji', async () => {
    const body = `Bonjour,\n\n${'L’œuvre coûte 10 € – déjà ! 🙂 '.repeat(40)}\n\nCordialement,`;
    const bytes = await buildLetterPdf(letterContent(SENDER, 'Candidature', body, DATE));

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('ajoute des pages quand le texte dépasse une page', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const body = Array.from({ length: 80 }, (_, i) => `Paragraphe ${i}.`).join('\n\n');

    const bytes = await buildLetterPdf(letterContent(SENDER, 'Candidature', body, DATE));

    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
