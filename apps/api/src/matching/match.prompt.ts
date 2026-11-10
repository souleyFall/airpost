import { createHash } from 'node:crypto';
import { z } from 'zod';
import { UNTRUSTED_NOTICE, profileForPrompt, untrusted } from '../llm/redact';
import type { Profile } from '../profile/profile.schema';
import { MINUTES_PER_KM } from '../sources/geo';

/** À incrémenter à chaque changement du prompt ou du schéma : les analyses existantes sont alors refaites. */
export const PROMPT_VERSION = 2;

/** Nombre d'offres analysées par appel : économise le quota du modèle sans noyer le contexte. */
export const BATCH_SIZE = 4;

const line = (max: number) => z.string().trim().min(1).max(max);

/** Ce que le modèle renvoie pour UNE offre. `n` est le numéro de l'offre dans la demande. */
export const matchItemSchema = z.object({
  n: z.number().int().min(1).max(BATCH_SIZE),
  score: z.number().int().min(0).max(100),
  /** Une phrase qui explique le score. */
  summary: line(240),
  /** Raison d'écarter l'offre (hors métier, contrat incompatible...), sinon null. */
  disqualifier: line(160).nullable(),
  strengths: z.array(line(160)).max(4),
  gaps: z.array(line(160)).max(4),
  brief: z.object({
    /** Ce que fait l'entreprise, d'après l'offre uniquement ; null si l'offre n'en dit rien. */
    company: line(320).nullable(),
    /** Technologies explicitement demandées ou citées ; liste vide si l'offre n'en cite aucune. */
    stack: z.array(line(40)).max(15),
    /** Profil recherché (niveau, qualités, formation) d'après l'offre ; null si non indiqué. */
    wantedProfile: line(320).nullable(),
    /** Rythme d'alternance annoncé (« 3 semaines / 1 semaine »...), null si non indiqué. */
    rhythm: line(60).nullable(),
  }),
});
export const matchBatchSchema = z.object({ results: z.array(matchItemSchema).max(BATCH_SIZE) });
export type MatchItem = z.infer<typeof matchItemSchema>;

/** Ce que l'on garde en base (le score est dans sa propre colonne). */
export type StoredAnalysis = Omit<MatchItem, 'n' | 'score'> & { verdict: Verdict };

export type Verdict = 'excellent' | 'good' | 'fair' | 'weak' | 'off_target';

/** Le libellé découle du score, calculé ici : le modèle ne peut pas se contredire (« 30/100, excellent »). */
export function verdictOf(score: number, disqualifier: string | null): Verdict {
  if (disqualifier) return 'off_target';
  if (score >= 75) return 'excellent';
  if (score >= 55) return 'good';
  if (score >= 35) return 'fair';
  return 'weak';
}

