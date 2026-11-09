import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { setCsrfToken } from './api/client';

type Route = { status: number; body?: unknown };

/** Fausse API : une réponse par « METHODE /chemin ». */
function fakeApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.replace(/^\/api/, '')}`;
    const route = routes[key] ?? { status: 404 };
    return route.status === 204
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(route.body ?? {}), { status: route.status });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
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

describe('connexion', () => {
  it('renvoie vers la connexion quand il n’y a pas de session', async () => {
    fakeApi({ 'GET /auth/me': { status: 401, body: { message: 'Connexion requise' } } });
    renderAt('/suivi');
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });

  it('affiche l’application quand la session existe', async () => {
    fakeApi({ 'GET /auth/me': { status: 200, body: { login: 'souley.fall', csrfToken: 't' } } });
    renderAt('/suivi');
    expect(await screen.findByRole('heading', { name: 'Suivi' })).toBeInTheDocument();
    expect(screen.getByText('Connecté : souley.fall')).toBeInTheDocument();
  });

  it('affiche un message clair et reste sur la page si le mot de passe est faux', async () => {
    fakeApi({
      'GET /auth/me': { status: 401 },
      'POST /auth/login': { status: 401, body: { message: 'Identifiants invalides' } },
    });
    const user = userEvent.setup();
    renderAt('/connexion');
    await user.type(await screen.findByLabelText('Identifiant'), 'souley.fall');
    await user.type(screen.getByLabelText('Mot de passe'), 'mauvais');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Identifiant ou mot de passe incorrect.',
    );
    expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });

  it('connecte puis déconnecte, en envoyant le jeton CSRF à la déconnexion', async () => {
    const fn = fakeApi({
      'GET /auth/me': { status: 401 },
      'POST /auth/login': { status: 200, body: { login: 'souley.fall', csrfToken: 'csrf-1' } },
      'POST /auth/logout': { status: 204 },
    });
    const user = userEvent.setup();
    renderAt('/connexion');
    await user.type(await screen.findByLabelText('Identifiant'), 'souley.fall');
    await user.type(screen.getByLabelText('Mot de passe'), 'bon-mot-de-passe');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('heading', { name: 'À valider' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument(),
    );
    const logout = fn.mock.calls.find(([url]) => url === '/api/auth/logout');
    expect((logout?.[1]?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-1');
  });

  it('permet d’afficher et de masquer le mot de passe', async () => {
    fakeApi({ 'GET /auth/me': { status: 401 } });
    const user = userEvent.setup();
    renderAt('/connexion');
    const field = await screen.findByLabelText('Mot de passe');
    expect(field).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Afficher' }));
    expect(field).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Masquer' }));
    expect(field).toHaveAttribute('type', 'password');
  });
});
