import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../App';
import { setCsrfToken } from '../../api/client';
import { AuthProvider } from '../../auth/AuthProvider';
import type { Profile } from './profileForm';

const profile: Profile = {
  identity: {
    firstName: 'Souleymane',
    lastName: 'Fall',
    city: 'Montigny-le-Bretonneux',
    postcode: '78180',
  },
  headline: 'Développeur Full Stack',
  summary: 'Résumé',
  education: [],
  experiences: [
    { company: 'Cash Flow Positif', role: 'Stage', startDate: '2025-09', achievements: ['A'] },
  ],
  skills: { languages: ['TypeScript'], frameworks: [], tools: [], other: [] },
  search: {
    contracts: ['ALTERNANCE'],
    rhythms: ['AUTRE'],
    startDate: 'asap',
    maxCommuteMinutes: 75,
    keywords: ['React'],
    romeCodes: ['M1805'],
    excludedCompanies: [],
  },
};

function fakeApi(options: { existing: boolean; putStatus?: number }) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/api/, '');
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      calls.push({ method, path, body });
      if (path === '/auth/me') return json({ login: 'souley.fall', csrfToken: 'csrf' });
      if (path === '/profile' && method === 'GET') {
        return options.existing ? json(profile) : json({ message: 'Profil non renseigné' }, 404);
      }
      if (path === '/profile' && method === 'PUT') {
        if (options.putStatus === 400) {
          return json(
            {
              message: 'Requête invalide',
              errors: [{ champ: 'identity.postcode', probleme: '5 chiffres attendus' }],
            },
            400,
          );
        }
        return json(body);
      }
      return json({}, 404);
    }),
  );
  return calls;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/profil']}>
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

describe('écran Profil', () => {
  it('affiche le profil existant', async () => {
    fakeApi({ existing: true });
    renderApp();
    expect(await screen.findByLabelText('Prénom')).toHaveValue('Souleymane');
    expect(screen.getByLabelText('Code postal')).toHaveValue('78180');
    expect(screen.getByLabelText('Langages')).toHaveValue('TypeScript');
    expect(screen.getByLabelText('Trajet maximum (minutes)')).toHaveValue('75');
  });

  it('propose un formulaire vide quand aucun profil n’existe', async () => {
    fakeApi({ existing: false });
    renderApp();
    expect(await screen.findByText(/Renseigne ton profil pour noter/)).toBeInTheDocument();
    expect(screen.getByLabelText('Prénom')).toHaveValue('');
  });

  it('enregistre les modifications avec le jeton CSRF', async () => {
    const calls = fakeApi({ existing: true });
    const user = userEvent.setup();
    renderApp();
    const city = await screen.findByLabelText('Ville');
    await user.clear(city);
    await user.type(city, 'Élancourt');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le profil' }));
    expect(await screen.findByText(/Profil enregistré/)).toBeInTheDocument();
    const put = calls.find((c) => c.method === 'PUT');
    expect((put?.body as Profile).identity.city).toBe('Élancourt');
    expect((put?.body as Profile).identity).not.toHaveProperty('email');
  });

  it('affiche les champs refusés par l’API, sans perdre la saisie', async () => {
    fakeApi({ existing: true, putStatus: 400 });
    const user = userEvent.setup();
    renderApp();
    const postcode = await screen.findByLabelText('Code postal');
    await user.clear(postcode);
    await user.type(postcode, '12');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le profil' }));
    expect(await screen.findByText(/5 chiffres attendus/)).toBeInTheDocument();
    expect(screen.getByText('identity.postcode')).toBeInTheDocument();
    expect(screen.getByLabelText('Code postal')).toHaveValue('12');
  });

  it('choisit les contrats recherchés (alternance et stage) et les envoie à l’API', async () => {
    const calls = fakeApi({ existing: true });
    const user = userEvent.setup();
    renderApp();
    const alternance = await screen.findByRole('checkbox', { name: 'Alternance' });
    const stage = screen.getByRole('checkbox', { name: 'Stage' });
    expect(alternance).toBeChecked();
    expect(stage).not.toBeChecked();
    await user.click(stage);
    await user.click(screen.getByRole('button', { name: 'Enregistrer le profil' }));
    await screen.findByText(/Profil enregistré/);
    const put = calls.find((c) => c.method === 'PUT');
    expect((put?.body as Profile).search.contracts).toEqual(['ALTERNANCE', 'STAGE']);
  });

  it('ajoute et retire une expérience', async () => {
    fakeApi({ existing: true });
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText('Prénom');
    await user.click(screen.getByRole('button', { name: 'Ajouter une expérience' }));
    expect(screen.getAllByLabelText('Entreprise')).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Retirer cette expérience' })[1]);
    await waitFor(() => expect(screen.getAllByLabelText('Entreprise')).toHaveLength(1));
  });
});
