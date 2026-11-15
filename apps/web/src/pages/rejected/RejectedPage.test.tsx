import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../App';
import { setCsrfToken } from '../../api/client';
import { AuthProvider } from '../../auth/AuthProvider';

const DAY = 86_400_000;
const row = (id: string, title: string, daysLeft: number, hasLetter = false) => ({
  id,
  title,
  company: 'Atelier Pivot',
  city: 'Élancourt',
  postcode: '78990',
  contractType: 'ALTERNANCE',
  score: 80,
  rejectedAt: new Date(Date.now() - (7 - daysLeft) * DAY).toISOString(),
  expiresAt: new Date(Date.now() + daysLeft * DAY - 1000).toISOString(),
  hasLetter,
});

interface Call {
  method: string;
  path: string;
}

function fakeApi(initial: ReturnType<typeof row>[], restoreStatus = 200) {
  const calls: Call[] = [];
  let items = initial;
  const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/api/, '');
      calls.push({ method, path });
      if (path === '/auth/me') return json({ login: 'souley.fall', csrfToken: 'csrf' });
      if (path === '/collection/last') return json({}, 404);
      if (path === '/offers/rejected') return json({ total: items.length, items });
      if (/^\/offers\/[\w-]+\/restore$/.test(path) && method === 'POST') {
        if (restoreStatus !== 200) return json({ message: 'Trop tard' }, restoreStatus);
        const id = path.split('/')[2];
        items = items.filter((o) => o.id !== id);
        return json({ rejected: false });
      }
      return json({ message: 'inconnu' }, 404);
    }),
  );
  return calls;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/rejetees']}>
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

describe('écran Rejetées', () => {
  it('liste les offres rejetées avec le délai restant avant leur suppression', async () => {
    fakeApi([
      row('o1', 'Alternance full stack', 5),
      row('o2', 'Dev React', 2),
      row('o3', 'Dev Vue', 1),
    ]);
    renderPage();

    const list = within(await screen.findByRole('region', { name: 'Offres rejetées' }));
    expect(await list.findByText('Alternance full stack')).toBeInTheDocument();
    expect(list.getByText('Supprimée dans 5 jours')).toBeInTheDocument();
    expect(list.getByText('Supprimée dans 2 jours')).toBeInTheDocument();
    expect(list.getByText('Supprimée dans moins de 24 h')).toBeInTheDocument();
  });

  it('prévient quand la lettre sera supprimée avec l’offre', async () => {
    fakeApi([row('o1', 'Alternance full stack', 3, true)]);
    renderPage();

    expect(await screen.findByText(/sa lettre sera supprimée aussi/)).toBeInTheDocument();
  });

  it('affiche le compteur de rejetées dans la barre latérale', async () => {
    fakeApi([row('o1', 'A', 5), row('o2', 'B', 5), row('o3', 'C', 5)]);
    renderPage();

    const link = await screen.findByRole('link', { name: /^Rejetées/ });
    await waitFor(() => expect(within(link).getByText('3')).toBeInTheDocument());
  });

  it('restaure une offre : elle disparaît de la liste', async () => {
    const calls = fakeApi([row('o1', 'Alternance full stack', 5), row('o2', 'Dev React', 4)]);
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Restaurer Alternance full stack' }),
    );

    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'POST', path: '/offers/o1/restore' }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Alternance full stack')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Dev React')).toBeInTheDocument();
  });

  it('signale une restauration refusée (délai dépassé) sans retirer l’offre', async () => {
    fakeApi([row('o1', 'Alternance full stack', 1)], 409);
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Restaurer Alternance full stack' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/Restauration impossible/);
    expect(screen.getByText('Alternance full stack')).toBeInTheDocument();
  });

  it('explique à quoi sert l’écran quand rien n’est rejeté', async () => {
    fakeApi([]);
    renderPage();

    expect(await screen.findByText('Aucune offre rejetée.')).toBeInTheDocument();
    expect(screen.getByText(/sans écrire de lettre/)).toBeInTheDocument();
  });
});
