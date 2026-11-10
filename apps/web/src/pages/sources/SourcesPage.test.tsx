import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../App';
import { setCsrfToken } from '../../api/client';
import { AuthProvider } from '../../auth/AuthProvider';

const report = {
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  purged: 2,
  analyzed: 40,
  pendingAnalysis: 0,
  sources: [
    {
      source: 'LBA',
      status: 'ok',
      fetched: 100,
      skipped: 0,
      excluded: 0,
      irrelevant: 0,
      duplicates: 0,
      created: 30,
      updated: 0,
    },
    {
      source: 'LBB',
      status: 'error',
      reason: 'rate_limited',
      fetched: 0,
      skipped: 0,
      excluded: 0,
      irrelevant: 0,
      duplicates: 0,
      created: 0,
      updated: 0,
    },
    {
      source: 'ADZUNA',
      status: 'disabled',
      fetched: 0,
      skipped: 0,
      excluded: 0,
      irrelevant: 0,
      duplicates: 0,
      created: 0,
      updated: 0,
    },
    {
      source: 'GOOGLE_JOBS',
      status: 'ok',
      fetched: 20,
      skipped: 0,
      excluded: 0,
      irrelevant: 5,
      duplicates: 1,
      created: 14,
      updated: 0,
    },
    {
      source: 'GLASSDOOR',
      status: 'ok',
      fetched: 60,
      skipped: 0,
      excluded: 0,
      irrelevant: 12,
      duplicates: 2,
      created: 40,
      updated: 0,
    },
    {
      source: 'INDEED',
      status: 'ok',
      fetched: 9,
      skipped: 0,
      excluded: 0,
      irrelevant: 2,
      duplicates: 0,
      created: 7,
      updated: 0,
    },
  ],
};

import type { ApiHealthItem } from '../../api/types';