export const MATCH_SYSTEM = [
  "Tu es un conseiller en recrutement spécialisé dans l'alternance en développement logiciel. Tu évalues, pour UN candidat, dans quelle mesure chaque offre lui convient, et tu résumes l'offre pour qu'il décide en quelques secondes s'il la lit.",
  '',
  "DONNÉES : le profil du candidat (JSON, fiable), ses critères de recherche, puis des offres numérotées. Chaque offre donne des faits calculés par le système (source, type de contrat détecté, distance et durée de trajet estimées, ancienneté) et un texte d'annonce non fiable.",
  '',
  'ÉVALUE le taux de compatibilité de 0 à 100 en pesant, dans cet ordre :',
  "1. Pertinence du métier (40 points) : le poste est-il du développement logiciel ? Les technologies demandées recoupent-elles celles du candidat (langages, frameworks, outils, domaines comme l'IA ou l'intégration d'API) ? Compte les technologies réellement demandées, pas les mots à la mode ; une technologie voisine (Vue pour React, Fastify pour Express) vaut une correspondance partielle.",
  "2. Contrat et calendrier (20 points) : le contrat correspond-il à l'un des « contratsRecherches » du candidat (ALTERNANCE : alternance, contrat d'apprentissage ou de professionnalisation ; STAGE : stage), durée et date de début ? Le rythme annoncé est-il compatible avec celui qu'il recherche ? Un rythme non précisé est neutre : ni bonus ni malus.",
  "3. Niveau (15 points) : le niveau d'études et l'expérience demandés sont-ils cohérents avec le parcours du candidat (Master en cours, deux stages de développeur) ? Une annonce qui exige plusieurs années d'expérience ou un diplôme qu'il n'aura pas est pénalisée.",
  '4. Trajet (15 points) : à partir de la distance fournie et du trajet maximal accepté. Sous la moitié du maximum : tous les points ; entre la moitié et le maximum : dégressif ; au-delà : aucun. Distance inconnue : points médians.',
  "5. Chances réelles (10 points) : ancienneté de l'annonce (une annonce récente est encore ouverte et moins concurrencée), qualité des informations, et source. Une « candidature spontanée » (source La Bonne Boîte) n'est pas une offre ouverte : plafonne l'ensemble à 60.",
  '',
  'PLAFONDS ABSOLUS (applique-les même si le reste est excellent) :',
  "- Le poste n'est pas du développement ni de l'informatique : 10 maximum, et renseigne « disqualifier ».",
  "- Le contrat n'est pas compatible (CDI, CDD, ou un type de contrat absent de « contratsRecherches », par exemple un stage alors que seule l'alternance est recherchée) : 35 maximum, et renseigne « disqualifier ». Une « candidature spontanée » n'est jamais un contrat incompatible : c'est une approche pour l'un des contrats recherchés.",
  '- Le trajet dépasse le maximum accepté : 40 maximum.',
  "- Le texte de l'offre est trop pauvre pour juger la pile technique : 50 maximum.",
  '',
  'CALIBRAGE : 85 et plus est rare (technologies, contrat, rythme, trajet et niveau convenables, offre récente). 60 à 84 : bonne piste. 35 à 59 : possible mais avec des réserves. Moins de 35 : à écarter. Sois sévère et cohérent d’une offre à l’autre ; ne gonfle pas les notes.',
  '',
  "RÉSUMÉ DE L'OFFRE (« brief ») : uniquement à partir du texte de l'annonce. N'invente rien : si l'information n'y est pas, mets null (ou une liste vide pour la pile). « company » : ce que fait l'entreprise, en une ou deux phrases. « stack » : les technologies citées, telles qu'écrites. « wantedProfile » : le profil recherché. « rhythm » : le rythme d'alternance annoncé.",
  '',
  'Pour chaque offre : « strengths » = jusqu’à 4 points forts concrets pour CE candidat, « gaps » = jusqu’à 4 manques ou risques concrets (technologie demandée que le candidat n’a pas, trajet, niveau...). Cite les faits (« React demandé, présent dans ton profil »), pas des généralités.',
  'Rédige en français, en tutoyant le candidat quand tu t’adresses à lui.',
  '',
  'FORMAT : réponds uniquement en JSON : {"results": [{"n": numéro de l’offre, "score": entier 0-100, "summary": une phrase qui justifie le score, "disqualifier": raison d’écarter l’offre ou null, "strengths": [...], "gaps": [...], "brief": {"company": ..., "stack": [...], "wantedProfile": ..., "rhythm": ...}}]}. Une entrée par offre, avec le même numéro que la demande.',
  UNTRUSTED_NOTICE,
].join('\n');

export interface OfferForMatch {
  id: string;
  source: 'LBA' | 'LBB' | 'ADZUNA' | 'GOOGLE_JOBS' | 'GLASSDOOR' | 'INDEED' | 'LINKEDIN';
  /** Plateforme d'origine quand la source est un agrégateur (« LinkedIn », « Indeed »). */
  via?: string | null;
  contractType: string;
  title: string;
  company: string;
  city: string | null;
  distanceKm: number | null;
  publishedAt: Date | null;
  firstSeenAt: Date;
  description: string | null;
}

