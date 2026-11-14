/**
 * Données FICTIVES de la démo : une candidate inventée, des entreprises inventées, des annonces inventées.
 * Aucune donnée réelle (ni de l'auteur, ni de recruteurs, ni d'entreprises existantes). Les dates sont calculées
 * à partir de l'instant du chargement, pour que la démo ait toujours l'air « d'aujourd'hui ».
 */
import type { Profile } from '../pages/profile/profileForm';
import type {
  Analysis,
  ApplicationStatus,
  ContractType,
  OfferSource,
  ReplyKind,
} from '../api/types';

const DAY = 86_400_000;
export const daysAgo = (days: number): string => new Date(Date.now() - days * DAY).toISOString();

export const DEMO_PROFILE: Profile = {
  identity: {
    firstName: 'Léa',
    lastName: 'Marchand',
    email: 'lea.marchand@exemple.test',
    phone: '+33 6 00 00 00 00',
    city: 'Versailles',
    postcode: '78000',
    websiteUrl: 'https://exemple.test/lea',
  },
  headline: 'Développeuse Full Stack & IA',
  summary:
    'Étudiante en master, je cherche une alternance de 12 mois en développement web et IA, au rythme de 3 semaines en entreprise et 1 semaine à l’école.',
  education: [
    {
      school: 'École du Numérique (fictive)',
      degree: 'Master Développement, Big Data & IA',
      startYear: 2025,
    },
    {
      school: 'Université Exemple (fictive)',
      degree: 'Licence Mathématiques & Informatique',
      startYear: 2021,
      endYear: 2024,
    },
  ],
  experiences: [
    {
      company: 'Studio Lumière',
      role: 'Développeuse Full Stack (stage)',
      startDate: '2025-09',
      endDate: '2026-02',
      achievements: [
        'Réduit de 40 % le temps de chargement du tableau de bord en ajoutant un cache côté serveur.',
        'Automatisé l’import de factures avec une API REST et des tests, ce qui a supprimé une saisie manuelle hebdomadaire.',
      ],
    },
  ],
  skills: {
    languages: ['TypeScript', 'Python', 'PHP'],
    frameworks: ['React', 'NestJS', 'Symfony'],
    tools: ['Docker', 'PostgreSQL', 'Git'],
    other: ['Tests automatisés', 'Méthode agile'],
  },
  search: {
    contracts: ['ALTERNANCE', 'STAGE'],
    rhythms: ['AUTRE'],
    startDate: 'asap',
    maxCommuteMinutes: 60,
    keywords: ['TypeScript', 'React', 'Node.js', 'IA'],
    romeCodes: ['M1805'],
    excludedCompanies: [],
  },
};

export interface DemoOffer {
  id: string;
  source: OfferSource;
  via: string | null;
  title: string;
  company: string;
  city: string | null;
  postcode: string | null;
  channel: 'EMAIL' | 'SITE';
  contractType: ContractType;
  distanceKm: number | null;
  applyUrl: string | null;
  contactEmail: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
  description: string;
  score: number | null;
  analysis: Analysis | null;
  analyzedAt: string | null;
  excluded: boolean;
  /** Rejetée par l'utilisateur (restaurable 7 jours) ; absent = pas rejetée. */
  rejectedAt?: string | null;
  /** Analyse révélée quand l'utilisateur lance (ou déclenche) l'analyse : l'IA est simulée. */
  analysisAfter?: { score: number; analysis: Analysis };
}

const analysis = (
  verdict: Analysis['verdict'],
  summary: string,
  strengths: string[],
  gaps: string[],
  brief: Analysis['brief'],
): Analysis => ({ verdict, summary, disqualifier: null, strengths, gaps, brief });

const base = (
  id: string,
  source: OfferSource,
  title: string,
  company: string,
  city: string,
  postcode: string,
  distanceKm: number | null,
  contractType: ContractType,
  publishedDays: number | null,
  description: string,
  extra: Partial<DemoOffer> = {},
): DemoOffer => ({
  id,
  source,
  via: null,
  title,
  company,
  city,
  postcode,
  channel: 'SITE',
  contractType,
  distanceKm,
  applyUrl: `https://exemple.test/offres/${id}`,
  contactEmail: null,
  publishedAt: publishedDays === null ? null : daysAgo(publishedDays),
  firstSeenAt: daysAgo(publishedDays === null ? 1 : Math.max(0, publishedDays - 1)),
  description,
  score: null,
  analysis: null,
  analyzedAt: null,
  excluded: false,
  ...extra,
});

