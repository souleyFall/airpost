import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isValidRecipient } from '../gmail/mime';
import { UNTRUSTED_NOTICE, untrusted } from '../llm/redact';
import { normalizeText } from '../sources/dedup';

/** Texte d'annonce collé par l'utilisateur : assez long pour être une annonce, borné pour le stockage. */
export const PASTE_MIN = 80;
export const PASTE_MAX = 20_000;

/** Ce que le modèle extrait du texte collé. Le texte lui-même reste la description : le modèle ne réécrit rien. */
export const extractionSchema = z.object({
  title: z.string().trim().min(2).max(200),
  company: z.string().trim().min(1).max(200).nullable(),
  city: z.string().trim().min(1).max(80).nullable(),
});
export type Extraction = z.infer<typeof extractionSchema>;

export const EXTRACTION_SYSTEM = [
  "Tu lis une annonce d'emploi copiée par un candidat depuis un site (LinkedIn, Indeed, Welcome to the Jungle, site d'entreprise...) et tu en extrais trois informations.",
  'Réponds uniquement en JSON : {"title": intitulé du poste tel qu\'écrit dans l\'annonce, "company": nom de l\'entreprise qui recrute ou null, "city": commune du poste ou null}.',
  "Règles : n'invente rien, mets null si l'information est absente ou incertaine. « company » est l'employeur, jamais le site d'emploi, ni une école, ni un cabinet qui publie pour un client non nommé. « city » est un nom de commune seul, sans code postal, département, région ni pays (« Paris », pas « Paris 75011 » ni « Île-de-France »).",
  UNTRUSTED_NOTICE,
].join('\n');

export function buildExtractionPrompt(text: string): string {
  return `ANNONCE :\n${untrusted('annonce collée', text)}`;
}

/** Adresses génériques qui ne mènent à personne : jamais proposées comme contact. */
const NO_REPLY = /^(no-?reply|do-?not-?reply|ne-?pas-?repondre|noreply)/i;

/**
 * Adresse de contact trouvée dans le texte collé, cherchée ICI et pas par le modèle (le texte qu'il reçoit est expurgé
 * des adresses). La première adresse valide et non générique ; null sinon.
 */
export function findContactEmail(text: string): string | null {
  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    const address = match[0].replace(/\.+$/, '').toLowerCase();
    if (!NO_REPLY.test(address) && isValidRecipient(address)) return address;
  }
  return null;
}

/** Lien de l'annonce : gardé pour la rouvrir d'un clic, jamais visité par le serveur. https seulement. */
export function cleanApplyUrl(value: string | null | undefined): string | null {
  const url = (value ?? '').trim();
  if (!url || url.length > 2_000 || !URL.canParse(url)) return null;
  const parsed = new URL(url);
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password
    ? parsed.toString()
    : null;
}

/** Identifiant stable d'une offre ajoutée à la main : la même annonce collée deux fois reste la même offre. */
export function manualExternalId(title: string, company: string, city: string | null): string {
  const key = [title, company, city ?? ''].map(normalizeText).join('|');
  return `manual-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}
