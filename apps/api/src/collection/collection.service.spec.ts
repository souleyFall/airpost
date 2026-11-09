import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import type { OfferSource } from '../generated/prisma/enums';
import { exampleProfile } from '../profile/profile.fixture';
import type { Profile } from '../profile/profile.schema';
import type { ProfileService } from '../profile/profile.service';
import type { AdzunaConnector } from '../sources/adzuna/adzuna.connector';
import { dedupKey } from '../sources/dedup';
import type { LbaConnector } from '../sources/lba/lba.connector';
import type { LbbConnector } from '../sources/lbb/lbb.connector';
import { UNKNOWN_COMPANY } from '../sources/normalize';
import type { OffersService } from '../sources/offers.service';
import { type NormalizedOffer, type SearchQuery, SourceError } from '../sources/source.types';
import { CollectionService, radiusFromCommute } from './collection.service';
import type { GeocoderService } from './geocoder.service';

function offer(
  source: OfferSource,
  id: string,
  extra: Partial<NormalizedOffer> = {},
): NormalizedOffer {
  return {
    source,
    externalId: id,
    title: 'Alternance développeur',
    company: 'Exemple SA',
    city: 'Paris',
    channel: 'SITE',
    ...extra,
  };
}

type Search = (query: SearchQuery) => Promise<{ offers: NormalizedOffer[]; skipped: number }>;

function setup(
  options: {
    profile?: Profile | null;
    position?: { latitude: number; longitude: number } | null;
    lba?: Search;
    adzuna?: Search;
    lbb?: Search;
    inDatabase?: Map<string, Set<OfferSource>>;
  } = {},
) {
  const empty: Search = async () => ({ offers: [], skipped: 0 });
  const lba = vi.fn(options.lba ?? empty);
  const adzuna = vi.fn(options.adzuna ?? empty);
  const lbb = vi.fn(options.lbb ?? empty);
  const saveMany = vi.fn(async (offers: NormalizedOffer[]) => ({
    created: offers.length,
    updated: 0,
  }));
  const purgeStale = vi.fn(async () => 2);
  const sourcesByDedupKey = vi.fn(async () => options.inDatabase ?? new Map());
  const service = new CollectionService(
    { OFFER_RETENTION_DAYS: 90 } as Env,
    {
      get: async () => (options.profile === undefined ? exampleProfile() : options.profile),
    } as unknown as ProfileService,
    {
      geocodePostcode: async () =>
        options.position === undefined ? { latitude: 48.86, longitude: 2.38 } : options.position,
    } as unknown as GeocoderService,
    { saveMany, purgeStale, sourcesByDedupKey } as unknown as OffersService,
    { search: lba } as unknown as LbaConnector,
    { search: lbb } as unknown as LbbConnector,
    { search: adzuna } as unknown as AdzunaConnector,
  );
  return { service, lba, adzuna, lbb, saveMany, purgeStale };
}

describe('radiusFromCommute', () => {
  it.each([
    [60, 30],
    [20, 10],
    [5, 5],
    [1, 5],
    [180, 90],
    [1000, 100],
  ])('%i minutes → %i km', (minutes, km) => {
    expect(radiusFromCommute(minutes)).toBe(km);
  });
});