/** Offres du fil « À valider » (et quelques-unes sans note, que l'IA « analyse » à l'affichage). */
export function pendingOffers(): DemoOffer[] {
  return [
    base(
      'o1',
      'LBA',
      'Alternance Développeur Full Stack TypeScript',
      'Atelier Nova',
      'Boulogne-Billancourt',
      '92100',
      12,
      'ALTERNANCE',
      1,
      'Atelier Nova conçoit des outils de planification pour des équipes terrain. Tu rejoins l’équipe produit pour construire de nouvelles fonctionnalités en TypeScript, React et NestJS, avec des revues de code et des tests. Rythme 3 semaines en entreprise, 1 semaine à l’école. Contrat de 12 mois à partir de septembre.',
      {
        channel: 'EMAIL',
        contactEmail: 'recrutement@atelier-nova.exemple.test',
        score: 91,
        analyzedAt: daysAgo(0),
        analysis: analysis(
          'excellent',
          'Pile technique et rythme correspondent presque point par point à ton profil.',
          [
            'TypeScript, React et NestJS demandés : ce sont tes trois outils principaux',
            'Rythme 3 semaines / 1 semaine identique à ta recherche',
            'Trajet de 12 km, bien en dessous de ton maximum',
          ],
          ['Aucun point bloquant : vérifier la taille de l’équipe produit'],
          {
            company: 'Éditeur d’outils de planification pour équipes terrain.',
            stack: ['TypeScript', 'React', 'NestJS'],
            wantedProfile: 'Étudiante en master en informatique.',
            rhythm: '3 semaines / 1 semaine',
          },
        ),
      },
    ),
    base(
      'o2',
      'LINKEDIN',
      'Stage Développeur Backend NestJS',
      'Brume Logiciels',
      'Paris',
      '75011',
      22,
      'STAGE',
      2,
      'Intitulé, entreprise et ville seulement (offre reçue par e-mail d’alerte).',
      {
        score: 86,
        analyzedAt: daysAgo(0),
        analysis: analysis(
          'excellent',
          'Un stage backend en NestJS, ta technologie principale, à Paris.',
          ['NestJS cité dès l’intitulé', 'Paris accessible en transports'],
          ['Texte de l’annonce absent : stack complète et durée à vérifier sur la page'],
          { company: null, stack: ['NestJS'], wantedProfile: null, rhythm: null },
        ),
      },
    ),
    base(
      'o3',
      'INDEED',
      'Alternance Ingénieur IA et Data',
      'Cobalt Analytics',
      'Massy',
      '91300',
      28,
      'ALTERNANCE',
      3,
      'Cobalt Analytics développe des modèles de prévision pour la grande distribution. Tu participes à la mise en production de modèles en Python, à leur suivi et à l’automatisation des traitements de données.',
      {
        score: 82,
        analyzedAt: daysAgo(0),
        analysis: analysis(
          'excellent',
          'Un poste IA et data en Python, aligné avec ton master.',
          ['Python et IA au cœur du poste', 'Alternance de 12 mois compatible avec ton calendrier'],
          ['Massy à 28 km : environ 50 minutes en transports'],
          {
            company: 'Éditeur de modèles de prévision.',
            stack: ['Python'],
            wantedProfile: 'Étudiante en master IA ou data.',
            rhythm: null,
          },
        ),
      },
    ),
    base(
      'o4',
      'GLASSDOOR',
      'Alternance Développeur React',
      'Marée Digitale',
      'Versailles',
      '78000',
      3,
      'ALTERNANCE',
      4,
      'Extrait : agence web à Versailles, projets React pour des clients culturels, équipe de huit développeurs.',
      {
        score: 78,
        analyzedAt: daysAgo(0),
        analysis: analysis(
          'good',
          'React demandé et l’agence est à Versailles, mais l’extrait ne dit rien du rythme.',
          ['React demandé', 'À 3 km de chez toi'],
          ['Rythme d’alternance non précisé', 'Peu de détails sur la stack backend'],
          {
            company: 'Agence web pour clients culturels.',
            stack: ['React'],
            wantedProfile: null,
            rhythm: null,
          },
        ),
      },
    ),
    base(
      'o5',
      'GOOGLE_JOBS',
      'Alternance Développeur Web PHP Symfony',
      'Pivoine SI',
      'Saint-Quentin-en-Yvelines',
      '78180',
      9,
      'ALTERNANCE',
      5,
      'Pivoine SI accompagne des PME dans la refonte de leurs outils métier. Missions : développement Symfony, intégration d’API tierces, maintenance applicative.',
      {
        via: 'LinkedIn',
        score: 74,
        analyzedAt: daysAgo(0),
        analysis: analysis(
          'good',
          'Symfony fait partie de tes compétences, mais le poste est moins orienté IA.',
          ['Symfony et PHP dans ton profil', 'À 9 km'],
          ['Peu de place pour l’IA, qui est ton axe de master'],
          {
            company: 'Société de services pour PME.',
            stack: ['Symfony', 'PHP'],
            wantedProfile: null,
            rhythm: null,
          },
        ),
      },
    ),
    base(
      'o6',
      'LINKEDIN',
      'Stage Développeur Mobile React Native',
      'Colibri Apps',
      'Paris',
      '75009',
      21,
      'STAGE',
      6,
      'Intitulé, entreprise et ville seulement (offre reçue par e-mail d’alerte).',
      {
        score: 69,
        analyzedAt: daysAgo(0),
        analysis: analysis(
          'good',
          'React Native est proche de ton React, à confirmer dans l’annonce.',
          ['Proximité avec React'],
          ['Aucune expérience mobile dans ton profil'],
          { company: null, stack: ['React Native'], wantedProfile: null, rhythm: null },
        ),
      },
    ),
    base(
      'o7',
      'LBA',
      'Alternance DevOps et Cloud',
      'Rivage Cloud',
      'Nanterre',
      '92000',
      17,
      'ALTERNANCE',
      7,
      'Rivage Cloud héberge des applications pour des éditeurs. Tu travailleras sur l’automatisation des déploiements, la supervision et la sécurité des environnements.',
      {
        score: 63,
        analyzedAt: daysAgo(0),
        analysis: analysis(
          'fair',
          'Un poste d’infrastructure : Docker est dans ton profil, le reste est à découvrir.',
          ['Docker dans ton profil'],
          ['Cloud et supervision absents de tes expériences', 'Moins orienté développement'],
          {
            company: 'Hébergeur pour éditeurs de logiciels.',
            stack: ['Docker', 'CI/CD'],
            wantedProfile: null,
            rhythm: null,
          },
        ),
      },
    ),
    base(
      'o8',
      'INDEED',
      'Stage Data Engineer',
      'Aster Données',
      'Lille',
      '59000',
      210,
      'STAGE',
      8,
      'Aster Données conçoit des chaînes de traitement pour des industriels du nord de la France.',
      {
        score: 48,
        analyzedAt: daysAgo(0),
        analysis: analysis(
          'weak',
          'Intéressant sur le fond, mais Lille est à 210 km de chez toi.',
          ['Python et données au programme'],
          ['Trajet incompatible avec ton maximum de 60 minutes', 'Pas de télétravail annoncé'],
          {
            company: 'Traitement de données industrielles.',
            stack: ['Python'],
            wantedProfile: null,
            rhythm: null,
          },
        ),
      },
    ),
    base(
      'o9',
      'GLASSDOOR',
      'Alternance Développeur Full Stack Vue.js',
      'Foyer Numérique',
      'Cergy',
      '95000',
      26,
      'ALTERNANCE',
      1,
      'Extrait : éditeur d’une application de gestion pour associations. Vue.js côté interface, Node.js côté serveur.',
      {
        analysisAfter: {
          score: 71,
          analysis: analysis(
            'good',
            'Node.js et TypeScript correspondent, Vue.js est une technologie voisine de React.',
            ['Node.js dans ton profil', 'Alternance de 12 mois'],
            ['Vue.js absent de tes compétences, à apprendre'],
            {
              company: 'Éditeur d’une application pour associations.',
              stack: ['Vue.js', 'Node.js'],
              wantedProfile: null,
              rhythm: null,
            },
          ),
        },
      },
    ),
    base(
      'o10',
      'LINKEDIN',
      'Stage Développeur .NET',
      'Orme Conseil',
      'Paris',
      '75008',
      24,
      'STAGE',
      1,
      'Intitulé, entreprise et ville seulement (offre reçue par e-mail d’alerte).',
      {
        analysisAfter: {
          score: 52,
          analysis: analysis(
            'fair',
            '.NET n’est pas dans ton profil ; le cadre est correct mais la pile est éloignée.',
            ['Paris accessible'],
            ['.NET absent de ton profil'],
            { company: null, stack: ['.NET'], wantedProfile: null, rhythm: null },
          ),
        },
      },
    ),
    base(
      'o11',
      'LBB',
      'Candidature spontanée : Lumen Studio',
      'Lumen Studio',
      'Versailles',
      '78000',
      4,
      'SPONTANEE',
      null,
      'Entreprise qui recrute souvent en alternance en développement. Pas d’annonce : une candidature spontanée est possible.',
      {},
    ),
    base(
      'o12',
      'ADZUNA',
      'Développeur Full Stack',
      'Sablier Solutions',
      'Paris',
      '75015',
      19,
      'AUTRE',
      2,
      'Poste de développeur full stack, contrat non précisé dans l’annonce.',
      {},
    ),
  ];
}

