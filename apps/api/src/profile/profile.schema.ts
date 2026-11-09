import { z } from 'zod';

/**
 * Profil du candidat : ce que le scoring et la génération des lettres ont besoin de savoir.
 *
 * Choix de conception :
 * - `strictObject` partout : un champ inconnu est refusé (pas d'écriture de données non prévues).
 * - Toutes les chaînes et listes ont une taille maximale : le profil est envoyé à un modèle de langage,
 *   on ne laisse pas grossir sans limite ce qui y part.
 * - Minimisation : ni adresse complète ni date de naissance. La ville et le code postal suffisent
 *   pour estimer un trajet ; le géocodage se fait plus tard, à partir du code postal.
 */
const text = (max: number) => z.string().trim().min(1).max(max);
const shortList = (max: number, itemMax = 60) => z.array(text(itemMax)).max(max);
const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'format AAAA-MM attendu');

const identity = z.strictObject({
  firstName: text(80),
  lastName: text(80),
  // Facultatifs : n'apparaissent dans une lettre que si le candidat les renseigne.
  email: z.email().max(254).optional(),
  phone: z
    .string()
    .regex(/^\+?[0-9 .()-]{6,20}$/, 'numéro invalide')
    .optional(),
  city: text(80),
  postcode: z.string().regex(/^\d{5}$/, '5 chiffres attendus'),
  websiteUrl: z
    .url({ protocol: /^https$/ })
    .max(200)
    .optional(),
});

const education = z
  .strictObject({
    school: text(120),
    degree: text(160),
    startYear: z.number().int().min(1980).max(2100),
    // Absente : formation en cours.
    endYear: z.number().int().min(1980).max(2100).optional(),
  })
  .refine((e) => e.endYear === undefined || e.endYear >= e.startYear, {
    message: 'la fin précède le début',
    path: ['endYear'],
  });

const experience = z
  .strictObject({
    company: text(120),
    role: text(120),
    startDate: yearMonth,
    // Absente : poste en cours.
    endDate: yearMonth.optional(),
    /**
     * Réalisations chiffrées si possible (méthode XYZ : « j'ai fait X, mesuré par Y, en faisant Z »).
     * La génération des lettres ne doit citer que ce qui figure ici : rien d'inventé.
     */
    achievements: z.array(text(300)).max(10),
  })
  // AAAA-MM se compare correctement comme du texte.
  .refine((e) => e.endDate === undefined || e.endDate >= e.startDate, {
    message: 'la fin précède le début',
    path: ['endDate'],
  });

const skills = z.strictObject({
  languages: shortList(40),
  frameworks: shortList(40),
  tools: shortList(40),
  other: shortList(40),
});

/** Rythmes d'alternance acceptés : 1 semaine / 1 semaine, 2 jours / 3 jours, 3 jours / 2 jours. */
export const RHYTHMS = ['1S_1S', '2J_3J', '3J_2J', 'AUTRE'] as const;

const search = z.strictObject({
  rhythms: z.array(z.enum(RHYTHMS)).max(RHYTHMS.length),
  // « asap » ou une date précise (AAAA-MM-JJ).
  startDate: z.union([z.literal('asap'), z.iso.date()]).default('asap'),
  maxCommuteMinutes: z.number().int().min(5).max(180).default(60),
  /** Mots-clés de la pile technique recherchée (utilisés par le scoring). */
  keywords: shortList(30),
  /** Codes ROME recherchés (ex. M1805 : études et développement informatique). */
  romeCodes: z
    .array(z.string().regex(/^[A-Z]\d{4}$/, 'code ROME attendu (ex. M1805)'))
    .max(10)
    .default(['M1805']),
  excludedCompanies: shortList(100, 120),
});

export const profileSchema = z.strictObject({
  identity,
  headline: text(160),
  summary: z.string().trim().max(1000),
  education: z.array(education).max(10),
  experiences: z.array(experience).max(20),
  skills,
  search,
});

export type Profile = z.infer<typeof profileSchema>;
