import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { planCleanup } from '../src/sources/cleanup';

/**
 * Remet à niveau les offres déjà enregistrées avec les règles actuelles (filtre de pertinence, type de contrat),
 * sans attendre la prochaine collecte. Les offres qui ont une candidature ne sont jamais supprimées.
 *
 *   pnpm --filter @airpost/api offers:clean
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL absente : voir .env.example.');
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const offers = await prisma.offer.findMany({
      where: { application: null },
      select: {
        id: true,
        source: true,
        title: true,
        company: true,
        description: true,
        contractType: true,
      },
    });
    // La Bonne Boîte et La Bonne Alternance sont déjà filtrées par code ROME à la source.
    const plan = planCleanup(offers, new Set(['LBB', 'LBA']));
    const { count } = await prisma.offer.deleteMany({
      where: { id: { in: plan.deleteIds }, application: null },
    });
    for (const update of plan.contractUpdates) {
      await prisma.offer.update({
        where: { id: update.id },
        data: { contractType: update.contractType },
      });
    }
    console.log(
      `${count} offre(s) hors métier supprimée(s), ${plan.contractUpdates.length} contrat(s) corrigé(s).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
