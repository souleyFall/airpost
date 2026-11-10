import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import type { OfferSource } from '../generated/prisma/enums';
import { exampleProfile } from '../profile/profile.fixture';
import type { Profile } from '../profile/profile.schema';
import type { ProfileService } from '../profile/profile.service';
import type { AdzunaConnector } from '../sources/adzuna/adzuna.connector';
import { dedupKey } from '../sources/dedup';
import type { ApiHealthService } from '../api-health/api-health.service';
import type { IndeedAlertsConnector } from '../sources/alerts/indeed-alerts.connector';
import type { LinkedinAlertsConnector } from '../sources/alerts/linkedin-alerts.connector';
import type { GlassdoorConnector } from '../sources/glassdoor/glassdoor.connector';
import type { GoogleJobsConnector } from '../sources/google-jobs/google-jobs.connector';
import type { LbaConnector } from '../sources/lba/lba.connector';
import type { LbbConnector } from '../sources/lbb/lbb.connector';
import { UNKNOWN_COMPANY } from '../sources/normalize';
import type { MatchService } from '../matching/match.service';
import type { OffersService } from '../sources/offers.service';
import { type NormalizedOffer, type SearchQuery, SourceError } from '../sources/source.types';
import { CollectionService, radiusFromCommute } from './collection.service';
import type { GeocoderService } from '../sources/geocoder.service';

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
    googleJobs?: Search;
    glassdoor?: Search;
    indeed?: Search;
    linkedin?: Search;
    inDatabase?: Map<string, Set<OfferSource>>;
  } = {},
) {
  const empty: Search = async () => ({ offers: [], skipped: 0 });
  const lba = vi.fn(options.lba ?? empty);
  const adzuna = vi.fn(options.adzuna ?? empty);
  const lbb = vi.fn(options.lbb ?? empty);
  const googleJobs = vi.fn(options.googleJobs ?? empty);
  const glassdoor = vi.fn(options.glassdoor ?? empty);
  const indeed = vi.fn(options.indeed ?? empty);
  const linkedin = vi.fn(options.linkedin ?? empty);
  const record = vi.fn(async () => undefined);
  const saveMany = vi.fn(async (offers: NormalizedOffer[]) => ({
    created: offers.length,
    updated: 0,
  }));
  const purgeStale = vi.fn(async () => 2);
  const refreshDistances = vi.fn(async () => 3);
  const cleanup = vi.fn(async () => ({ removed: 0, updated: 0 }));
  const analyzePending = vi.fn(async () => ({ analyzed: 7, remaining: 2 }));
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
    {
      saveMany,
      purgeStale,
      sourcesByDedupKey,
      refreshDistances,
      cleanup,
    } as unknown as OffersService,
    { analyzePending } as unknown as MatchService,
    { search: lba } as unknown as LbaConnector,
    { search: lbb } as unknown as LbbConnector,
    { search: adzuna } as unknown as AdzunaConnector,
    { search: googleJobs } as unknown as GoogleJobsConnector,
    { search: glassdoor } as unknown as GlassdoorConnector,
    { search: indeed } as unknown as IndeedAlertsConnector,
    { search: linkedin } as unknown as LinkedinAlertsConnector,
    { record } as unknown as ApiHealthService,
  );
  return {
    service,
    lba,
    adzuna,
    lbb,
    googleJobs,
    glassdoor,
    indeed,
    saveMany,
    purgeStale,
    analyzePending,
    record,
    refreshDistances,
    cleanup,
  };
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
      contracts: ['ALTERNANCE'],
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
        offers: [offer('LBA', '1'), offer('LBA', '2', { title: 'Alternance développeur Java' })],
        skipped: 1,
      }),
      adzuna: async () => ({ offers: [offer('ADZUNA', 'a', { company: 'Autre SA' })], skipped: 0 }),
    });

    const report = await service.run('u1');

    expect(saveMany).toHaveBeenCalledTimes(7);
    expect(
      report.sources.map((s) => [s.source, s.status, s.fetched, s.created, s.skipped]),
    ).toEqual([
      ['LBA', 'ok', 2, 2, 1],
      ['ADZUNA', 'ok', 1, 1, 0],
      ['LBB', 'ok', 0, 0, 0],
      ['GOOGLE_JOBS', 'ok', 0, 0, 0],
      ['GLASSDOOR', 'ok', 0, 0, 0],
      ['INDEED', 'ok', 0, 0, 0],
      ['LINKEDIN', 'ok', 0, 0, 0],
    ]);
    expect(report.purged).toBe(2);
    expect(service.lastReport()).toBe(report);
  });

  it('une source en panne ne bloque pas les autres, sans détail technique dans le bilan', async () => {
    const { service, saveMany, record } = setup({
      lba: async () => {
        throw new SourceError('LBA', 'rate_limited', 'message avec https://x/?key=SECRET');
      },
      adzuna: async () => {
        throw new SourceError('ADZUNA', 'not_configured', 'clé absente');
      },
      lbb: async () => {
        throw new Error('plantage inattendu avec SECRET');
      },
      googleJobs: async () => {
        throw new SourceError(
          'GOOGLE_JOBS',
          'rate_limited',
          'quota avec https://x/?api_key=SECRET',
        );
      },
      glassdoor: async () => {
        throw new SourceError('GLASSDOOR', 'not_configured', 'clé absente');
      },
      indeed: async () => {
        throw new SourceError('INDEED', 'not_configured', 'Gmail absent');
      },
      linkedin: async () => {
        throw new SourceError('LINKEDIN', 'not_configured', 'Gmail absent');
      },
    });

    const report = await service.run('u1');

    expect(report.sources.map((s) => [s.source, s.status, s.reason])).toEqual([
      ['LBA', 'error', 'rate_limited'],
      ['ADZUNA', 'disabled', 'not_configured'],
      ['LBB', 'error', 'unexpected'],
      ['GOOGLE_JOBS', 'error', 'rate_limited'],
      ['GLASSDOOR', 'disabled', 'not_configured'],
      ['INDEED', 'disabled', 'not_configured'],
      ['LINKEDIN', 'disabled', 'not_configured'],
    ]);
    expect(JSON.stringify(report)).not.toContain('SECRET');
    expect(saveMany).not.toHaveBeenCalled();
    // Voyant de santé : quota atteint, désactivée, ou panne inattendue ; jamais le message d'origine.
    expect(record.mock.calls).toEqual([
      ['LBA', 'QUOTA'],
      ['ADZUNA', 'OFF'],
      ['LBB', 'DOWN'],
      ['GOOGLE_JOBS', 'QUOTA'],
      ['GLASSDOOR', 'OFF'],
      ['INDEED', 'OFF'],
      ['LINKEDIN', 'OFF'],
    ]);
  });

  it('une écriture du voyant qui échoue ne fait pas perdre la collecte', async () => {
    const { service, record } = setup();
    record.mockRejectedValue(new Error('base indisponible'));

    const report = await service.run('u1');

    expect(report.sources).toHaveLength(7);
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

  it('exclut des mots entiers : « SA » ne retire pas « Casino »', async () => {
    const profile = exampleProfile();
    profile.search.excludedCompanies = ['SA'];
    const { service, saveMany } = setup({
      profile,
      lba: async () => ({
        offers: [
          offer('LBA', '1', { company: 'Casino Informatique' }),
          offer('LBA', '2', { company: 'Exemple SA' }),
          offer('LBA', '3', { company: 'Sa Majesté Logiciels' }),
        ],
        skipped: 0,
      }),
    });

    const report = await service.run('u1');

    expect(report.sources[0]).toMatchObject({ excluded: 2, created: 1 });
    expect(saveMany.mock.calls[0]?.[0].map((o) => o.externalId)).toEqual(['1']);
  });

  it('signale en erreur la source dont l’enregistrement échoue, sans perdre le bilan des autres', async () => {
    const { service, saveMany, purgeStale } = setup({
      lba: async () => ({ offers: [offer('LBA', '1')], skipped: 0 }),
      adzuna: async () => ({ offers: [offer('ADZUNA', 'a', { company: 'Autre SA' })], skipped: 0 }),
    });
    saveMany.mockRejectedValueOnce(new Error('base indisponible, mot de passe SECRET'));

    const report = await service.run('u1');

    expect(report.sources.map((s) => [s.source, s.status, s.reason])).toEqual([
      ['LBA', 'error', 'unexpected'],
      ['ADZUNA', 'ok', undefined],
      ['LBB', 'ok', undefined],
      ['GOOGLE_JOBS', 'ok', undefined],
      ['GLASSDOOR', 'ok', undefined],
      ['INDEED', 'ok', undefined],
      ['LINKEDIN', 'ok', undefined],
    ]);
    expect(JSON.stringify(report)).not.toContain('SECRET');
    expect(purgeStale).toHaveBeenCalled();
  });

  it('écarte comme doublon une offre déjà publiée par une autre source dans cette collecte', async () => {
    const { service, saveMany } = setup({
      lba: async () => ({ offers: [offer('LBA', '1')], skipped: 0 }),
      adzuna: async () => ({
        offers: [
          offer('ADZUNA', 'a'),
          offer('ADZUNA', 'b', { title: 'Alternance développeur PHP' }),
        ],
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

  it('recalcule les distances puis fait analyser les offres par l’IA, avec le profil', async () => {
    const { service, analyzePending, refreshDistances } = setup();

    const report = await service.run('u1');

    expect(refreshDistances).toHaveBeenCalledWith({ latitude: 48.86, longitude: 2.38 });
    expect(analyzePending).toHaveBeenCalledWith(exampleProfile());
    expect(report).toMatchObject({ analyzed: 7, pendingAnalysis: 2 });
  });

  it('une panne de l’analyse IA ne fait pas perdre la collecte', async () => {
    const { service, analyzePending } = setup({
      lba: async () => ({ offers: [offer('LBA', '1')], skipped: 0 }),
    });
    analyzePending.mockRejectedValueOnce(new Error('échec'));

    const report = await service.run('u1');

    expect(report.analyzed).toBe(0);
    expect(report.sources[0]).toMatchObject({ status: 'ok', created: 1 });
  });

  it('écarte les offres hors développement, sauf celles déjà filtrées par code ROME à la source', async () => {
    const { service, saveMany } = setup({
      adzuna: async () => ({
        offers: [
          offer('ADZUNA', 'dev', { title: 'Alternance développeur full stack' }),
          offer('ADZUNA', 'compta', { title: 'Alternance comptable', description: 'Excel, SQL' }),
        ],
        skipped: 0,
      }),
      lbb: async () => ({
        offers: [
          offer('LBB', 'spontanee', { title: 'Candidature spontanée : activités des sociétés' }),
        ],
        skipped: 0,
      }),
    });

    const report = await service.run('u1');

    expect(report.sources[1]).toMatchObject({ irrelevant: 1, created: 1 });
    expect(report.sources[2]).toMatchObject({ irrelevant: 0, created: 1 });
    expect(saveMany.mock.calls.flatMap((call) => call[0].map((o) => o.externalId))).toEqual([
      'dev',
      'spontanee',
    ]);
  });

  it('remet à niveau les offres déjà en base avec les règles actuelles, et le compte dans les offres retirées', async () => {
    const { service, cleanup } = setup();
    cleanup.mockResolvedValueOnce({ removed: 5, updated: 1 });

    const report = await service.run('u1');

    // Les offres ajoutées à la main sont un choix de l'utilisateur : jamais supprimées par le tri.
    expect(cleanup).toHaveBeenCalledWith(['LBB', 'LBA', 'MANUAL']);
    expect(report.purged).toBe(7);
  });

  it('ne fait confiance à La Bonne Alternance que si des codes ROME sont configurés', async () => {
    const profile = exampleProfile();
    profile.search.romeCodes = [];
    const { service, cleanup } = setup({ profile });

    await service.run('u1');

    expect(cleanup).toHaveBeenCalledWith(['LBB', 'MANUAL']);
  });

  it('ne refiltre pas La Bonne Alternance quand des codes ROME sont configurés (déjà filtrée à la source)', async () => {
    const { service, saveMany } = setup({
      lba: async () => ({
        offers: [offer('LBA', 'x', { title: 'Alternance - Mission polyvalente' })],
        skipped: 0,
      }),
    });

    const report = await service.run('u1');

    expect(report.sources[0]).toMatchObject({ irrelevant: 0, created: 1 });
    expect(saveMany.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('refiltre La Bonne Alternance sans code ROME : elle renvoie alors toutes les offres', async () => {
    const profile = exampleProfile();
    profile.search.romeCodes = [];
    const { service } = setup({
      profile,
      lba: async () => ({
        offers: [offer('LBA', 'x', { title: 'Alternance comptable' })],
        skipped: 0,
      }),
    });

    const report = await service.run('u1');

    expect(report.sources[0]).toMatchObject({ irrelevant: 1, created: 0 });
  });

  it('Google Jobs : désactivée sans clé, hors-sujet écarté (source non fiable), les contrats du profil sont transmis', async () => {
    const profile = exampleProfile();
    profile.search.contracts = ['ALTERNANCE', 'STAGE'];
    const { service, googleJobs, saveMany } = setup({
      profile,
      googleJobs: async () => ({
        offers: [
          offer('GOOGLE_JOBS', 'dev', { title: 'Alternance développeur full stack' }),
          offer('GOOGLE_JOBS', 'compta', { title: 'Alternance comptable' }),
        ],
        skipped: 0,
      }),
    });

    const report = await service.run('u1');

    expect(googleJobs.mock.calls[0]?.[0].contracts).toEqual(['ALTERNANCE', 'STAGE']);
    expect(report.sources[3]).toMatchObject({ source: 'GOOGLE_JOBS', irrelevant: 1, created: 1 });
    expect(saveMany.mock.calls.flatMap((c) => c[0].map((o) => o.externalId))).toEqual(['dev']);

    const off = setup({
      googleJobs: async () => {
        throw new SourceError('GOOGLE_JOBS', 'not_configured', 'absente');
      },
    });
    expect((await off.service.run('u1')).sources[3]).toMatchObject({ status: 'disabled' });
  });

  it('Glassdoor : hors-sujet et annonces d’écoles écartés (source non fiable), désactivée sans clé', async () => {
    const { service, saveMany } = setup({
      glassdoor: async () => ({
        offers: [
          offer('GLASSDOOR', 'dev', {
            title: 'Alternance développeur web',
            company: 'Nordlys SAS',
          }),
          offer('GLASSDOOR', 'ecole', {
            title: 'Alternance développeur web',
            company: 'CFA INSTA',
          }),
          offer('GLASSDOOR', 'compta', { title: 'Alternance comptable', company: 'Nordlys SAS' }),
        ],
        skipped: 0,
      }),
    });

    const report = await service.run('u1');

    expect(report.sources[4]).toMatchObject({ source: 'GLASSDOOR', irrelevant: 2, created: 1 });
    expect(saveMany.mock.calls.flatMap((c) => c[0].map((o) => o.externalId))).toEqual(['dev']);

    const off = setup({
      glassdoor: async () => {
        throw new SourceError('GLASSDOOR', 'not_configured', 'absente');
      },
    });
    expect((await off.service.run('u1')).sources[4]).toMatchObject({ status: 'disabled' });
  });

  it('journalise POURQUOI une source est en erreur, sans secret : message de la source, nom d’une erreur inattendue', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = setup({
      googleJobs: async () => {
        throw new SourceError(
          'GOOGLE_JOBS',
          'unavailable',
          'Google Jobs : service injoignable (délai dépassé).',
        );
      },
      lbb: async () => {
        throw new TypeError('plantage avec https://x/?key=SECRET');
      },
      adzuna: async () => {
        throw new SourceError('ADZUNA', 'not_configured', 'clé absente');
      },
    });

    await service.run('u1');

    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines).toContain(
      'Source GOOGLE_JOBS en erreur : Google Jobs : service injoignable (délai dépassé).',
    );
    expect(lines).toContain('Source LBB : erreur inattendue (TypeError).');
    // Une source simplement non configurée n'est pas une panne : rien dans les journaux.
    expect(lines.some((l) => l.includes('ADZUNA'))).toBe(false);
    expect(lines.join('\n')).not.toContain('SECRET');
    warn.mockRestore();
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
