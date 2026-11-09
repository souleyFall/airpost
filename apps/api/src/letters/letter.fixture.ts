import { exampleProfile } from '../profile/profile.fixture';

/** Citations exactes du profil fictif (les garde-fous vérifient qu'elles y figurent mot pour mot). */
export const FACT_ACHIEVEMENT = exampleProfile().experiences[0]?.achievements[0] ?? '';
export const FACT_DEGREE = 'Master développement et IA';

const PARAGRAPHS = [
  'Madame, Monsieur,',
  'Votre offre de développeur en alternance a retenu toute mon attention, car elle associe un produit concret à une équipe technique soucieuse de qualité. Je prépare actuellement un master et je cherche une entreprise où apprendre au contact de développeurs expérimentés tout en apportant des contributions utiles dès les premières semaines.',
  `Lors de mon stage chez Atelier Démo, j'ai travaillé sur un problème de performance. Concrètement, j'ai ${FACT_ACHIEVEMENT.charAt(0).toLowerCase()}${FACT_ACHIEVEMENT.slice(1)} Cette expérience m'a appris à mesurer avant d'optimiser, à documenter mes choix et à expliquer mes décisions à des collègues qui n'étaient pas développeurs. Je travaille avec TypeScript, React et Node.js, et je suis à l'aise avec Docker pour reproduire un environnement.`,
  "Je suis disponible dès que possible et je serais heureux de vous présenter ma motivation lors d'un entretien. Je vous remercie par avance pour l'attention portée à ma candidature.",
];

/** Lettre valide pour les tests : longueur correcte, aucun chiffre hors profil, aucune coordonnée. */
export function validLetter(
  overrides: Partial<{ subject: string; body: string; usedFacts: string[] }> = {},
) {
  return {
    subject: 'Candidature en alternance : développeur full stack',
    body: PARAGRAPHS.join('\n\n'),
    usedFacts: [FACT_ACHIEVEMENT, FACT_DEGREE],
    ...overrides,
  };
}
