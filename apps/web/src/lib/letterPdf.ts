/** Ce qu'il faut du profil pour l'en-tête d'une lettre. */
export interface LetterSender {
  firstName: string;
  lastName: string;
  headline: string;
  email?: string;
  phone?: string;
  city?: string;
}

/** Destinataire : ce que l'offre en dit (les annonces ne donnent presque jamais la rue). */
export interface LetterRecipient {
  company?: string;
  postcode?: string | null;
  city?: string | null;
}

export interface LetterContent {
  /** En-tête : prénom nom, titre, adresse mail, téléphone (les lignes absentes du profil sont omises). */
  header: string[];
  /** Destinataire : nom de l'entreprise puis « code postal ville » (lignes absentes omises). */
  recipient: string[];
  /** « Ville, le 10 novembre 2026 ». */
  dateLine: string;
  subjectLine: string;
  paragraphs: string[];
  signature: string;
}

/** Texte sûr pour le PDF : caractères invisibles retirés, espaces spéciaux ramenés à l'espace simple. */
function tidy(value: string): string {
  return value
    .replace(new RegExp('[\\u200b-\\u200d\\ufeff]', 'g'), '')
    .replace(new RegExp('[\\u00a0\\u202f\\t]', 'g'), ' ')
    .trim();
}

const same = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' }) === 0;

/** Met la lettre en forme (sans rien dessiner) : c'est la partie testable de la génération du PDF. */
export function letterContent(
  sender: LetterSender,
  subject: string,
  body: string,
  date: Date = new Date(),
  to: LetterRecipient = {},
): LetterContent {
  const fullName = tidy(`${sender.firstName} ${sender.lastName}`);
  const header = [fullName, sender.headline, sender.email, sender.phone]
    .map((line) => tidy(line ?? ''))
    .filter((line) => line !== '');
  const day = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const city = tidy(sender.city ?? '');
  const recipient = [to.company ?? '', `${to.postcode ?? ''} ${to.city ?? ''}`]
    .map(tidy)
    .filter((line) => line !== '');

  const paragraphs = body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.split(/\r?\n/).map(tidy).filter(Boolean).join('\n'))
    .filter((p) => p !== '');
  // Si le texte se termine déjà par le nom, on ne signe pas deux fois.
  const last = paragraphs[paragraphs.length - 1];
  if (last !== undefined) {
    const lines = last.split('\n');
    if (same(lines[lines.length - 1] ?? '', fullName)) {
      lines.pop();
      if (lines.length > 0) paragraphs[paragraphs.length - 1] = lines.join('\n');
      else paragraphs.pop();
    }
  }
  return {
    header,
    recipient,
    dateLine: city ? `${city}, le ${day}` : `Le ${day}`,
    subjectLine: `Objet : ${tidy(subject)}`,
    paragraphs,
    signature: fullName,
  };
}

/** « LM_Entreprise_Prenom_Nom.pdf » : lettres, chiffres et tirets seulement. */
export function letterFileName(sender: LetterSender, company: string): string {
  const slug = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
  return `${['LM', slug(company), slug(sender.firstName), slug(sender.lastName)].filter(Boolean).join('_')}.pdf`;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 71; // 2,5 cm
const SIZE = 11;
const LEADING = 16;

/** Construit le PDF (A4, Helvetica). La bibliothèque est chargée à la demande : elle ne pèse pas sur le démarrage. */
export async function buildLetterPdf(content: LetterContent): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  type Font = typeof regular;
  const maxWidth = A4.width - 2 * MARGIN;

  /** La police standard ne connaît que l'alphabet latin : un caractère inconnu (émoji...) devient « ? ». */
  const encodable = (text: string) =>
    [...text]
      .map((char) => {
        try {
          regular.encodeText(char);
          return char;
        } catch {
          return '?';
        }
      })
      .join('');

  const wrap = (text: string, font: Font, size: number): string[] => {
    const lines: string[] = [];
    for (const raw of text.split('\n')) {
      let line = '';
      for (const word of raw.split(/ +/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      lines.push(line);
    }
    return lines;
  };

  let page = doc.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;
  const write = (
    text: string,
    font: Font = regular,
    size = SIZE,
    align: 'left' | 'right' = 'left',
  ) => {
    for (const line of wrap(encodable(text), font, size)) {
      if (y < MARGIN) {
        page = doc.addPage([A4.width, A4.height]);
        y = A4.height - MARGIN;
      }
      const x = align === 'right' ? A4.width - MARGIN - font.widthOfTextAtSize(line, size) : MARGIN;
      page.drawText(line, { x, y, size, font });
      y -= LEADING;
    }
  };
  const gap = (lines = 1) => {
    y -= LEADING * lines;
  };

  const [name, ...details] = content.header;
  if (name) write(name, bold, 14);
  for (const line of details) write(line);
  gap(1.5);
  const [company, ...address] = content.recipient;
  if (company) write(company, bold, SIZE, 'right');
  for (const line of address) write(line, regular, SIZE, 'right');
  if (content.recipient.length > 0) gap(0.8);
  write(content.dateLine, regular, SIZE, 'right');
  gap(1.5);
  write(content.subjectLine, bold);
  gap();
  for (const paragraph of content.paragraphs) {
    write(paragraph);
    gap(0.6);
  }
  gap();
  write(content.signature);

  doc.setTitle(content.subjectLine);
  doc.setAuthor(content.signature);
  return doc.save();
}

/** Propose le fichier au téléchargement (aucun envoi : le PDF est fabriqué dans le navigateur). */
export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