/** Offres qui « arrivent » quand le visiteur lance la collecte. */
export function arrivingOffers(): DemoOffer[] {
  return [
    base(
      'n1',
      'INDEED',
      'Alternance Développeuse Full Stack React et Node',
      'Écume Labs',
      'Paris',
      '75010',
      21,
      'ALTERNANCE',
      0,
      'Écume Labs développe une plateforme de réservation. Stack : React, Node.js, PostgreSQL. Alternance de 12 mois.',
      {
        score: 88,
        analyzedAt: daysAgo(0),
        analysis: analysis(
          'excellent',
          'Réservations en React et Node.js : tes deux technologies principales.',
          ['React, Node.js et PostgreSQL dans ton profil', 'Alternance de 12 mois'],
          ['Paris à 21 km : environ 40 minutes'],
          {
            company: 'Plateforme de réservation.',
            stack: ['React', 'Node.js', 'PostgreSQL'],
            wantedProfile: null,
            rhythm: null,
          },
        ),
      },
    ),
    base(
      'n2',
      'LINKEDIN',
      'Alternance Développeur IA Générative',
      'Hélice AI',
      'Paris',
      '75002',
      20,
      'ALTERNANCE',
      0,
      'Intitulé, entreprise et ville seulement (offre reçue par e-mail d’alerte).',
      {
        score: 84,
        analyzedAt: daysAgo(0),
        analysis: analysis(
          'excellent',
          'Un poste d’IA générative, au cœur de ton master.',
          ['IA dans l’intitulé et dans ton parcours'],
          ['Texte absent : stack à vérifier'],
          { company: null, stack: [], wantedProfile: null, rhythm: null },
        ),
      },
    ),
    base(
      'n3',
      'GLASSDOOR',
      'Stage Développeur Python',
      'Brise Informatique',
      'Massy',
      '91300',
      28,
      'STAGE',
      0,
      'Extrait : stage de 6 mois, scripts d’automatisation et API en Python.',
      {
        score: 66,
        analyzedAt: daysAgo(0),
        analysis: analysis(
          'good',
          'Python demandé, mais il s’agit d’un stage et non d’une alternance.',
          ['Python dans ton profil'],
          ['Stage de 6 mois, ton objectif est 12 mois'],
          { company: null, stack: ['Python'], wantedProfile: null, rhythm: null },
        ),
      },
    ),
  ];
}

