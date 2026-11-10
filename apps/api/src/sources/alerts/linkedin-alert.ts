import { MAX_COMPANY, MAX_TITLE, UNKNOWN_COMPANY, cleanText } from '../normalize';
import type { NormalizedOffer } from '../source.types';
import type { SenderRule } from './alert-sender';
import type { ParsedAlert } from './indeed-alert';

/**
 * Expéditeurs des e-mails d'offres de LinkedIn. Les deux premiers ont été relevés sur de vrais messages (sélection
 * d'offres recommandées ; rappels d'offres enregistrées et « offres similaires »). Le troisième est l'adresse connue
 * des alertes de recherche : aucun exemplaire n'a encore été reçu, il est lu avec les mêmes règles strictes (un format
 * différent donne des blocs « ignorés », jamais de fausses annonces).
 */
export const LINKEDIN_SENDERS: readonly SenderRule[] = [
  { address: 'jobs-listings@linkedin.com', domain: 'linkedin.com' },
  { address: 'jobs-noreply@linkedin.com', domain: 'linkedin.com' },
  { address: 'jobalerts-noreply@linkedin.com', domain: 'linkedin.com' },
];

const NO_BREAK_SPACES = new RegExp('[\\u00a0\\u202f]', 'g');
/** Caractères invisibles (largeur nulle) que LinkedIn glisse dans certains noms d'entreprise. */
const ZERO_WIDTH = new RegExp('[\\u200b-\\u200d\\ufeff]', 'g');

function clean(line: string): string {
  return line.replace(ZERO_WIDTH, '').replace(NO_BREAK_SPACES, ' ').replace(/[’‘]/g, "'").trim();
}

/** Ligne qui termine chaque annonce. */
const VIEW = /^voir l'offre d'emploi\s*:\s*(https?:\/\/\S+)$/i;
/** Seul lien accepté : la page publique d'une annonce, identifiée par son numéro. */
const JOB_PATH = /^\/comm\/jobs\/view\/(\d{6,15})\/?$/;
/** Titres de rubrique collés au-dessus d'une annonce, et mentions collées en dessous : ce ne sont pas des champs. */
const HEADING = /^(vos autres offres d'emploi enregistr|voir des offres d'emploi similaires)/i;
const TRAILER = /^(postulez avec|candidature simplifi)/i;
/** Annonce à laquelle l'utilisateur vient de postuler : elle est déjà dans son suivi, on ne la repropose pas. */
const APPLIED = /^votre candidature a été envoyée/i;

/**
 * Numéro de l'annonce si la ligne est un lien LinkedIn vers une annonce, sinon null. Le lien reçu contient des jetons
 * personnels (dont un jeton de connexion à usage unique) : il n'est JAMAIS conservé, seul le numéro l'est.
 */
function jobId(link: string): string | null {
  if (!URL.canParse(link)) return null;
  const url = new URL(link);
  if (url.protocol !== 'https:' || url.hostname !== 'www.linkedin.com') return null;
  return JOB_PATH.exec(url.pathname)?.[1] ?? null;
}

/** « Paris, Île-de-France, France » → « Paris » ; « Paris et périphérie » → « Paris ». */
function cityOf(place: string): string | undefined {
  const first = (place.split(',')[0] ?? '').replace(/\s+et périphérie$/i, '');
  return cleanText(first, 80);
}

/**
 * Analyse le corps TEXTE d'un e-mail d'offres LinkedIn. Structure commune aux trois formats observés :
 *
 *   Intitulé du poste
 *   Entreprise
 *   Ville[, Région, Pays]
 *   Postulez avec un CV et un profil          (facultatif, collé)
 *                                             (ligne vide facultative)
 *   1 ancien élève | Cette entreprise recrute activement   (facultatif)
 *   Voir l'offre d'emploi : https://www.linkedin.com/comm/jobs/view/<numéro>/?<jetons>
 *
 *   ---------------------------------------------------------
 *
 * Tout ce qui vient du message est une donnée non fiable : longueurs bornées, lien filtré par hôte et par forme.
 */
export function parseLinkedinAlert(text: string): ParsedAlert {
  const lines = text.split(/\r?\n/).map(clean);
  const offers: NormalizedOffer[] = [];
  let skipped = 0;
  let segment: string[] = [];

  for (const line of lines) {
    const view = VIEW.exec(line);
    if (view) {
      const id = jobId(view[1] ?? '');
      const offer = id ? toOffer(segment, id) : null;
      if (offer === 'applied') {
        // Ni annonce ni erreur.
      } else if (offer) offers.push(offer);
      else skipped++;
      segment = [];
      continue;
    }
    // Séparateur ou ligne portant un autre lien : ce qui précède n'appartient pas à l'annonce suivante.
    if (/-{10,}/.test(line) || /https?:\/\//i.test(line)) {
      segment = [];
      continue;
    }
    segment.push(line);
  }
  return { offers, skipped };
}

function toOffer(segment: string[], id: string): NormalizedOffer | 'applied' | null {
  const paragraphs = segment
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').filter((l) => l !== ''))
    .filter((p) => p.length > 0);
  if (paragraphs.some((p) => APPLIED.test(p[0] ?? ''))) return 'applied';

  // Le dernier paragraphe est soit l'annonce, soit une mention d'une ligne (« 1 ancien élève ») posée sous l'annonce.
  let block = paragraphs.pop();
  if (block && block.length === 1) block = paragraphs.pop();
  if (!block) return null;
  const fields = block.filter((l) => !HEADING.test(l) && !TRAILER.test(l));
  if (fields.length !== 3) return null;

  const [title, company, place] = fields as [string, string, string];
  return {
    source: 'LINKEDIN',
    externalId: id,
    title: cleanText(title, MAX_TITLE) ?? 'Offre sans titre',
    company: cleanText(company, MAX_COMPANY) ?? UNKNOWN_COMPANY,
    city: cityOf(place),
    // Adresse publique reconstruite à partir du seul numéro : aucun jeton personnel n'est stocké.
    applyUrl: `https://www.linkedin.com/jobs/view/${id}/`,
    channel: 'SITE',
  };
}
