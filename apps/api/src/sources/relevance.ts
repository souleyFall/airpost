import type { ContractType, OfferSource } from '../generated/prisma/enums';

/** Texte comparable : sans accents, en minuscules. */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Filtre de pertinence appliqué dès la collecte : l'utilisateur est développeur, une offre de comptable n'a pas
 * à être enregistrée (ni envoyée au modèle, dont les quotas sont limités). C'est un tri GROSSIER et volontairement
 * indulgent ; le jugement fin (« cette offre me convient-elle ? ») revient au modèle de langage.
 *
 * Règle : une offre est gardée si son INTITULÉ évoque le développement ou l'informatique. Un intitulé qui
 * n'évoque rien mais dont la description cite au moins deux termes techniques est aussi gardé. Un intitulé
 * clairement hors sujet (comptabilité, vente, restauration...) est écarté même si la description cite « Excel ».
 */
const TECH_TITLE = new RegExp(
  [
    'develop',
    'dev\\b',
    'devops',
    'full ?stack',
    'front ?end',
    'back ?end',
    'web',
    'logiciel',
    'software',
    'informatique',
    'numerique',
    'programm',
    'ingenieur (etudes|systeme|logiciel|ia|data|informatique)',
    'data',
    'donnees',
    'big data',
    '\\bia\\b',
    'intelligence artificielle',
    'machine learning',
    'cloud',
    'cyber',
    'application',
    'mobile',
    'react',
    'node',
    'java',
    'python',
    'php',
    'symfony',
    'typescript',
    '\\.net',
    'sql',
    '\\bapi\\b',
    'integrateur',
    '\\bit\\b',
    '\\bsi\\b',
    'systeme.? d.?information',
  ].join('|'),
);

const OFF_TOPIC_TITLE = new RegExp(
  [
    'comptab',
    'comptable',
    'gestionnaire de paie',
    'paie',
    'juridique',
    'avocat',
    'commercial',
    'vendeu',
    'vente',
    'cuisin',
    'serveu',
    'restaura',
    'boulang',
    'patiss',
    'boucher',
    'coiff',
    'esthetic',
    'infirmi',
    'aide.?soignant',
    'medecin',
    'pharmac',
    'mecanicien',
    'electricien',
    'plombier',
    'macon',
    'chauffeur',
    'livreur',
    'magasinier',
    'logisticien',
    'secretaire',
    'assistant(e)? (de direction|administrati|rh|social)',
    'ressources humaines',
    '\\brh\\b',
    'recrut',
    'sales',
    'account (executive|manager)',
    'communication',
    'credit',
    'audit',
    'finance',
    'scientifique',
    'chimi',
    'physique',
    'project manager',
    'charge(e)? de communication',
    'community manager',
    'marketing',
    'banque',
    'conseiller (client|commercial|financier|bancaire)',
    'assurance',
    'immobili',
    'agent (d.?accueil|de securite)',
    'educateur',
    'enseignant',
    'professeur',
    'architecte',
    'btp',
    'genie civil',
    'electrotech',
    'mecanique',
    'maintenance (industrielle|des batiments)',
  ].join('|'),
);

/** Termes techniques cherchés dans la description quand l'intitulé est muet. */
const TECH_BODY =
  /\b(react|node(\.?js)?|typescript|javascript|python|php|symfony|java|docker|sql|api|git|angular|vue|nestjs|laravel|django|spring|kubernetes|devops|full.?stack|front.?end|back.?end)\b/g;

/** Intitulés qui disent sans ambiguïté « développement » : gardés même si un mot hors sujet les accompagne. */
const STRONG_TITLE =
  /develop|\bdev\b|devops|full ?stack|front ?end|back ?end|logiciel|software|programm/;

export function isRelevantOffer(title: string, description?: string | null): boolean {
  const t = fold(title);
  if (STRONG_TITLE.test(t)) {
    return true;
  }
  const body = fold(description ?? '');
  const hits = new Set(body.match(TECH_BODY) ?? []);
  if (OFF_TOPIC_TITLE.test(t)) {
    // Intitulé mixte (« Data analyst banque », « Commercial web ») : un mot technique ne suffit pas, la description
    // tranche. Elle doit citer au moins une technologie ; sinon c'est un poste de banque, de vente ou de recrutement.
    return TECH_TITLE.test(t) && hits.size >= 1;
  }
  if (TECH_TITLE.test(t)) {
    return true;
  }
  return hits.size >= 2;
}

/**
 * Type de contrat, déduit du texte (aucune source ne le publie de façon fiable). « Alternance » l'emporte sur
 * « stage » : une annonce d'alternance peut mentionner un stage précédent, pas l'inverse.
 */
export function detectContractType(
  title: string,
  description?: string | null,
  source?: OfferSource,
): ContractType {
  // La Bonne Alternance ne sert que des contrats d'apprentissage ; une entreprise de La Bonne Boîte est approchée
  // pour une alternance (c'est le but de l'application) : leur texte ne dit rien du contrat.
  if (source === 'LBA' || source === 'LBB') return 'ALTERNANCE';
  const t = fold(title);
  const d = fold(description ?? '');
  const both = `${t}
${d}`;
  if (/alternan|apprenti|contrat de professionnalisation|contrat pro\b/.test(t))
    return 'ALTERNANCE';
  if (/\bstage\b|stagiaire|\binternship\b/.test(t)) return 'STAGE';
  if (/\bcdi\b/.test(t)) return 'CDI';
  if (/\bcdd\b|interim|temps partiel/.test(t)) return 'CDD';
  if (/alternan|apprenti|contrat de professionnalisation|contrat pro\b/.test(both))
    return 'ALTERNANCE';
  if (/\bstage\b|stagiaire|\binternship\b/.test(both)) return 'STAGE';
  if (/\bcdi\b/.test(both)) return 'CDI';
  if (/\bcdd\b/.test(both)) return 'CDD';
  return 'AUTRE';
}
