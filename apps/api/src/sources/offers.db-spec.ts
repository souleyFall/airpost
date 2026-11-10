import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { OffersService } from './offers.service';
import type { NormalizedOffer } from './source.types';

describe('OffersService (intégration, base réelle)', () => {
  const prisma = new PrismaService(parseEnv());
  const offers = new OffersService(prisma);

  const offer = (id: string, extra: Partial<NormalizedOffer> = {}): NormalizedOffer => ({
    source: 'LBA',
    externalId: id,
    title: 'Alternance développeur',
    company: 'Exemple SA',
    city: 'Paris',
    channel: 'SITE',
    ...extra,
  });

  beforeEach(async () => {
    await prisma.offer.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('crée les nouvelles offres et calcule leur empreinte de dédoublonnage', async () => {
    const result = await offers.saveMany([offer('1'), offer('2', { city: 'Lyon' })]);

    expect(result).toEqual({ created: 2, updated: 0 });
    const rows = await prisma.offer.findMany({ orderBy: { externalId: 'asc' } });
    expect(rows.map((r) => r.dedupKey)).toEqual([
      'exemple-sa|alternance-developpeur|paris',
      'exemple-sa|alternance-developpeur|lyon',
    ]);
  });

  it('met à jour une offre déjà connue au lieu d’en créer une seconde', async () => {
    await offers.saveMany([offer('1')]);

    const result = await offers.saveMany([offer('1', { title: 'Titre corrigé' })]);

    expect(result).toEqual({ created: 0, updated: 1 });
    expect(await prisma.offer.count()).toBe(1);
    expect((await prisma.offer.findFirstOrThrow()).title).toBe('Titre corrigé');
  });

  it('rafraîchit lastSeenAt sans toucher firstSeenAt ni le score', async () => {
    await offers.saveMany([offer('1')]);
    const before = await prisma.offer.findFirstOrThrow();
    await prisma.offer.update({ where: { id: before.id }, data: { score: 80 } });

    await offers.saveMany([offer('1')]);

    const after = await prisma.offer.findFirstOrThrow();
    expect(after.firstSeenAt).toEqual(before.firstSeenAt);
    expect(after.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before.lastSeenAt.getTime());
    expect(after.score).toBe(80);
  });

  it('distingue deux sources qui utilisent le même identifiant', async () => {
    await offers.saveMany([offer('1'), offer('1', { source: 'ADZUNA' })]);

    expect(await prisma.offer.count()).toBe(2);
  });

  it('absorbe les doublons d’un même lot (la dernière version l’emporte)', async () => {
    const result = await offers.saveMany([offer('1'), offer('1', { title: 'Dernière version' })]);

    expect(result).toEqual({ created: 1, updated: 0 });
    expect((await prisma.offer.findFirstOrThrow()).title).toBe('Dernière version');
  });

  it('indique, pour chaque empreinte, quelles sources la possèdent', async () => {
    await offers.saveMany([
      offer('1'),
      offer('1', { source: 'ADZUNA' }),
      offer('2', { city: 'Lyon' }),
    ]);

    const result = await offers.sourcesByDedupKey([
      'exemple-sa|alternance-developpeur|paris',
      'exemple-sa|alternance-developpeur|lyon',
      'inconnue',
    ]);

    expect(result.get('exemple-sa|alternance-developpeur|paris')).toEqual(
      new Set(['LBA', 'ADZUNA']),
    );
    expect(result.get('exemple-sa|alternance-developpeur|lyon')).toEqual(new Set(['LBA']));
    expect(result.has('inconnue')).toBe(false);
    expect((await offers.sourcesByDedupKey([])).size).toBe(0);
  });

  describe('purgeStale (durée de conservation)', () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const seed = (id: string, lastSeenAt: Date, firstSeenAt = lastSeenAt) =>
      prisma.offer.create({
        data: {
          source: 'LBA',
          externalId: id,
          dedupKey: id,
          title: 'T',
          company: 'C',
          channel: 'SITE',
          firstSeenAt,
          lastSeenAt,
        },
      });

    it('supprime les offres plus revues depuis la durée, garde les autres', async () => {
      await seed('ancienne', daysAgo(91));
      await seed('limite', daysAgo(89));
      await seed('recente', daysAgo(1));

      const purged = await offers.purgeStale(90);

      expect(purged).toBe(1);
      expect(
        (await prisma.offer.findMany({ orderBy: { externalId: 'asc' } })).map((o) => o.externalId),
      ).toEqual(['limite', 'recente']);
    });

    it('garde une offre toujours publiée même si elle est connue depuis longtemps', async () => {
      await seed('active', daysAgo(1), daysAgo(300));
      await seed('disparue', daysAgo(120), daysAgo(300));

      expect(await offers.purgeStale(90)).toBe(1);

      expect((await prisma.offer.findMany()).map((o) => o.externalId)).toEqual(['active']);
    });

    it('ne supprime jamais une offre qui a une candidature, même très ancienne', async () => {
      const old = await seed('suivie', daysAgo(400));
      await prisma.application.create({ data: { offerId: old.id } });
      await seed('libre', daysAgo(400));

      expect(await offers.purgeStale(90)).toBe(1);

      expect((await prisma.offer.findMany()).map((o) => o.externalId)).toEqual(['suivie']);
      expect(await prisma.application.count()).toBe(1);
    });

    it('ne supprime rien quand tout est récent', async () => {
      await seed('a', daysAgo(2));

      expect(await offers.purgeStale(90)).toBe(0);
    });
  });

  describe('sources à identifiant instable (Google Jobs)', () => {
    const google = (id: string, extra: Partial<NormalizedOffer> = {}) =>
      offer(id, { source: 'GOOGLE_JOBS', ...extra });

    it('la même annonce revenue sous un autre identifiant met à jour la ligne existante, sans doublon', async () => {
      await offers.saveMany([google('ancien', { description: 'v1' })]);

      const result = await offers.saveMany([google('nouveau', { description: 'v2' })]);

      expect(result).toEqual({ created: 0, updated: 1 });
      const rows = await prisma.offer.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ externalId: 'ancien', description: 'v2' });
    });

    it('conserve l’analyse et la première apparition de la ligne existante', async () => {
      await offers.saveMany([google('ancien')]);
      await prisma.offer.updateMany({
        data: { score: 77, analyzedAt: new Date('2026-11-01T00:00:00Z') },
      });
      const before = await prisma.offer.findFirstOrThrow();

      await offers.saveMany([google('nouveau')]);

      const after = await prisma.offer.findFirstOrThrow();
      expect(after.score).toBe(77);
      expect(after.firstSeenAt).toEqual(before.firstSeenAt);
      expect(after.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before.lastSeenAt.getTime());
    });

    it('dans un même lot, la même annonce sous deux identifiants n’est enregistrée qu’une fois', async () => {
      const result = await offers.saveMany([google('a'), google('b')]);

      expect(result).toEqual({ created: 1, updated: 0 });
      expect(await prisma.offer.count()).toBe(1);
    });

    it('une annonce différente (autre ville ou autre intitulé) reste une offre à part', async () => {
      await offers.saveMany([google('a')]);

      await offers.saveMany([google('b', { city: 'Lyon' }), google('c', { title: 'Autre poste' })]);

      expect(await prisma.offer.count()).toBe(3);
    });

    it('les sources à identifiant stable gardent un identifiant = une offre (deux annonces de même titre)', async () => {
      const result = await offers.saveMany([offer('1'), offer('2')]);

      expect(result).toEqual({ created: 2, updated: 0 });
      expect(await prisma.offer.count()).toBe(2);
    });

    describe('cleanup : doublons déjà en base', () => {
      const seedDuplicate = (
        externalId: string,
        extra: Record<string, unknown> = {},
        source: 'GOOGLE_JOBS' | 'LBA' = 'GOOGLE_JOBS',
      ) =>
        prisma.offer.create({
          data: {
            source,
            externalId,
            dedupKey: 'exemple-sa|alternance-developpeur|paris',
            title: 'Alternance développeur web',
            company: 'Exemple SA',
            channel: 'SITE',
            ...extra,
          },
        });

      it('garde la plus ancienne et supprime les autres', async () => {
        await seedDuplicate('vieux', { firstSeenAt: new Date('2026-11-01T00:00:00Z') });
        await seedDuplicate('recent', { firstSeenAt: new Date('2026-11-09T00:00:00Z') });

        const result = await offers.cleanup(['LBA', 'LBB']);

        expect(result.removed).toBe(1);
        expect((await prisma.offer.findMany()).map((r) => r.externalId)).toEqual(['vieux']);
      });

      it('préfère la ligne qui a une analyse, même plus récente', async () => {
        await seedDuplicate('vieux', { firstSeenAt: new Date('2026-11-01T00:00:00Z') });
        await seedDuplicate('analysee', {
          firstSeenAt: new Date('2026-11-09T00:00:00Z'),
          score: 80,
          analyzedAt: new Date('2026-11-09T01:00:00Z'),
        });

        await offers.cleanup(['LBA', 'LBB']);

        expect((await prisma.offer.findMany()).map((r) => r.externalId)).toEqual(['analysee']);
      });

      it('ne supprime jamais une ligne qui a une candidature', async () => {
        const suivie = await seedDuplicate('suivie', {
          firstSeenAt: new Date('2026-11-09T00:00:00Z'),
        });
        await seedDuplicate('autre', { firstSeenAt: new Date('2026-11-01T00:00:00Z') });
        await prisma.application.create({ data: { offerId: suivie.id, subject: 'O', body: 'T' } });

        await offers.cleanup(['LBA', 'LBB']);

        expect((await prisma.offer.findMany()).map((r) => r.externalId)).toEqual(['suivie']);
      });

      it('ne touche pas aux sources à identifiant stable (deux annonces LBA de même titre)', async () => {
        await seedDuplicate('1', {}, 'LBA');
        await seedDuplicate('2', {}, 'LBA');

        const result = await offers.cleanup(['LBA', 'LBB']);

        expect(result.removed).toBe(0);
        expect(await prisma.offer.count()).toBe(2);
      });
    });
  });

  it('accepte un lot vide', async () => {
    expect(await offers.saveMany([])).toEqual({ created: 0, updated: 0 });
  });

  it('conserve la candidature d’une offre mise à jour', async () => {
    await offers.saveMany([offer('1')]);
    const row = await prisma.offer.findFirstOrThrow();
    await prisma.application.create({ data: { offerId: row.id, status: 'VALIDATED' } });

    await offers.saveMany([offer('1', { title: 'Nouveau titre' })]);

    expect((await prisma.application.findFirstOrThrow()).status).toBe('VALIDATED');
  });
});