export interface DemoReply {
  id: string;
  kind: ReplyKind;
  receivedAt: string;
  snippet: string;
}

export interface DemoApplication {
  id: string;
  status: ApplicationStatus;
  subject: string | null;
  body: string | null;
  validatedAt: string | null;
  appliedAt: string | null;
  followedUpAt: string | null;
  createdAt: string;
  updatedAt: string;
  replies: DemoReply[];
  offer: DemoOffer;
}

const sent = (
  id: string,
  title: string,
  company: string,
  source: OfferSource,
  status: ApplicationStatus,
  appliedDays: number | null,
  extra: Partial<DemoApplication> = {},
  offerExtra: Partial<DemoOffer> = {},
): DemoApplication => {
  const offer = base(
    `a-${id}`,
    source,
    title,
    company,
    'Paris',
    '75001',
    20,
    'ALTERNANCE',
    15,
    'Annonce déjà traitée.',
    {
      channel: 'EMAIL',
      contactEmail: `rh@${company.toLowerCase().replace(/[^a-z]+/g, '-')}.exemple.test`,
      score: 80,
      analyzedAt: daysAgo(14),
      analysis: analysis('good', 'Offre déjà traitée.', [], [], {
        company: null,
        stack: [],
        wantedProfile: null,
        rhythm: null,
      }),
      ...offerExtra,
    },
  );
  return {
    id,
    status,
    subject: `Candidature en alternance : ${title}`,
    body: letterBody(title, company),
    validatedAt: appliedDays === null ? daysAgo(1) : daysAgo(appliedDays + 1),
    appliedAt: appliedDays === null ? null : daysAgo(appliedDays),
    followedUpAt: null,
    createdAt: daysAgo((appliedDays ?? 1) + 3),
    updatedAt: daysAgo(appliedDays === null ? 1 : Math.max(0, appliedDays - 1)),
    replies: [],
    offer,
    ...extra,
  };
};

