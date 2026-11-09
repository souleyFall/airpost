/**
 * Construction d'un message e-mail (RFC 5322 / MIME) pour un brouillon Gmail.
 *
 * Sécurité : l'objet et le destinataire viennent de données modifiables (lettre éditée, offre collectée).
 * Un retour à la ligne glissé dans un en-tête permettrait d'en injecter un autre (Bcc, par exemple).
 * Tout est donc nettoyé ou refusé ici, à l'endroit unique où le message est assemblé.
 */

const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,5}$/;

export function isValidRecipient(address: string): boolean {
  return EMAIL.test(address);
}

// Contrôles ASCII (dont CR et LF), DEL et séparateurs de ligne Unicode. Construit depuis une chaîne : écrire ces
// séparateurs directement dans un littéral d'expression régulière casserait le fichier.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\x00-\\x1f\\x7f\\u2028\\u2029]+', 'g');

/** Enlève tout caractère de contrôle (dont CR et LF) : un en-tête tient sur une seule ligne. */
function singleLine(text: string): string {
  return text.replace(CONTROL_CHARS, ' ').trim();
}

function base64Lines(text: string): string {
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? []).join('\r\n');
}

/**
 * En-tête non ASCII : mots encodés « =?UTF-8?B?...?= » (RFC 2047), de 75 caractères au plus chacun, découpés
 * sur des frontières de caractères (jamais au milieu d'un caractère accentué).
 */
export function encodeHeader(value: string): string {
  const clean = singleLine(value);
  if (/^[ -~]*$/.test(clean)) {
    return clean;
  }
  const words: string[] = [];
  let chunk = '';
  for (const char of clean) {
    // 45 octets => 60 caractères base64 + 12 de gabarit = 72 : sous la limite de 75.
    if (Buffer.byteLength(chunk + char, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) {
    words.push(chunk);
  }
  return words
    .map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`)
    .join('\r\n ');
}

export interface DraftMessage {
  to?: string;
  subject: string;
  body: string;
}

/** Message complet, encodé en base64 « URL-safe » comme l'exige l'API Gmail (champ `raw`). */
export function buildRawMessage(message: DraftMessage): string {
  if (message.to !== undefined && !isValidRecipient(message.to)) {
    throw new Error('Adresse de destinataire invalide');
  }
  const lines = [
    ...(message.to ? [`To: ${message.to}`] : []),
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(message.body.replace(/\r?\n/g, '\r\n')),
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}
