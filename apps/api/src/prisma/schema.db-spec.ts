import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env';
import { PrismaService } from './prisma.service';

// Tests d'intégration : vrai PostgreSQL, migrations appliquées sur une base jetable (voir test/).
describe('Schéma de la base (intégration)', () => {
  const prisma = new PrismaService(parseEnv());

  const offerData = {
    source: 'LBA',
    externalId: 'abc-1',
    dedupKey: 'exemple-sa|developpeur|paris',
    title: 'Développeur full stack (alternance)',
    company: 'Exemple SA',
    channel: 'SITE',
  } as const;

  beforeEach(async () => {
    // L'ordre n'a pas d'importance : les suppressions en cascade font le reste.
    await prisma.offer.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('se connecte et répond', async () => {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    expect(rows[0]?.ok).toBe(1);
  });

  it('refuse deux fois la même offre d’une même source', async () => {
    await prisma.offer.create({ data: offerData });

    await expect(prisma.offer.create({ data: offerData })).rejects.toThrow();
  });

  it('accepte le même identifiant chez deux sources différentes', async () => {
    await prisma.offer.create({ data: offerData });

    await expect(
      prisma.offer.create({ data: { ...offerData, source: 'ADZUNA' } }),
    ).resolves.toBeDefined();
  });

  it('crée une candidature « à valider » par défaut', async () => {
    const offer = await prisma.offer.create({ data: offerData });

    const application = await prisma.application.create({ data: { offerId: offer.id } });

    expect(application.status).toBe('TO_REVIEW');
    expect(application.gmailDraftId).toBeNull();
  });

  it('limite à une candidature par offre', async () => {
    const offer = await prisma.offer.create({ data: offerData });
    await prisma.application.create({ data: { offerId: offer.id } });

    await expect(prisma.application.create({ data: { offerId: offer.id } })).rejects.toThrow();
  });

  it('supprime la candidature, les réponses et le contact avec l’offre (RGPD : effacement)', async () => {
    const offer = await prisma.offer.create({
      data: { ...offerData, contactEmail: 'recruteur@exemple.test' },
    });
    const application = await prisma.application.create({ data: { offerId: offer.id } });
    await prisma.reply.create({
      data: {
        applicationId: application.id,
        gmailMessageId: 'msg-1',
        kind: 'ACKNOWLEDGEMENT',
        receivedAt: new Date(),
      },
    });

    await prisma.offer.delete({ where: { id: offer.id } });

    expect(await prisma.application.count()).toBe(0);
    expect(await prisma.reply.count()).toBe(0);
  });

  it('n’enregistre pas deux fois le même message Gmail', async () => {
    const offer = await prisma.offer.create({ data: offerData });
    const application = await prisma.application.create({ data: { offerId: offer.id } });
    const reply = {
      applicationId: application.id,
      gmailMessageId: 'msg-1',
      kind: 'OTHER',
      receivedAt: new Date(),
    } as const;
    await prisma.reply.create({ data: reply });

    await expect(prisma.reply.create({ data: reply })).rejects.toThrow();
  });

  it('garde un seul profil par utilisateur et le supprime avec lui', async () => {
    const user = await prisma.user.create({ data: { login: 'souleymane', passwordHash: 'x' } });
    await prisma.profile.create({ data: { userId: user.id, data: { nom: 'Exemple' } } });

    await expect(prisma.profile.create({ data: { userId: user.id, data: {} } })).rejects.toThrow();

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.profile.count()).toBe(0);
  });

  it('refuse deux utilisateurs avec le même identifiant', async () => {
    await prisma.user.create({ data: { login: 'souleymane', passwordHash: 'x' } });

    await expect(
      prisma.user.create({ data: { login: 'souleymane', passwordHash: 'y' } }),
    ).rejects.toThrow();
  });
});
