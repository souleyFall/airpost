import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import { CollectionScheduler } from './collection.scheduler';
import type { CollectionService } from './collection.service';

function setup(hours: number, user: { id: string } | null = { id: 'u1' }) {
  const run = vi.fn(async () => ({}));
  const scheduler = new CollectionScheduler(
    { COLLECT_EVERY_HOURS: hours } as Env,
    { run } as unknown as CollectionService,
    { user: { findFirst: async () => user } } as unknown as PrismaService,
  );
  return { scheduler, run };
}

describe('CollectionScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ne planifie rien quand COLLECT_EVERY_HOURS vaut 0', async () => {
    const { scheduler, run } = setup(0);

    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(10 * 24 * 60 * 60 * 1000);

    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lance une première collecte après une minute, puis une toutes les N heures', async () => {
    const { scheduler, run } = setup(6);
    scheduler.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(59_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('u1');

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.onModuleDestroy();
  });

  it('collecte quotidienne : une seule fois par jour à l’heure de Paris, pas au démarrage', async () => {
    vi.setSystemTime(new Date('2026-11-10T06:00:00Z'));
    const run = vi.fn(async () => ({}));
    const scheduler = new CollectionScheduler(
      { COLLECT_EVERY_HOURS: 6, COLLECT_DAILY_AT: '08:30' } as Env,
      { run } as unknown as CollectionService,
      { user: { findFirst: async () => ({ id: 'u1' }) } } as unknown as PrismaService,
    );
    scheduler.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('s’arrête proprement : plus de minuteur après la fermeture', () => {
    const { scheduler } = setup(6);
    scheduler.onApplicationBootstrap();

    scheduler.onModuleDestroy();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('ne fait rien sans utilisateur', async () => {
    const { scheduler, run } = setup(6, null);

    await scheduler.tick();

    expect(run).not.toHaveBeenCalled();
  });

  it('absorbe toute erreur sans la propager', async () => {
    const { scheduler, run } = setup(6);
    run.mockRejectedValueOnce(new Error('échec avec https://x/?key=SECRET'));

    await expect(scheduler.tick()).resolves.toBeUndefined();
  });
});