function fakeApi(options: { last: boolean; health?: ApiHealthItem[] }) {
  const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.replace(/^\/api/, '');
      if (path === '/auth/me') return json({ login: 'souley.fall', csrfToken: 'csrf' });
      if (path === '/collection/status') {
        return json({
          sources: {
            LBA: true,
            LBB: true,
            ADZUNA: false,
            GOOGLE_JOBS: true,
            GLASSDOOR: true,
            INDEED: true,
            LINKEDIN: true,
          },
          gemini: { configured: true, model: 'gemini-3.5-flash-lite' },
        });
      }
      if (path === '/gmail/status') return json({ configured: false });
      if (path === '/api-health') return json({ items: options.health ?? [] });
      if (path === '/collection/last') return options.last ? json(report) : json({}, 404);
      return json({}, 404);
    }),
  );
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/sources']}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('écran Sources', () => {
  it('distingue connectée, en erreur, non configurée et pas encore connectée', async () => {
    fakeApi({ last: true });
    renderApp();
    const table = await screen.findByRole('table', { name: 'État des sources' });
    const rowOf = (name: string) => within(table).getByRole('row', { name: new RegExp(name) });
    expect(rowOf('La Bonne Alternance')).toHaveTextContent('Connectée');
    expect(rowOf('La Bonne Alternance')).toHaveTextContent('100 lues, 30 nouvelles');
    expect(rowOf('La Bonne Boîte')).toHaveTextContent('En erreur');
    expect(rowOf('La Bonne Boîte')).toHaveTextContent('quota atteint');
    expect(rowOf('Adzuna')).toHaveTextContent('Non configurée');
    expect(rowOf('Adzuna')).toHaveTextContent('Jobs by Adzuna');
    expect(rowOf('Google Jobs')).toHaveTextContent('Connectée');
    expect(rowOf('Google Jobs')).toHaveTextContent('20 lues, 14 nouvelles');
    expect(rowOf('Google Jobs')).toHaveTextContent('LinkedIn, Indeed, Welcome to the Jungle');
    expect(rowOf('Glassdoor')).toHaveTextContent('Connectée');
    expect(rowOf('Glassdoor')).toHaveTextContent('60 lues, 40 nouvelles');
    expect(rowOf('Glassdoor')).toHaveTextContent('extrait du texte');
    expect(rowOf('^Indeed \\(alertes')).toHaveTextContent('Connectée');
    expect(rowOf('^Indeed \\(alertes')).toHaveTextContent('9 lues, 7 nouvelles');
    expect(rowOf('^Indeed \\(alertes')).toHaveTextContent('aucun appel à Indeed');
    expect(rowOf('Gemini')).toHaveTextContent('gemini-3.5-flash-lite');
    expect(rowOf('^Gmail')).toHaveTextContent('Non configuré');
  });

  it('un quota atteint passe en rouge avec la date, une panne en orange, une clé refusée est dite', async () => {
    fakeApi({
      last: true,
      health: [
        { key: 'GLASSDOOR', status: 'QUOTA', checkedAt: '2026-11-10T07:30:00Z', lastOkAt: null },
        {
          key: 'GEMINI',
          status: 'QUOTA',
          checkedAt: '2026-11-10T07:31:00Z',
          lastOkAt: '2026-11-09T07:00:00Z',
        },
        { key: 'GOOGLE_JOBS', status: 'DOWN', checkedAt: '2026-11-10T07:30:00Z', lastOkAt: null },
        { key: 'LBA', status: 'AUTH', checkedAt: '2026-11-10T07:30:00Z', lastOkAt: null },
        { key: 'ADZUNA', status: 'QUOTA', checkedAt: '2026-11-10T07:30:00Z', lastOkAt: null },
      ],
    });
    renderApp();
    const table = await screen.findByRole('table', { name: 'État des sources' });
    const rowOf = (name: string) => within(table).getByRole('row', { name: new RegExp(name) });

    expect(rowOf('Glassdoor')).toHaveTextContent('Quota atteint');
    expect(rowOf('Glassdoor')).toHaveTextContent('Dernier succès : aucun');
    expect(rowOf('Gemini')).toHaveTextContent('Quota atteint');
    expect(rowOf('Gemini')).toHaveTextContent('Dernier succès : 09/11');
    expect(rowOf('Google Jobs')).toHaveTextContent('Panne');
    expect(rowOf('La Bonne Alternance')).toHaveTextContent('Clé refusée');
    // Une source non configurée reste « Non configurée », même si la base garde un vieil état.
    expect(rowOf('Adzuna')).toHaveTextContent('Non configurée');
    expect(rowOf('Glassdoor').querySelector('.text-danger')).not.toBeNull();
  });

  it('affiche un bandeau rouge sur tout l’écran quand un quota est atteint ou une clé refusée', async () => {
    fakeApi({
      last: true,
      health: [
        { key: 'GLASSDOOR', status: 'QUOTA', checkedAt: '2026-11-10T07:30:00Z', lastOkAt: null },
        { key: 'GEMINI', status: 'QUOTA', checkedAt: '2026-11-10T07:31:00Z', lastOkAt: null },
        { key: 'LBA', status: 'AUTH', checkedAt: '2026-11-10T07:30:00Z', lastOkAt: null },
        { key: 'LBB', status: 'DOWN', checkedAt: '2026-11-10T07:30:00Z', lastOkAt: null },
      ],
    });
    renderApp();

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Quota atteint : Glassdoor, Gemini.');
    expect(banner).toHaveTextContent('Clé refusée : La Bonne Alternance.');
    // Une simple panne ne déclenche pas le bandeau.
    expect(banner).not.toHaveTextContent('La Bonne Boîte');
  });

  it('pas de bandeau quand tout va bien ou que l’état est illisible', async () => {
    fakeApi({ last: true, health: [] });
    renderApp();
    await screen.findByRole('table', { name: 'État des sources' });

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('fonctionne sans bilan de collecte', async () => {
    fakeApi({ last: false });
    renderApp();
    const table = await screen.findByRole('table', { name: 'État des sources' });
    expect(screen.getByText(/Lance-en une depuis la barre latérale/)).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /La Bonne Alternance/ })).toHaveTextContent(
      'Configurée',
    );
  });
});
