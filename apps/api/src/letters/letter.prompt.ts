import { z } from 'zod';
import { UNTRUSTED_NOTICE, profileForPrompt, untrusted } from '../llm/redact';
import type { Profile } from '../profile/profile.schema';
import type { Violation } from './guardrails';

/** Ce que le modèle doit renvoyer. Les coordonnées et la signature sont ajoutées localement, jamais par lui. */
export const letterSchema = z.object({
  subject: z.string().trim().min(5).max(120),
  body: z.string().trim().min(200).max(3_000),
  /** Citations copiées mot pour mot du profil, sur lesquelles repose la lettre (vérifiées par les garde-fous). */
  usedFacts: z.array(z.string().trim().min(1).max(300)).max(10),
});
export type GeneratedLetter = z.infer<typeof letterSchema>;

/**
 * Objet sur une seule ligne, sans caractère de contrôle. L'objet deviendra un en-tête de message (brouillon Gmail) :
 * un retour à la ligne y permettrait d'injecter d'autres en-têtes (« Bcc: ... »).
 */
export function cleanSubject(subject: string): string {
  const isControl = (char: string) => {
    const code = char.codePointAt(0) ?? 0;
    // C0 (dont \r et \n), DEL, C1, s\u00e9parateurs de ligne et de paragraphe Unicode.
    return code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029;
  };
  return [...subject]
    .map((char) => (isControl(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export const LETTER_SYSTEM = [
  'Tu rédiges, en français, une lettre de motivation pour une candidature en alternance ou en stage (développement logiciel).',
  'Règles absolues :',
  "1. Utilise UNIQUEMENT les faits du profil fourni. N'invente aucun diplôme, entreprise, chiffre, durée, technologie ni résultat.",
  "2. Tu peux reprendre une exigence de l'offre, mais ne prétends pas la maîtriser si elle ne figure pas dans le profil : dis que tu souhaites la découvrir ou l'approfondir.",
  "3. Entre 150 et 300 mots, en trois paragraphes : un lien précis avec l'entreprise et le poste ; deux réalisations concrètes tirées du profil ; la disponibilité et une conclusion.",
  "4. Commence par « Madame, Monsieur, ». Ne signe pas, n'écris ni nom, ni coordonnées, ni formule de politesse finale : ils sont ajoutés automatiquement.",
  '5. Aucun texte à compléter ([...], <...>), aucun lien, aucune adresse e-mail, aucun numéro de téléphone.',
  '6. Ne dis jamais que tu es une intelligence artificielle.',
  'Réponds uniquement en JSON : {"subject": objet du message (100 caractères au plus), "body": texte de la lettre, "usedFacts": 2 à 6 citations copiées MOT POUR MOT du profil qui appuient la lettre}.',
  UNTRUSTED_NOTICE,
].join('\n');

export interface OfferForPrompt {
  title: string;
  company: string;
  city?: string | null;
  description?: string | null;
}

export function buildLetterPrompt(
  profile: Profile,
  offer: OfferForPrompt,
  feedback?: string,
): string {
  const offerText = [
    `Intitulé : ${offer.title}`,
    `Entreprise : ${offer.company}`,
    offer.city ? `Lieu : ${offer.city}` : undefined,
    offer.description ? `\n${offer.description}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    `PROFIL DU CANDIDAT (JSON) :\n${JSON.stringify(profileForPrompt(profile))}`,
    `OFFRE :\n${untrusted('offre', offerText)}`,
    feedback,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const REMINDERS: Record<Violation, string> = {
  length: 'Respecte la longueur : entre 150 et 300 mots.',
  placeholder: 'Ne laisse aucun texte à compléter entre crochets, accolades ou chevrons.',
  contact_data: "N'écris aucune adresse e-mail, aucun numéro de téléphone, aucun lien.",
  ai_mention: 'Ne mentionne jamais que tu es une intelligence artificielle.',
  invented_number: "N'écris aucun chiffre qui ne figure pas dans le profil ou l'offre.",
  ungrounded_fact: 'Chaque élément de usedFacts doit être copié MOT POUR MOT depuis le profil.',
  no_fact: 'Renseigne usedFacts avec 2 à 6 citations du profil.',
};

/** Rappel pour la seconde tentative : on dit CE QUI est refusé, jamais le texte fautif. */
export function feedbackFor(violations: Violation[]): string {
  return `Ta réponse précédente a été refusée. ${violations.map((v) => REMINDERS[v]).join(' ')} Réécris la lettre complète.`;
}

export interface Identity {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

/** Lettre finale : corps généré + formule de politesse + signature et coordonnées, ajoutés ICI et pas par le modèle. */
export function assembleLetter(identity: Identity, body: string): string {
  const signature = [
    `${identity.firstName} ${identity.lastName}`,
    identity.phone,
    identity.email,
  ].filter(Boolean);
  return `${body.trim()}\n\nCordialement,\n${signature.join('\n')}`;
}
