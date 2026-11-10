import { createHash } from 'node:crypto';
import {
  MAX_COMPANY,
  MAX_DESCRIPTION,
  MAX_TITLE,
  UNKNOWN_COMPANY,
  cleanText,
  parsePostedAt,
} from '../normalize';
import { normalizeText } from '../dedup';
import type { NormalizedOffer } from '../source.types';
import type { SenderRule } from './alert-sender';

/** Expéditeur des alertes Indeed (relevé sur de vrais messages) et domaine de la signature attendue. */
export const INDEED_SENDER: SenderRule = {
  address: 'donotreply@jobalert.indeed.com',
  domain: 'indeed.com',
};

/** Les liens des annonces sont des liens de suivi d'Indeed : seul cet hôte est accepté, et jamais ouvert par le serveur. */
const TRACKING_HOST = 'engage.indeed.com';
const MAX_BLOCK_LINES = 14;

export interface ParsedAlert {
  offers: NormalizedOffer[];
  /** Blocs d'annonce illisibles (format inattendu, lien étranger) : comptés, jamais détaillés. */
  skipped: number;
}

/** Espaces insécables (normal et fin) : écrits par code pour ne pas dépendre d'un caractère invisible dans le fichier. */
const NO_BREAK_SPACES = new RegExp('[\\u00a0\\u202f]', 'g');

function clean(line: string): string {
  return line.replace(NO_BREAK_SPACES, ' ').replace(/[’‘]/g, "'").trim();
}

function trackingUrl(line: string): string | null {
  if (!/^https:\/\/\S+$/.test(line) || !URL.canParse(line)) return null;
  const url = new URL(line);
  return url.protocol === 'https:' && url.hostname === TRACKING_HOST ? line : null;
}

/** « Nanterre (92) » → { city: 'Nanterre', postcode: undefined } ; le numéro entre parenthèses est le département. */
function cityOf(place: string): string | undefined {
  const city = place.replace(/\s*\((?:\d{2,3}|2[AB])\)\s*$/i, '').trim();
  return cleanText(city, 80);
}

/** « yele - Nanterre (92) » → entreprise « yele », lieu « Nanterre (92) ». Découpe sur le DERNIER « - » : un nom d'entreprise peut en contenir. */
function splitCompanyPlace(line: string): { company: string; place: string } | null {
  const index = line.lastIndexOf(' - ');
  if (index <= 0 || index >= line.length - 3) return null;
  return { company: line.slice(0, index).trim(), place: line.slice(index + 3).trim() };
}

const SALARY = /(€|\$|£).*\bpar (an|mois|semaine|jour|heure)\b/i;
const AGE = /^(publi[ée]|il y a|aujourd|today|\d+\s*(jours?|heures?|semaines?|mois))/i;
const SIMPLE_APPLY = /^candidature simplifi[ée]e$/i;

/** Identifiant stable d'une annonce : le même poste, dans le même lieu, reste le même d'une alerte à l'autre. */
export function alertExternalId(title: string, company: string, city: string | undefined): string {
  const key = [title, company, city ?? ''].map(normalizeText).join('|');
  return `alert-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

/**
 * Analyse le corps TEXTE d'une alerte Indeed. Structure observée (relevée sur un vrai message) :
 *
 *   9 nouveaux emplois développeur full stack - Paris (75)
 *
 *   Titre de l'annonce
 *   Entreprise - Ville (département)
 *   De 42 000 € à 46 000 € par an          (facultatif)
 *   Candidature simplifiée                  (facultatif)
 *   Extrait de l'annonce...                 (facultatif)
 *   Publié à l'instant | il y a 3 jours
 *   https://engage.indeed.com/f/a/...       (lien de suivi, toujours seul sur sa ligne : il termine le bloc)
 *
 *   ...
 *   Afficher tous les emplois
 *
 * Tout ce qui vient du message est une donnée non fiable : bornes de longueur, liens filtrés par hôte.
 */
export function parseIndeedAlert(text: string, receivedAt: Date): ParsedAlert {
  const lines = text.split(/\r?\n/).map(clean);
  const start = lines.findIndex((line) =>
    /^\d+\s+nouv(?:eaux|eau|el|elles|elle)\s+emplois?\b/i.test(line),
  );
  if (start < 0) return { offers: [], skipped: 0 };
  const end = lines.findIndex((line, i) => i > start && /^afficher tous les emplois/i.test(line));
  const body = lines.slice(start + 1, end < 0 ? undefined : end);

  const offers: NormalizedOffer[] = [];
  let skipped = 0;
  let block: string[] = [];

  for (const line of body) {
    if (line === '') continue;
    const url = trackingUrl(line);
    if (url === null && /^https?:\/\//i.test(line)) {
      // Lien étranger à Indeed : le bloc est écarté (un message imité pourrait y glisser un lien piégé).
      skipped++;
      block = [];
      continue;
    }
    if (url === null) {
      block.push(line);
      continue;
    }
    const offer = toOffer(block, url, receivedAt);
    if (offer) offers.push(offer);
    else skipped++;
    block = [];
  }
  return { offers, skipped };
}

function toOffer(block: string[], url: string, receivedAt: Date): NormalizedOffer | null {
  if (block.length < 2 || block.length > MAX_BLOCK_LINES) return null;
  const [title, companyLine, ...rest] = block;
  const placed = splitCompanyPlace(companyLine ?? '');
  if (!title || !placed) return null;

  const details = [...rest];
  const ageText =
    details.length > 0 && AGE.test(details[details.length - 1] ?? '') ? details.pop() : undefined;
  const salary = details.find((line) => SALARY.test(line));
  const snippet = details.filter((line) => line !== salary && !SIMPLE_APPLY.test(line)).join(' ');
  const description = [salary ? `Salaire : ${salary}` : '', snippet].filter(Boolean).join('\n\n');

  const city = cityOf(placed.place);
  const companyName = cleanText(placed.company, MAX_COMPANY) ?? UNKNOWN_COMPANY;
  const cleanTitle = cleanText(title, MAX_TITLE) ?? 'Offre sans titre';
  return {
    source: 'INDEED',
    externalId: alertExternalId(cleanTitle, companyName, city),
    title: cleanTitle,
    company: companyName,
    city,
    description: cleanText(description, MAX_DESCRIPTION),
    // Lien de suivi propre au destinataire : il s'ouvre depuis l'interface (jamais suivi par le serveur).
    applyUrl: url,
    channel: 'SITE',
    publishedAt: parsePostedAt(ageText, receivedAt),
  };
}
