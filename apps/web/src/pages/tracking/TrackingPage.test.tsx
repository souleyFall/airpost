import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../App';
import { setCsrfToken } from '../../api/client';
import { AuthProvider } from '../../auth/AuthProvider';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const row = (id: string, status: string, title: string, appliedDays: number | null) => ({
  id,
  status,
  subject: 'Objet',
  validatedAt: daysAgo(5),
  appliedAt: appliedDays === null ? null : daysAgo(appliedDays),
  createdAt: daysAgo(6),
  updatedAt: daysAgo(1),
  offer: {
    id: `offer-${id}`,
    source: 'LBA',
    title,
    company: `Entreprise ${id}`,
    city: 'Paris',
    channel: 'EMAIL',
    applyUrl: null,
    score: 80,
  },
});

function fakeApi() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let rows = [
    row('a', 'VALIDATED', 'Poste validé', null),
    row('b', 'APPLIED', 'Poste ancien', 20),
    row('c', 'APPLIED', 'Poste récent', 2),
    row('d', 'REJECTED', 'Poste refusé', 30),
    row('e', 'TO_REVIEW', 'Encore en relecture', null),
  ];
  const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/api/, '');
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      calls.push({ method, path, body });
      if (path === '/auth/me') return json({ login: 'souley.fall', csrfToken: 'csrf' });
      if (path.startsWith('/applications?')) return json(rows);
      const status = /^\/applications\/(\w+)\/status$/.exec(path);
      if (status && method === 'POST') {
        const next = (body as { status: string }).status;
        rows = rows.map((r) => (r.id === status[1] ? { ...r, status: next } : r));
        return json({});
      }
      const del = /^\/applications\/(\w+)$/.exec(path);
      if (del && method === 'DELETE') {
        rows = rows.filter((r) => r.id !== del[1]);
        return new Response(null, { status: 204 });
      }
      return json({}, 404);
    }),
  );
  return calls;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/suivi']}>
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

describe('écran Suivi', () => {
  it('liste les candidatures suivies, sans celles encore en relecture', async () => {
    fakeApi();
    renderApp();
    expect(await screen.findByText('Poste validé')).toBeInTheDocument();
    expect(screen.queryByText('Encore en relecture')).not.toBeInTheDocument();
    expect(screen.getByText(/4\s+candidatures/)).toBeInTheDocument();
  });

  it('signale « à relancer » après 14 jours et filtre', async () => {
    fakeApi();
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Poste ancien');
    expect(screen.getByText(/Sans nouvelle depuis 20 jours/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^À relancer/ }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Poste ancien')).toBeInTheDocument();
    expect(within(table).queryByText('Poste récent')).not.toBeInTheDocument();
  });

  it('marque une candidature comme envoyée', async () => {
    const calls = fakeApi();
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Marquer envoyée' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/applications/a/status',
        body: { status: 'APPLIED' },
      }),
    );
  });

  it('change le statut avec la liste déroulante, sans proposer les passages interdits', async () => {
    const calls = fakeApi();
    const user = userEvent.setup();
    renderApp();
    const select = await screen.findByLabelText('Changer le statut de Poste récent');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toContain('Entretien');
    expect(options).not.toContain('Brouillon créé');
    await user.selectOptions(select, 'Entretien');
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/applications/c/status',
        body: { status: 'INTERVIEW' },
      }),
    );
  });

  it('demande une confirmation avant de supprimer', async () => {
    const calls = fakeApi();
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Poste validé');
    await user.click(screen.getAllByRole('button', { name: 'Supprimer' })[0]);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(screen.queryByText('Poste validé')).not.toBeInTheDocument());
  });
});
