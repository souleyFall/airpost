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
