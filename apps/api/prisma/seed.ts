import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Données de démonstration, entièrement fictives (entreprises « Exemple »), pour développer l'interface
 * sans appeler les API. Rejouable sans risque : chaque offre est identifiée par (source, externalId).
 */
const DEMO_OFFERS = [
  {
    externalId: 'demo-1',
    title: 'Développeur full stack en alternance',
    company: 'Exemple Logiciels',
    city: 'Paris',
    postcode: '75011',
    channel: 'EMAIL',
    contactEmail: 'recrutement@exemple-logiciels.test',
    score: 86,
  },
  {
    externalId: 'demo-2',
    title: 'Alternant développeur web React / Node',
    company: 'Atelier Démo',
    city: 'Montreuil',
    postcode: '93100',
    channel: 'SITE',
    applyUrl: 'https://exemple.test/offres/demo-2',
    score: 74,
  },
  {
    externalId: 'demo-3',
    title: 'Alternance ingénieur logiciel (TypeScript)',
    company: 'Banc d’essai SAS',
    city: 'Nanterre',
    postcode: '92000',
    channel: 'SITE',
    applyUrl: 'https://exemple.test/offres/demo-3',
    score: 61,
  },
] as const;

function dedupKey(company: string, title: string, city: string): string {
  return [company, title, city]
    .map((part) =>
      part
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-'),
    )
    .join('|');
}

async function main() {
  // Ces données fictives n'ont rien à faire dans une base réelle.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed de démonstration refusé en production.');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL absente : voir .env.example.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    for (const offer of DEMO_OFFERS) {
      const data = {
        ...offer,
        source: 'LBA' as const,
        dedupKey: dedupKey(offer.company, offer.title, offer.city),
        publishedAt: new Date(),
      };
      await prisma.offer.upsert({
        where: { source_externalId: { source: 'LBA', externalId: offer.externalId } },
        update: { lastSeenAt: new Date() },
        create: data,
      });
    }
    console.log(`${DEMO_OFFERS.length} offres de démonstration prêtes.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Le message d'une erreur de connexion peut contenir l'URL : on n'affiche que sa nature.
  console.error('Échec du seed :', error instanceof Error ? error.name : 'erreur inconnue');
  process.exit(1);
});