describe('CollectionService', () => {
  it('construit la requête à partir du profil : position, rayon, ROME, ville, mots-clés', async () => {
    const { service, lba, adzuna, lbb } = setup();

    await service.run('u1');

    const expected = {
      latitude: 48.86,
      longitude: 2.38,
      radiusKm: 30,
      romeCodes: ['M1805'],
      where: 'Paris',
      keywords: ['TypeScript', 'React', 'Node.js'],
    };
    expect(lba).toHaveBeenCalledWith(expected);
    expect(adzuna).toHaveBeenCalledWith(expected);
    expect(lbb).toHaveBeenCalledWith(expected);
  });

  it('refuse sans profil ou avec un code postal introuvable, sans appeler aucune source', async () => {
    const noProfile = setup({ profile: null });
    await expect(noProfile.service.run('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(noProfile.lba).not.toHaveBeenCalled();

    const noPosition = setup({ position: null });
    await expect(noPosition.service.run('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(noPosition.lba).not.toHaveBeenCalled();
  });

  it('enregistre les offres de chaque source et tient un bilan', async () => {
    const { service, saveMany } = setup({
      lba: async () => ({
        offers: [offer('LBA', '1'), offer('LBA', '2', { title: 'Autre' })],
        skipped: 1,
      }),
      adzuna: async () => ({ offers: [offer('ADZUNA', 'a', { company: 'Autre SA' })], skipped: 0 }),
    });

    const report = await service.run('u1');

    expect(saveMany).toHaveBeenCalledTimes(3);
    expect(
      report.sources.map((s) => [s.source, s.status, s.fetched, s.created, s.skipped]),
    ).toEqual([
      ['LBA', 'ok', 2, 2, 1],
      ['ADZUNA', 'ok', 1, 1, 0],
      ['LBB', 'ok', 0, 0, 0],
    ]);
    expect(report.purged).toBe(2);
    expect(service.lastReport()).toBe(report);
  });

  it('une source en panne ne bloque pas les autres, sans détail technique dans le bilan', async () => {
    const { service, saveMany } = setup({
      lba: async () => {
        throw new SourceError('LBA', 'rate_limited', 'message avec https://x/?key=SECRET');
      },
      adzuna: async () => {
        throw new SourceError('ADZUNA', 'not_configured', 'clé absente');
      },
      lbb: async () => {
        throw new Error('plantage inattendu avec SECRET');
      },
    });

    const report = await service.run('u1');

    expect(report.sources.map((s) => [s.source, s.status, s.reason])).toEqual([
      ['LBA', 'error', 'rate_limited'],
      ['ADZUNA', 'disabled', 'not_configured'],
      ['LBB', 'error', 'unexpected'],
    ]);
    expect(JSON.stringify(report)).not.toContain('SECRET');
    expect(saveMany).not.toHaveBeenCalled();
  });

  it('écarte les entreprises exclues (insensible à la casse et aux accents)', async () => {
    const profile = exampleProfile();
    profile.search.excludedCompanies = ['société générale'];
    const { service, saveMany } = setup({
      profile,
      lba: async () => ({
        offers: [offer('LBA', '1', { company: 'SOCIETE GENERALE SA' }), offer('LBA', '2')],
        skipped: 0,
      }),
    });

    const report = await service.run('u1');

    expect(report.sources[0]).toMatchObject({ fetched: 2, excluded: 1, created: 1 });
    expect(saveMany.mock.calls[0]?.[0].map((o) => o.externalId)).toEqual(['2']);
  });

  it('écarte comme doublon une offre déjà publiée par une autre source dans cette collecte', async () => {
    const { service, saveMany } = setup({
      lba: async () => ({ offers: [offer('LBA', '1')], skipped: 0 }),
      adzuna: async () => ({
        offers: [offer('ADZUNA', 'a'), offer('ADZUNA', 'b', { title: 'Autre poste' })],
        skipped: 0,
      }),
    });

    const report = await service.run('u1');

    expect(report.sources[1]).toMatchObject({ fetched: 2, duplicates: 1, created: 1 });
    expect(saveMany.mock.calls[1]?.[0].map((o) => o.externalId)).toEqual(['b']);
  });

  it('écarte comme doublon une offre déjà en base chez une autre source, pas chez la même', async () => {
    const key = dedupKey('Exemple SA', 'Alternance développeur', 'Paris');
    const { service, saveMany } = setup({
      inDatabase: new Map([[key, new Set<OfferSource>(['ADZUNA'])]]),
      lba: async () => ({ offers: [offer('LBA', '1')], skipped: 0 }),
      adzuna: async () => ({ offers: [offer('ADZUNA', 'a')], skipped: 0 }),
    });

    const report = await service.run('u1');

    // LBA est un doublon de l'offre Adzuna déjà enregistrée ; Adzuna retrouve la sienne (mise à jour).
    expect(report.sources[0]).toMatchObject({ duplicates: 1, created: 0 });
    expect(report.sources[1]).toMatchObject({ duplicates: 0 });
    expect(saveMany.mock.calls[1]?.[0].map((o) => o.externalId)).toEqual(['a']);
  });

  it('ne juge jamais doublon une offre d’entreprise inconnue (comparaison impossible)', async () => {
    const { service } = setup({
      lba: async () => ({ offers: [offer('LBA', '1', { company: UNKNOWN_COMPANY })], skipped: 0 }),
      adzuna: async () => ({
        offers: [offer('ADZUNA', 'a', { company: UNKNOWN_COMPANY })],
        skipped: 0,
      }),
    });

    const report = await service.run('u1');

    expect(report.sources[1]).toMatchObject({ duplicates: 0, created: 1 });
  });

  it('purge avec la durée de conservation configurée', async () => {
    const { service, purgeStale } = setup();

    await service.run('u1');

    expect(purgeStale).toHaveBeenCalledWith(90);
  });

  it('refuse une seconde collecte pendant qu’une autre tourne, puis la réautorise', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = setup({
      lba: async () => {
        await gate;
        return { offers: [], skipped: 0 };
      },
    });

    const first = service.run('u1');
    await expect(service.run('u1')).rejects.toBeInstanceOf(ConflictException);
    release();
    await first;

    await expect(service.run('u1')).resolves.toBeDefined();
  });

  it('libère le verrou même si la collecte échoue (profil absent)', async () => {
    const { service } = setup({ profile: null });

    await expect(service.run('u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.run('u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