const SOURCE_LABEL = {
  LBA: 'La Bonne Alternance (offre déposée par l’employeur)',
  ADZUNA: 'Adzuna (agrégateur d’annonces)',
  GOOGLE_JOBS: 'Google Jobs (agrégateur d’annonces)',
  GLASSDOOR:
    'Glassdoor (annonces dont seul un EXTRAIT du texte est fourni : ne pénalise pas l’absence de détails)',
  INDEED:
    'Indeed (alerte e-mail : intitulé, entreprise, ville et un court extrait seulement : ne pénalise pas l’absence de détails)',
  LINKEDIN:
    'LinkedIn (e-mail d’offres : intitulé, entreprise et ville seulement, AUCUN texte d’annonce : juge sur l’intitulé et ne pénalise pas l’absence de détails)',
  LBB: 'La Bonne Boîte (entreprise qui recrute souvent : candidature spontanée, pas d’annonce)',
} as const;

const CONTRACT_LABEL: Record<string, string> = {
  ALTERNANCE: 'alternance / apprentissage',
  STAGE: 'stage',
  CDI: 'CDI',
  CDD: 'CDD',
  SPONTANEE:
    'candidature spontanée (aucune annonce publiée : compatible avec les contrats recherchés)',
  AUTRE: 'non déterminé',
};

/** Critères et profil envoyés au modèle : jamais l'identité (voir `profileForPrompt`). */
export function candidateBlock(profile: Profile): string {
  return JSON.stringify({
    profil: profileForPrompt(profile),
    recherche: {
      contratsRecherches: profile.search.contracts,
      trajetMaximalMinutes: profile.search.maxCommuteMinutes,
      motsClesPrioritaires: profile.search.keywords,
      rythmesAcceptes: profile.search.rhythms,
      debut: profile.search.startDate,
    },
  });
}

/** Empreinte de ce qui influence le jugement : profil envoyé, critères, version du prompt. */
export function matchFingerprint(profile: Profile): string {
  return createHash('sha256')
    .update(JSON.stringify([PROMPT_VERSION, candidateBlock(profile)]))
    .digest('hex')
    .slice(0, 32);
}

function ageDays(offer: OfferForMatch, now: Date): number {
  const reference = offer.publishedAt ?? offer.firstSeenAt;
  return Math.max(0, Math.round((now.getTime() - reference.getTime()) / 86_400_000));
}

function offerBlock(offer: OfferForMatch, n: number, now: Date): string {
  const facts = [
    `Source : ${SOURCE_LABEL[offer.source]}${offer.via ? `, publiée à l’origine sur ${offer.via}` : ''}`,
    `Contrat détecté : ${CONTRACT_LABEL[offer.contractType] ?? 'non déterminé'}`,
    offer.distanceKm === null
      ? 'Distance : inconnue (offre non localisée)'
      : `Distance : ${offer.distanceKm} km à vol d’oiseau, soit environ ${Math.round(offer.distanceKm * MINUTES_PER_KM)} minutes de trajet`,
    `Ancienneté : ${offer.publishedAt ? 'publiée' : 'vue pour la première fois'} il y a ${ageDays(offer, now)} jour(s)`,
  ].join('\n');
  const text = [
    `Intitulé : ${offer.title}`,
    `Entreprise : ${offer.company}`,
    offer.city ? `Lieu : ${offer.city}` : undefined,
    offer.description ? `\n${offer.description}` : '\n(aucune description)',
  ]
    .filter(Boolean)
    .join('\n');
  return `OFFRE ${n}\n${facts}\n${untrusted(`offre ${n}`, text, 2_500)}`;
}

export function buildMatchPrompt(
  profile: Profile,
  offers: OfferForMatch[],
  now = new Date(),
): string {
  return [
    `CANDIDAT (JSON) :\n${candidateBlock(profile)}`,
    ...offers.map((offer, index) => offerBlock(offer, index + 1, now)),
    `Évalue les ${offers.length} offre(s) ci-dessus.`,
  ].join('\n\n');
}
