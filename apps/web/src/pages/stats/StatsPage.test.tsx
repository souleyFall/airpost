import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../App';
import type { Stats } from '../../api/types';
import { setCsrfToken } from '../../api/client';
import { AuthProvider } from '../../auth/AuthProvider';

const base: Stats = {
  pipeline: { toReview: 3, toSend: 1, waiting: 6, toFollowUp: 2 },
  funnel: {
    applied: 10,
    answered: 4,
    interviews: 2,
    rejections: 1,
    unanswered: 6,
    answerRate: 0.4,
    interviewRate: 0.2,
    medianDaysToFirstReply: 3.5,
  },
  bySource: [
    { source: 'LBA', applied: 6, answered: 3, interviews: 2 },
    { source: 'INDEED', applied: 2, answered: 0, interviews: 0 },
  ],
  weekly: Array.from({ length: 8 }, (_, i) => ({
    weekStart: `2026-09-${String(21 + i * 7 > 30 ? 21 + i * 7 - 30 : 21 + i * 7).padStart(2, '0')}`,
    applied: i === 7 ? 4 : i === 6 ? 2 : 0,
  })),
  followUps: { sent: 3, answeredAfter: 1 },
  offers: {
    total: 363,
    newThisWeek: 41,
    newThisWeekBySource: [{ source: 'GLASSDOOR', count: 30 }],
  },
  smallSample: false,
};

function fakeApi(stats: Stats | 'erreur') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.replace(/^\/api/, '');
      const json = (data: unknown, code = 200) =>
        new Response(JSON.stringify(data), { status: code });
      if (path === '/auth/me') return json({ login: 'souley.fall', csrfToken: 'csrf' });
      if (path === '/stats') return stats === 'erreur' ? json({}, 500) : json(stats);
      return json({}, 404);
    }),
  );
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/resultats']}>
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

describe('écran Résultats', () => {
  it('affiche le tunnel, l’avancement, les sources, les relances et les offres', async () => {
    fakeApi(base);
    renderApp();

    const funnel = await screen.findByRole('region', { name: 'Candidatures envoyées' });
    expect(within(funnel).getByText('Envoyées').nextElementSibling).toHaveTextContent('10');
    expect(within(funnel).getByText('Réponses reçues').nextElementSibling).toHaveTextContent('4');
    expect(within(funnel).getByText(/40 % des envoyées/)).toBeInTheDocument();
    expect(within(funnel).getByText(/20 % des envoyées/)).toBeInTheDocument();
    expect(within(funnel).getByText('3.5 j')).toBeInTheDocument();
    expect(within(funnel).getByText(/6 sans réponse, 1 refus/)).toBeInTheDocument();

    const pipeline = screen.getByRole('region', { name: 'En cours' });
    expect(within(pipeline).getByText('À relancer').nextElementSibling).toHaveTextContent('2');
    expect(within(pipeline).getByRole('link', { name: /préparer les relances/ })).toHaveAttribute(
      'href',
      '/suivi',
    );

    const table = screen.getByRole('table', { name: 'Résultats par source' });
    const lba = within(table).getByRole('row', { name: /La Bonne Alternance/ });
    expect(lba).toHaveTextContent('6');
    expect(lba).toHaveTextContent('50 %');
    expect(within(table).getByRole('row', { name: /Indeed/ })).toHaveTextContent('0 %');
    // Moins de 3 envois : on le dit, un pourcentage sur 2 ne prouve rien.
    expect(within(table).getByRole('row', { name: /Indeed/ })).toHaveTextContent('(sur 2)');

    expect(screen.getByText(/3 relances faites, dont 1 suivie d’une réponse/)).toBeInTheDocument();
    expect(screen.getByText(/363 offres en base, dont 41 nouvelles/)).toBeInTheDocument();
    expect(screen.getByText(/Glassdoor 30/)).toBeInTheDocument();
    expect(screen.queryByText(/Trop tôt pour conclure/)).not.toBeInTheDocument();
  });

  it('prévient quand l’échantillon est trop petit', async () => {
    fakeApi({
      ...base,
      smallSample: true,
      funnel: { ...base.funnel, applied: 2, answered: 1, answerRate: 0.5 },
    });
    renderApp();

    expect(await screen.findByRole('note')).toHaveTextContent(
      /Trop tôt pour conclure.*2 candidatures/,
    );
  });

  it('sans aucune candidature : tirets et phrases vides, pas de pourcentage inventé', async () => {
    fakeApi({
      pipeline: { toReview: 0, toSend: 0, waiting: 0, toFollowUp: 0 },
      funnel: {
        applied: 0,
        answered: 0,
        interviews: 0,
        rejections: 0,
        unanswered: 0,
        answerRate: null,
        interviewRate: null,
        medianDaysToFirstReply: null,
      },
      bySource: [],
      weekly: base.weekly.map((w) => ({ ...w, applied: 0 })),
      followUps: { sent: 0, answeredAfter: 0 },
      offers: { total: 0, newThisWeek: 0, newThisWeekBySource: [] },
      smallSample: true,
    });
    renderApp();

    const funnel = await screen.findByRole('region', { name: 'Candidatures envoyées' });
    expect(within(funnel).getAllByText('— des envoyées')).toHaveLength(2);
    expect(within(funnel).getByText('Aucune réponse encore')).toBeInTheDocument();
    expect(screen.getByText('Aucune candidature envoyée pour l’instant.')).toBeInTheDocument();
    expect(screen.getByText('Aucune relance faite pour l’instant.')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  it('une erreur du serveur est dite, sans écran vide', async () => {
    fakeApi('erreur');
    renderApp();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossible de charger les résultats.',
    );
  });

  it('le lien « Résultats » est dans la navigation', async () => {
    fakeApi(base);
    renderApp();

    const nav = await screen.findByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getByRole('link', { name: /Résultats/ })).toHaveAttribute(
      'href',
      '/resultats',
    );
  });
});
