import { describe, expect, it } from 'vitest';
import { buildRawMessage, encodeHeader, isValidRecipient } from './mime';

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');
const bodyOf = (message: string) =>
  Buffer.from((message.split('\r\n\r\n')[1] ?? '').replace(/\r\n/g, ''), 'base64').toString('utf8');

describe('encodeHeader', () => {
  it('laisse l’ASCII tel quel', () => {
    expect(encodeHeader('Candidature - Alternance développeur'.replace('é', 'e'))).toBe(
      'Candidature - Alternance developpeur',
    );
  });

  it('encode les accents en mots RFC 2047 de 75 caractères au plus', () => {
    const subject =
      'Candidature — Alternance développeur full stack TypeScript — rythme 3 semaines / 1 semaine été';
    const encoded = encodeHeader(subject);
    for (const word of encoded.split('\r\n ')) {
      expect(word.length).toBeLessThanOrEqual(75);
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    }
    const back = encoded
      .split('\r\n ')
      .map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8'))
      .join('');
    expect(back).toBe(subject);
  });

  it('ne coupe jamais au milieu d’un caractère (émojis, accents)', () => {
    const subject = 'éééééééééééééééééééééééééé 😀😀😀😀😀😀😀😀😀😀';
    const back = encodeHeader(subject)
      .split('\r\n ')
      .map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8'))
      .join('');
    expect(back).toBe(subject);
  });
});

describe('buildRawMessage', () => {
  it('produit un message décodable avec destinataire, objet et corps en UTF-8', () => {
    const raw = buildRawMessage({
      to: 'rh@exemple.fr',
      subject: 'Candidature spontanée',
      body: 'Bonjour,\nJe suis disponible dès que possible.\n\nCordialement',
    });
    // base64url : ni « + » ni « / » ni « = »
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const message = decode(raw);
    expect(message).toContain('To: rh@exemple.fr\r\n');
    expect(message).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(bodyOf(message)).toBe(
      'Bonjour,\r\nJe suis disponible dès que possible.\r\n\r\nCordialement',
    );
  });

  it('accepte un brouillon sans destinataire (candidature par le site)', () => {
    const message = decode(buildRawMessage({ subject: 'Objet', body: 'Texte' }));
    expect(message).not.toContain('To:');
    expect(message.startsWith('Subject: Objet\r\n')).toBe(true);
  });

  it('empêche l’injection d’en-tête par l’objet', () => {
    const message = decode(
      buildRawMessage({
        subject: 'Objet\r\nBcc: victime@exemple.fr',
        body: 'Texte',
      }),
    );
    const headers = (message.split('\r\n\r\n')[0] ?? '').split('\r\n');
    expect(headers.some((line) => line.toLowerCase().startsWith('bcc:'))).toBe(false);
    expect(headers[0]).toBe('Subject: Objet Bcc: victime@exemple.fr');
  });

  it.each([
    'rh@exemple.fr\r\nBcc: x@y.fr',
    'rh@exemple.fr, autre@exemple.fr',
    '<rh@exemple.fr>',
    'sans-arobase',
    'rh@exemple',
    '',
  ])('refuse le destinataire « %s »', (to) => {
    expect(() => buildRawMessage({ to, subject: 'Objet', body: 'Texte' })).toThrow();
  });

  it('valide les adresses usuelles', () => {
    expect(isValidRecipient('prenom.nom+rh@entreprise.example.fr')).toBe(true);
    expect(isValidRecipient('a@b.c')).toBe(true);
  });
});
