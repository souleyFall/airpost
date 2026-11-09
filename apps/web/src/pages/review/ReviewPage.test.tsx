import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../App';
import { setCsrfToken } from '../../api/client';
import { AuthProvider } from '../../auth/AuthProvider';

const DETAIL = {
  total: 91,
  freshness: 25,
  stack: 25,
  rhythm: 8,
  commute: 15,
  competition: 8,
  channel: 10,
  matchedTerms: ['typescript', 'react'],
  detectedRhythm: null,
  distanceKm: 8,
  estimatedMinutes: 17,
};

const now = new Date().toISOString();
const offer = (
  id: string,
  title: string,
  score: number,
  application: { id: string; status: string } | null = null,
) => ({
  id,
  source: 'LBA',
  title,
  company: 'Atelier Pivot',
  city: 'Élancourt',
  postcode: '78990',
  channel: id === 'o2' ? 'SITE' : 'EMAIL',
  applyUrl: 'https://exemple.test/offre',
  publishedAt: now,
  firstSeenAt: now,
  score,
  scoreDetail: DETAIL,
  application,
});

const LETTER_BODY = Array.from({ length: 130 }, (_, i) => `mot${i}`).join(' ');

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

/** Fausse API avec un petit état : la lettre n'existe qu'après génération. */
function fakeApi(options: { generated?: boolean } = {}) {
  const calls: Call[] = [];
  let hasLetter = options.generated ?? false;
  let status = 'TO_REVIEW';
  const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
  const appRef = () => (hasLetter ? { id: 'a1', status } : null);

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/api/, '');
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      calls.push({ method, path, body });
      if (path === '/auth/me') return json({ login: 'souley.fall', csrfToken: 'csrf' });
      if (path === '/collection/last') return json({}, 404);
      if (path.startsWith('/offers?')) {
        const items = [
          offer('o1', 'Alternance full stack', 91, appRef()),
          offer('o2', 'Dev React', 80),
        ];
        return json({
          total: 2,
          items: items.filter(
            (o) => o.application?.status !== 'WITHDRAWN' && o.application?.status !== 'VALIDATED',
          ),
        });
      }
      if (path === '/offers/o1') {
        return json({
          ...offer('o1', 'Alternance full stack', 91, appRef()),
          description: 'd',
          contactEmail: 'rh@exemple.test',
        });
      }
      if (path === '/offers/o2') {
        return json({ ...offer('o2', 'Dev React', 80), description: 'd', contactEmail: null });
      }
      if (path === '/offers/o1/letter' && method === 'POST') {
        hasLetter = true;
        return json({
          applicationId: 'a1',
          subject: 'Candidature',
          body: LETTER_BODY,
          preview: '',
          warnings: ['« Vue » est cité mais absent du profil'],
        });
      }
      if (path === '/applications/a1' && method === 'GET') {
        return json({ id: 'a1', status, subject: 'Candidature', body: LETTER_BODY });
      }
      if (path === '/applications/a1' && method === 'PATCH') {
        return json({ id: 'a1', status, ...(body as object) });
      }
      if (path === '/applications/a1/status') {
        status = (body as { status: string }).status;
        return json({});
      }
      return json({ message: 'inconnu' }, 404);
    }),
  );
  return calls;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
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

describe('écran À valider', () => {
  it('liste les offres classées, avec score et état de la lettre, et le détail de la première', async () => {
    fakeApi();
    renderApp();
    const list = await screen.findByRole('list');
    const rows = within(list).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('Alternance full stack');
    expect(rows[0]).toHaveTextContent('91');
    expect(rows[0]).toHaveTextContent('Sans lettre');
    expect(rows[1]).toHaveTextContent('Dev React');
    expect(await screen.findByText('Score 91 / 100')).toBeInTheDocument();
    expect(screen.getByText('Pas encore de lettre')).toBeInTheDocument();
  });

  it('filtre par canal', async () => {
    fakeApi();
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('list');
    await user.click(screen.getByRole('button', { name: /^Site/ }));
    const rows = within(screen.getByRole('list')).getAllByRole('button');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Dev React');
  });

  it('génère une lettre, affiche les points à vérifier, puis valide la candidature', async () => {
    const calls = fakeApi();
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Générer la lettre' }));

    expect(await screen.findByLabelText('Objet')).toHaveValue('Candidature');
    expect(screen.getByText(/cité mais absent du profil/)).toBeInTheDocument();
    expect(screen.getByLabelText('Destinataire')).toHaveValue('rh@exemple.test');
    expect(screen.getByText(/130 mots/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Valider la candidature' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/applications/a1/status',
        body: { status: 'VALIDATED' },
      }),
    );
    // L'offre validée quitte l'écran.
    await waitFor(() =>
      expect(within(screen.getByRole('list')).getAllByRole('button')).toHaveLength(1),
    );
  });

  it('enregistre les modifications avant de valider', async () => {
    const calls = fakeApi({ generated: true });
    const user = userEvent.setup();
    renderApp();
    const subject = await screen.findByLabelText('Objet');
    await user.clear(subject);
    await user.type(subject, 'Nouvel objet');
    await user.click(screen.getByRole('button', { name: 'Valider la candidature' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/applications/a1/status')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      subject: 'Nouvel objet',
    });
    const patchIndex = calls.findIndex((c) => c.method === 'PATCH');
    const statusIndex = calls.findIndex((c) => c.path === '/applications/a1/status');
    expect(patchIndex).toBeLessThan(statusIndex);
  });

  it('bloque la validation tant qu’un repère entre crochets reste dans le texte', async () => {
    fakeApi({ generated: true });
    const user = userEvent.setup();
    renderApp();
    const body = await screen.findByLabelText('Corps du mail');
    await user.click(body);
    await user.paste(' [À COMPLÉTER : fait précis]');
    expect(screen.getByText(/repère entre crochets/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Valider la candidature' })).toBeDisabled();
  });

  it('rejette une candidature', async () => {
    const calls = fakeApi({ generated: true });
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Rejeter' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/applications/a1/status',
        body: { status: 'WITHDRAWN' },
      }),
    );
  });
});
