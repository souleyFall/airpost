import { z } from 'zod';
import { UNTRUSTED_NOTICE, profileForPrompt, untrusted } from '../llm/redact';
import type { Profile } from '../profile/profile.schema';
import { cleanSubject } from './letter.prompt';

/** Ce que le modèle renvoie : le corps seulement. L'objet, les coordonnées et la signature sont ajoutés localement. */
export const followUpSchema = z.object({
  body: z.string().trim().min(120).max(1_500),
  usedFacts: z.array(z.string().trim().min(1).max(300)).max(10),
});
export type GeneratedFollowUp = z.infer<typeof followUpSchema>;

/** Longueur du message en mots : une relance est courte (60 à 130 visés, 50 à 150 tolérés). */
export const FOLLOW_UP_WORDS = { min: 50, max: 150 } as const;

export const FOLLOW_UP_SYSTEM = [
  'Tu rédiges, en français, un message de RELANCE court et poli pour une candidature en alternance ou en stage (développement logiciel) envoyée il y a une semaine environ, restée sans réponse.',
  'Règles absolues :',
  "1. Utilise UNIQUEMENT les faits du profil et de la lettre déjà envoyée. N'invente aucun diplôme, entreprise, chiffre, durée, technologie ni résultat.",
  "2. Entre 60 et 130 mots, en deux paragraphes : d'abord un rappel de la candidature (le poste et l'entreprise) avec une question simple sur son avancement ; ensuite UN élément nouveau tiré du profil, différent de ceux déjà cités dans la lettre envoyée (un projet, une réalisation, une technologie), puis une proposition concrète (un court échange, ou transmettre ton code).",
  '3. Commence par « Madame, Monsieur, ». Ne signe pas, n’écris ni nom, ni coordonnées, ni formule de politesse finale : ils sont ajoutés automatiquement.',
  '4. Interdit : « je me permets de relancer », « dans l’attente d’une réponse favorable », « suite à mon précédent mail » seul, les excuses, la pression.',
  '5. Aucun texte à compléter ([...], <...>), aucun lien, aucune adresse e-mail, aucun numéro de téléphone, aucun chiffre qui ne figure pas dans le profil ou la lettre envoyée.',
  '6. Ne dis jamais que tu es une intelligence artificielle.',
  'Réponds uniquement en JSON : {"body": texte du message, "usedFacts": 1 à 4 citations copiées MOT POUR MOT du profil qui appuient le message}.',
  UNTRUSTED_NOTICE,
].join('\n');

export interface FollowUpContext {
  offer: { title: string; company: string };
  /** Lettre déjà envoyée : pour ne pas se répéter et rester cohérent. */
  sentLetter: string;
}

export function buildFollowUpPrompt(
  profile: Profile,
  context: FollowUpContext,
  feedback?: string,
): string {
  return [
    `PROFIL DU CANDIDAT (JSON) :\n${JSON.stringify(profileForPrompt(profile))}`,
    `CANDIDATURE : poste « ${context.offer.title} » chez ${context.offer.company}.`,
    `LETTRE DÉJÀ ENVOYÉE :\n${untrusted('lettre envoyée', context.sentLetter)}`,
    feedback,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** « Relance : <objet de la candidature> », sans doubler « Relance » ; sur une seule ligne (c'est un en-tête de message). */
export function followUpSubject(original: string | null | undefined): string {
  const base = (original ?? '').trim();
  if (!base) return 'Relance : ma candidature';
  return /^relance\b/i.test(base) ? cleanSubject(base) : cleanSubject(`Relance : ${base}`);
}
