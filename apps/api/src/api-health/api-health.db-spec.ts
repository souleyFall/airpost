import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { ApiHealthService } from './api-health.service';

describe('ApiHealthService (intégration, base réelle)', () => {
  const prisma = new PrismaService(parseEnv());
  const health = new ApiHealthService(prisma);

  beforeEach(async () => {
    await prisma.apiHealth.deleteMany();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('crée la ligne puis la met à jour : une ligne par connexion', async () => {
    await health.record('GLASSDOOR', 'OK');
    await health.record('GLASSDOOR', 'QUOTA');

    const rows = await health.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'GLASSDOOR', status: 'QUOTA' });
  });

  it('garde la date du dernier succès quand l’état devient mauvais, et la renouvelle au retour', async () => {
    await health.record('LBA', 'OK');
    const ok = (await health.list())[0]?.lastOkAt;
    expect(ok).toBeInstanceOf(Date);

    await health.record('LBA', 'QUOTA');
    expect((await health.list())[0]?.lastOkAt).toEqual(ok);

    await new Promise((resolve) => setTimeout(resolve, 15));
    await health.record('LBA', 'OK');
    expect((await health.list())[0]?.lastOkAt?.getTime()).toBeGreaterThan(ok?.getTime() ?? 0);
  });

  it('une connexion qui n’a jamais réussi n’a pas de date de dernier succès', async () => {
    await health.record('INDEED', 'OFF');

    expect((await health.list())[0]?.lastOkAt).toBeNull();
  });

  it('recordIfChanged n’écrit pas quand l’état est le même, et écrit quand il change', async () => {
    await health.recordIfChanged('GEMINI', 'OK');
    const first = (await health.list())[0]?.checkedAt;
    await new Promise((resolve) => setTimeout(resolve, 15));

    await health.recordIfChanged('GEMINI', 'OK');
    expect((await health.list())[0]?.checkedAt).toEqual(first);

    await health.recordIfChanged('GEMINI', 'QUOTA');
    expect((await health.list())[0]?.status).toBe('QUOTA');
  });
});
