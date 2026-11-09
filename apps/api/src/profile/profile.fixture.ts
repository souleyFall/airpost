import type { Profile } from './profile.schema';

/** Profil fictif pour les tests : aucune donnée réelle. */
export function exampleProfile(): Profile {
  return {
    identity: {
      firstName: 'Camille',
      lastName: 'Exemple',
      email: 'camille@exemple.test',
      phone: '+33 6 00 00 00 00',
      city: 'Paris',
      postcode: '75011',
      websiteUrl: 'https://exemple.test/camille',
    },
    headline: 'Développeur full stack en alternance',
    summary: 'Étudiante en master, à la recherche d’une alternance en développement web.',
    education: [{ school: 'École Exemple', degree: 'Master développement et IA', startYear: 2025 }],
    experiences: [
      {
        company: 'Atelier Démo',
        role: 'Stagiaire développeuse',
        startDate: '2025-04',
        endDate: '2025-09',
        achievements: ['Réduit le temps de chargement de 40 % en ajoutant un cache côté serveur.'],
      },
    ],
    skills: {
      languages: ['TypeScript', 'Python'],
      frameworks: ['React', 'NestJS'],
      tools: ['Docker', 'PostgreSQL'],
      other: [],
    },
    search: {
      rhythms: ['2J_3J', '1S_1S'],
      startDate: 'asap',
      maxCommuteMinutes: 60,
      keywords: ['TypeScript', 'React', 'Node.js'],
      romeCodes: ['M1805'],
      excludedCompanies: [],
    },
  };
}