export function applications(): DemoApplication[] {
  return [
    sent('p1', 'Alternance Développeur Full Stack', 'Ocelot Tech', 'LBA', 'APPLIED', 10),
    sent('p2', 'Alternance Développeur Web', 'Zéphyr Studio', 'LINKEDIN', 'APPLIED', 3),
    sent('p3', 'Alternance Développeur React', 'Pampa Numérique', 'INDEED', 'ACKNOWLEDGED', 12, {
      replies: [
        {
          id: 'r3',
          kind: 'ACKNOWLEDGEMENT',
          receivedAt: daysAgo(11),
          snippet: 'Nous avons bien reçu votre candidature et reviendrons vers vous.',
        },
      ],
    }),
    sent('p4', 'Alternance Ingénieur Logiciel', 'Tamaris Systèmes', 'GLASSDOOR', 'INTERVIEW', 9, {
      replies: [
        {
          id: 'r4a',
          kind: 'ACKNOWLEDGEMENT',
          receivedAt: daysAgo(8),
          snippet: 'Merci pour votre candidature.',
        },
        {
          id: 'r4b',
          kind: 'INTERVIEW',
          receivedAt: daysAgo(2),
          snippet: 'Nous souhaiterions échanger avec vous : seriez-vous disponible jeudi ?',
        },
      ],
    }),
    sent('p5', 'Alternance Développeur Backend', 'Gentiane Data', 'LINKEDIN', 'REJECTED', 14, {
      replies: [
        {
          id: 'r5',
          kind: 'REJECTION',
          receivedAt: daysAgo(6),
          snippet: 'Nous ne donnerons pas suite à votre candidature pour ce poste.',
        },
      ],
    }),
    sent('p6', 'Alternance Développeur Full Stack', 'Mistral Conseil', 'LBA', 'NO_RESPONSE', 20),
    sent('p7', 'Alternance Développeur Mobile', 'Soleil Couchant Apps', 'MANUAL', 'APPLIED', 12, {
      followedUpAt: daysAgo(5),
    }),
    sent('p8', 'Alternance Développeur Full Stack', 'Cerisier Logiciels', 'LBA', 'VALIDATED', null),
    sent('p9', 'Alternance Développeur Web', 'Glycine Média', 'INDEED', 'DRAFT_CREATED', null),
  ];
}

export function letterBody(title: string, company: string): string {
  return [
    'Madame, Monsieur,',
    `Votre offre « ${title} » au sein de ${company} a retenu toute mon attention : elle associe un produit concret à une équipe technique soucieuse de qualité, exactement le cadre dans lequel je souhaite me former pendant mon alternance.`,
    'Lors de mon stage chez Studio Lumière, j’ai réduit de 40 % le temps de chargement du tableau de bord en ajoutant un cache côté serveur, puis automatisé l’import de factures avec une API REST et des tests. Cette expérience m’a appris à mesurer avant d’optimiser et à expliquer mes choix à des collègues non techniques. Je travaille avec TypeScript, React, NestJS et Docker.',
    'Je prépare un master Développement, Big Data & IA et je recherche une alternance de 12 mois, au rythme de 3 semaines en entreprise et 1 semaine à l’école, dès que possible. Je serais heureuse de vous présenter ma motivation lors d’un échange.',
  ].join('\n\n');
}

export function followUpBody(title: string, company: string): string {
  return [
    'Madame, Monsieur,',
    `Il y a quelques jours, je vous ai adressé ma candidature pour le poste « ${title} » chez ${company}, et je souhaitais savoir où en était l’étude de mon dossier.`,
    'Depuis, j’ai poursuivi un projet personnel d’outil de suivi de candidatures en TypeScript, avec des tests automatisés et un déploiement Docker : je serais heureuse de vous en présenter le code lors d’un court échange, si cela vous convient.',
  ].join('\n\n');
}
