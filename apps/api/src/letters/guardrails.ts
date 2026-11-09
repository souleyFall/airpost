import { fold, profileTerms } from '../scoring/scoring';
import type { Profile } from '../profile/profile.schema';
import { redactPersonalData } from '../llm/redact';

/**
 * Garde-fous appliqués à CHAQUE lettre générée, avant qu'un humain ne la voie. Un modèle de langage invente
 * volontiers (un diplôme, un chiffre, une expérience) : la règle est que la lettre ne dit que ce que le profil
 * ou l'offre disent. Ces contrôles sont des fonctions pures, testées une par une.
 */
export type Violation =
  | 'length'
  | 'placeholder'
  | 'contact_data'
  | 'ai_mention'
  | 'invented_number'
  | 'ungrounded_fact'
  | 'no_fact';

export const MIN_WORDS = 120;
export const MAX_WORDS = 350;

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Tout le texte du profil qui peut légitimement être cité dans une lettre. */
export function profileCorpus(profile: Profile): string {
  return [
    profile.headline,
    profile.summary,
    ...profile.education.flatMap((e) => [
      e.school,
      e.degree,
      String(e.startYear),
      String(e.endYear ?? ''),
    ]),
    ...profile.experiences.flatMap((e) => [
      e.company,
      e.role,
      e.startDate,
      e.endDate ?? '',
      ...e.achievements,
    ]),
    ...profile.skills.languages,
    ...profile.skills.frameworks,
    ...profile.skills.tools,
    ...profile.skills.other,
    // Disponibilité : transmise au modèle avec le profil, donc citable.
    profile.search.startDate,
    ...profile.search.rhythms,
  ].join('\n');
}

/** Nombres écrits en chiffres (« 40 % », « 2025 », « 3,5 ») ; les séparateurs de milliers sont ignorés. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));
}

/**
 * Nombres de la lettre absents du profil comme de l'offre : un « 40 % » ou un « 5 ans d'expérience » inventé est
 * le défaut le plus grave d'une lettre générée. L'année en cours est permise (« depuis 2025 », dates de début).
 */
export function inventedNumbers(
  body: string,
  allowedSources: string[],
  now = new Date(),
): string[] {
  const allowed = new Set(numbersIn(allowedSources.join('\n')));
  allowed.add(String(now.getFullYear()));
  return [...new Set(numbersIn(body))].filter((n) => !allowed.has(n));
}

/** Les citations que le modèle déclare avoir utilisées doivent exister, mot pour mot, dans le profil. */
export function ungroundedFacts(facts: string[], profile: Profile): string[] {
  const corpus = fold(profileCorpus(profile)).replace(/\s+/g, ' ');
  // Citations courtes acceptées : compétences et éléments de disponibilité (« asap », « 2J_3J »).
  const skills = new Set(
    [...profileTerms(profile), profile.search.startDate, ...profile.search.rhythms].map(fold),
  );
  return facts.filter((fact) => {
    const normalized = fold(fact).replace(/\s+/g, ' ').trim();
    // Une compétence du profil (« React ») est une citation légitime même courte ; sinon 8 caractères au moins,
    // pour qu'un mot isolé et banal ne valide pas n'importe quelle citation.
    if (skills.has(normalized)) return false;
    return normalized.length < 8 || !corpus.includes(normalized);
  });
}

const PLACEHOLDER = /\[[^\]\n]{1,60}\]|\{\{|\}\}|<[^>\n]{1,40}>|xxx+|lorem ipsum/i;
const AI_MENTION =
  /en tant qu['’]?\s?(?:ia|intelligence artificielle|mod[eè]le)|mod[eè]le de langage|\bas an ai\b/i;

export interface GuardrailInput {
  subject: string;
  body: string;
  usedFacts: string[];
}

export interface GuardrailContext {
  profile: Profile;
  /** Textes de l'offre dont les chiffres sont permis (intitulé, description). */
  offerText: string;
  now?: Date;
}

export interface GuardrailResult {
  violations: Violation[];
  /** Détail utile pour le rappel au modèle (chiffres ou citations en cause), jamais montré tel quel à l'utilisateur. */
  details: { numbers: string[]; facts: string[] };
}

export function checkLetter(letter: GuardrailInput, context: GuardrailContext): GuardrailResult {
  const violations = new Set<Violation>();
  const words = wordCount(letter.body);
  if (words < MIN_WORDS || words > MAX_WORDS) violations.add('length');

  const text = `${letter.subject}\n${letter.body}`;
  if (PLACEHOLDER.test(text)) violations.add('placeholder');
  // Les coordonnées sont ajoutées localement après coup : le modèle n'en écrit jamais.
  if (redactPersonalData(text) !== text) violations.add('contact_data');
  if (AI_MENTION.test(text)) violations.add('ai_mention');

  const numbers = inventedNumbers(
    text,
    [profileCorpus(context.profile), context.offerText],
    context.now,
  );
  if (numbers.length > 0) violations.add('invented_number');

  const facts = ungroundedFacts(letter.usedFacts, context.profile);
  if (letter.usedFacts.length === 0) violations.add('no_fact');
  if (facts.length > 0) violations.add('ungrounded_fact');

  return { violations: [...violations], details: { numbers, facts } };
}

/**
 * Technologies citées dans la lettre mais absentes du profil : pas un rejet (« je souhaite monter en
 * compétences sur Kubernetes » est honnête), mais l'utilisateur doit le voir à la relecture.
 */
const KNOWN_TECH = [
  'Angular',
  'Vue',
  'React',
  'Svelte',
  'Next.js',
  'Node.js',
  'NestJS',
  'Express',
  'Django',
  'Flask',
  'FastAPI',
  'Spring',
  'Laravel',
  'Symfony',
  'Java',
  'Kotlin',
  'Swift',
  'Python',
  'TypeScript',
  'JavaScript',
  'PHP',
  'Go',
  'Rust',
  'C#',
  'C++',
  '.NET',
  'Ruby',
  'Docker',
  'Kubernetes',
  'Terraform',
  'Ansible',
  'AWS',
  'Azure',
  'GCP',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
  'Kafka',
  'GraphQL',
  'Jenkins',
  'GitLab',
  'Linux',
];

export function claimedTechNotInProfile(body: string, profile: Profile): string[] {
  const text = fold(body);
  const known = new Set(profileTerms(profile).map(fold));
  return KNOWN_TECH.filter((tech) => {
    const term = fold(tech);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text) && !known.has(term);
  });
}
