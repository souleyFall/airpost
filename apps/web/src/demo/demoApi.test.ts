import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationRow, FollowUpResult, OfferDetail, OfferList, Stats } from '../api/types';
import { demoApi, resetDemo, setDemoDelayScale } from './demoApi';

const get = <T>(path: string) => demoApi<T>('GET', path);
const post = <T>(path: string, body?: unknown) => demoApi<T>('POST', path, body);

beforeEach(() => {
  setDemoDelayScale(0);
  resetDemo();
  // La démo ne doit JAMAIS toucher au réseau : tout appel à fetch fait échouer le test.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('requête réseau interdite dans la démo');
    }),
  );
});

describe('démo : aucune requête réseau', () => {
  it('toute la navigation et toutes les actions se font sans appeler fetch', async () => {
    await get('/auth/me');
    await get('/profile');
    await get('/offers?pending=true&limit=20');
    await post('/offers/o1/letter');
    await get('/applications?limit=500');
    await get('/stats');
    await post('/collection/run');
    await post('/gmail/sync');
    await post('/offers/manual/extract', { text: 'Alternance développeur chez Exemple, Paris' });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('une route inconnue est refusée proprement (404), jamais envoyée ailleurs', async () => {
    await expect(get('/route-inconnue')).rejects.toMatchObject({ status: 404 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('démo : fil « À valider »', () => {
  it('trie par note décroissante, les offres sans note à la fin, et masque celles qui ont déjà une candidature', async () => {
    const list = await get<OfferList>('/offers?pending=true&limit=50&sort=score');

    const scores = list.items.map((o) => o.score);
    const noted = scores.filter((s): s is number => s !== null);
    expect(noted).toEqual([...noted].sort((a, b) => b - a));
    expect(scores.slice(noted.length).every((s) => s === null)).toBe(true);
    // Les offres des candidatures déjà envoyées ne sont pas dans le fil.
    expect(
      list.items.some((o) => o.application !== null && o.application.status !== 'TO_REVIEW'),
    ).toBe(false);
    expect(list.total).toBe(list.items.length);
  });

  it('filtre par texte, source, contrat, note minimale et distance', async () => {
    const titles = async (query: string) =>
      (await get<OfferList>(`/offers?pending=true&limit=50&${query}`)).items.map((o) => o.title);

    expect(await titles('q=symfony')).toEqual(['Alternance Développeur Web PHP Symfony']);
    expect((await titles('source=LINKEDIN')).length).toBeGreaterThan(0);
    expect(await titles('contract=SPONTANEE')).toEqual(['Candidature spontanée : Lumen Studio']);
    expect((await titles('minScore=80')).every((t) => t.length > 0)).toBe(true);
    const near = await get<OfferList>('/offers?pending=true&limit=50&maxDistanceKm=10');
    expect(near.items.every((o) => o.distanceKm === null || o.distanceKm <= 10)).toBe(true);
  });

  it('l’analyse « IA » révèle la note préparée d’une offre sans note', async () => {
    const before = await get<OfferDetail>('/offers/o9');
    expect(before.score).toBeNull();

    const result = await post<{ analyzed: number; items: { id: string; score: number | null }[] }>(
      '/offers/analyze',
      { ids: ['o9', 'o10'] },
    );

    expect(result.analyzed).toBe(2);
    expect(result.items).toEqual([
      { id: 'o9', score: 71, excluded: false },
      { id: 'o10', score: 52, excluded: false },
    ]);
    expect((await get<OfferDetail>('/offers/o9')).analysis).not.toBeNull();
  });

  it('une offre au contrat « spontané » ou « autre » reste sans note (comme dans le vrai produit)', async () => {
    const list = await get<OfferList>('/offers?pending=true&limit=50');
    const o11 = list.items.find((o) => o.id === 'o11');
    const o12 = list.items.find((o) => o.id === 'o12');

    expect(o11?.score).toBeNull();
    expect(o12?.score).toBeNull();
  });
});

describe('démo : de la lettre au suivi', () => {
  it('génère une lettre signée, la valide, puis la candidature apparaît dans le suivi', async () => {
    const letter = await post<{
      applicationId: string;
      subject: string;
      body: string;
      preview: string;
    }>('/offers/o1/letter');

    expect(letter.subject).toBe(
      'Candidature en alternance : Alternance Développeur Full Stack TypeScript',
    );
    expect(letter.body).toContain('Atelier Nova');
    expect(letter.preview).toContain('Léa Marchand');

    await post(`/applications/${letter.applicationId}/status`, { status: 'VALIDATED' });
    const rows = await get<ApplicationRow[]>('/applications?limit=500');
    expect(rows.find((r) => r.id === letter.applicationId)?.status).toBe('VALIDATED');
    // Plus dans le fil « À valider » : elle est partie au suivi.
    const pending = await get<OfferList>('/offers?pending=true&limit=50');
    expect(pending.items.some((o) => o.id === 'o1')).toBe(false);
  });

  it('refuse un passage de statut impossible (409), et une validation sans lettre (422)', async () => {
    await expect(post('/applications/p6/status', { status: 'VALIDATED' })).rejects.toMatchObject({
      status: 409,
    });
    const generated = await post<{ applicationId: string }>('/offers/o2/letter');
    await demoApi('PATCH', `/applications/${generated.applicationId}`, { subject: ' ', body: ' ' });

    await expect(
      post(`/applications/${generated.applicationId}/status`, { status: 'VALIDATED' }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('démo : relances', () => {
  it('liste les candidatures à relancer, prépare un message, et la relance n’est possible qu’une fois', async () => {
    const rows = await get<ApplicationRow[]>('/applications?limit=500');
    const due = rows.filter((r) => r.followUp === 'due').map((r) => r.id);
    expect(due.length).toBeGreaterThanOrEqual(2);
    expect(rows.find((r) => r.id === 'p7')?.followUp).toBe('done');

    const draft = await post<FollowUpResult>('/applications/p1/follow-up');
    expect(draft.subject).toMatch(/^Relance : /);
    expect(draft.preview).toContain('Léa Marchand');

    await post('/applications/p1/follow-up/draft', { subject: draft.subject, body: draft.body });
    const after = await get<ApplicationRow[]>('/applications?limit=500');
    expect(after.find((r) => r.id === 'p1')?.followUp).toBe('done');
    await expect(post('/applications/p1/follow-up')).rejects.toMatchObject({ status: 409 });
  });
});

describe('démo : collecte et ajout manuel', () => {
  it('la collecte fait arriver de nouvelles offres, une seule fois', async () => {
    const before = (await get<OfferList>('/offers?pending=true&limit=50')).total;

    const report = await post<{ sources: { created: number }[] }>('/collection/run');
    const after = (await get<OfferList>('/offers?pending=true&limit=50')).total;

    expect(report.sources.reduce((n, s) => n + s.created, 0)).toBeGreaterThan(0);
    expect(after).toBe(before + 3);
    // Relancée : rien de plus (la démo ne fabrique pas d'offres à l'infini).
    await post('/collection/run');
    expect((await get<OfferList>('/offers?pending=true&limit=50')).total).toBe(after);
  });

  it('lit un texte collé, ajoute l’offre, la note, et n’en crée pas deux pour la même annonce', async () => {
    const extracted = await post<{
      title: string;
      company: string | null;
      city: string | null;
      contactEmail: string | null;
    }>('/offers/manual/extract', {
      text: 'Alternance Développeur Web\nPoste chez Mareva Conseil, Paris. Contact : rh@mareva.exemple.test',
    });
    expect(extracted).toMatchObject({
      title: 'Alternance Développeur Web',
      city: 'Paris',
      contactEmail: 'rh@mareva.exemple.test',
    });
    expect(extracted.company).toBe('Mareva Conseil');

    const created = await post<{ id: string; created: boolean; analyzed: boolean }>(
      '/offers/manual',
      {
        text: 'Annonce collée',
        title: extracted.title,
        company: extracted.company,
        city: extracted.city,
        contactEmail: extracted.contactEmail,
        applyUrl: 'https://exemple.test/annonce',
      },
    );
    expect(created).toMatchObject({ created: true, analyzed: true });
    expect((await get<OfferDetail>(`/offers/${created.id}`)).score).not.toBeNull();

    const again = await post<{ id: string; created: boolean }>('/offers/manual', {
      text: 'Annonce collée',
      title: 'alternance développeur web',
      company: 'MAREVA CONSEIL',
      city: 'paris',
    });
    expect(again).toEqual({ id: created.id, created: false, analyzed: false });
  });
});

describe('démo : tableau de bord cohérent avec les candidatures', () => {
  it('calcule le tunnel, les sources et les relances à partir des mêmes données que le suivi', async () => {
    const stats = await get<Stats>('/stats');
    const rows = await get<ApplicationRow[]>('/applications?limit=500');

    const sent = rows.filter((r) => r.appliedAt !== null);
    expect(stats.funnel.applied).toBe(sent.length);
    expect(stats.funnel.interviews).toBe(1);
    expect(stats.funnel.rejections).toBe(1);
    expect(stats.pipeline.toFollowUp).toBe(rows.filter((r) => r.followUp === 'due').length);
    expect(stats.bySource.reduce((n, s) => n + s.applied, 0)).toBe(sent.length);
    expect(stats.weekly).toHaveLength(8);
    expect(stats.weekly.reduce((n, w) => n + w.applied, 0)).toBe(sent.length);
    expect(stats.followUps).toEqual({ sent: 1, answeredAfter: 0 });
    expect(stats.smallSample).toBe(sent.length < 5);
  });

  it('suit les actions du visiteur : une candidature marquée « envoyée » compte dans le tunnel', async () => {
    const before = (await get<Stats>('/stats')).funnel.applied;

    await post('/applications/p8/status', { status: 'APPLIED' });

    expect((await get<Stats>('/stats')).funnel.applied).toBe(before + 1);
  });
});

describe('démo : remise à zéro', () => {
  it('resetDemo remet toutes les données de départ', async () => {
    await post('/offers/o1/letter');
    await post('/collection/run');

    resetDemo();

    expect(
      (await get<OfferList>('/offers?pending=true&limit=50')).items.some((o) => o.id === 'n1'),
    ).toBe(false);
    expect(
      (await get<ApplicationRow[]>('/applications?limit=500')).some((r) => r.offer.id === 'o1'),
    ).toBe(false);
  });
});
