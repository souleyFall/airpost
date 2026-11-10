import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../App';
import { setCsrfToken } from '../../api/client';
import { AuthProvider } from '../../auth/AuthProvider';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const row = (
  id: string,
  status: string,
  title: string,
  appliedDays: number | null,
  followUp: string | null | undefined = undefined,
  followedUpDays: number | null = null,
) => ({
  id,
  status,
  // Règle du serveur : « à relancer » après 8 jours sans nouvelle ; ici le faux serveur la reproduit.
  followUp:
    followUp !== undefined
      ? followUp
      : status === 'APPLIED' && appliedDays !== null && appliedDays >= 8
        ? 'due'
        : null,
  followedUpAt: followedUpDays === null ? null : daysAgo(followedUpDays),
  subject: 'Objet',
  validatedAt: daysAgo(5),
  appliedAt: appliedDays === null ? null : daysAgo(appliedDays),
  createdAt: daysAgo(6),
  updatedAt: daysAgo(1),
  replies: [] as { id: string; kind: string; receivedAt: string; snippet: string }[],
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

function fakeApi(
  options: {
    draftDeleted?: boolean | null;
    extraRows?: ReturnType<typeof row>[];
    followUpStatus?: number;
    gmail?: boolean;
  } = {},
) {
  const draftDeleted = options.draftDeleted ?? null;
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let rows = [
    row('a', 'VALIDATED', 'Poste validé', null),
    row('b', 'APPLIED', 'Poste ancien', 20),
    row('c', 'APPLIED', 'Poste récent', 2),
    row('d', 'REJECTED', 'Poste refusé', 30),
    row('e', 'TO_REVIEW', 'Encore en relecture', null),
    ...(options.extraRows ?? []),
  ];
  const followUpText = {
    applicationId: 'b',
    subject: 'Relance : Objet',
    body: 'Madame, Monsieur, voici ma relance.',
    preview: 'Madame, Monsieur, voici ma relance.\n\nCordialement,\nCamille Exemple',
    warnings: [] as string[],
    to: 'rh@exemple.test',
  };
  const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/api/, '');
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      calls.push({ method, path, body });
      if (path === '/auth/me') return json({ login: 'souley.fall', csrfToken: 'csrf' });
      if (path === '/gmail/status') return json({ configured: options.gmail ?? true });
      const followUp = /^\/applications\/(\w+)\/follow-up(\/draft|\/done)?$/.exec(path);
      if (followUp && method === 'POST') {
        if (!followUp[2]) {
          return options.followUpStatus
            ? json({ message: 'refus' }, options.followUpStatus)
            : json({ ...followUpText, applicationId: followUp[1] });
        }
        rows = rows.map((r) =>
          r.id === followUp[1] ? { ...r, followUp: 'done', followedUpAt: daysAgo(0) } : r,
        );
        return json({ applicationId: followUp[1], draftId: 'd2', to: 'rh@exemple.test' });
      }
      if (path === '/gmail/sync' && method === 'POST') {
        rows = rows.map((r) =>
          r.id === 'c'
            ? {
                ...r,
                status: 'REJECTED',
                replies: [
                  {
                    id: 'r1',
                    kind: 'REJECTION',
                    receivedAt: daysAgo(0),
                    snippet: 'Nous ne donnons pas suite',
                  },
                ],
              }
            : r,
        );
        return json({
          checked: 2,
          newReplies: 1,
          statusChanges: 1,
          noResponse: 0,
          skipped: 0,
          finishedAt: daysAgo(0),
        });
      }
      if (path === '/gmail/sync') return json({}, 404);
      const reply = /^\/replies\/(\w+)$/.exec(path);
      if (reply && method === 'PATCH') {
        rows = rows.map((r) =>
          r.replies[0]?.id === reply[1]
            ? {
                ...r,
                status: 'APPLIED',
                replies: [{ ...r.replies[0], kind: (body as { kind: string }).kind }],
              }
            : r,
        );
        return json({});
      }
      const draft = /^\/applications\/(\w+)\/draft$/.exec(path);
      if (draft && method === 'POST') {
        rows = rows.map((r) => (r.id === draft[1] ? { ...r, status: 'DRAFT_CREATED' } : r));
        return json({ draftId: 'd1' });
      }
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
        return json({ gmailDraftDeleted: draftDeleted });
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

describe('relance des candidatures', () => {
  it('rédige la relance, laisse la modifier, puis crée le brouillon Gmail avec le texte modifié', async () => {
    const calls = fakeApi();
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Poste ancien');

    await user.click(screen.getByRole('button', { name: 'Préparer la relance' }));

    const panel = await screen.findByRole('region', { name: /Relance de Entreprise b/ });
    const message = await within(panel).findByLabelText('Message');
    expect(message).toHaveValue('Madame, Monsieur, voici ma relance.');
    expect(within(panel).getByLabelText('Objet')).toHaveValue('Relance : Objet');
    expect(within(panel).getByText('rh@exemple.test')).toBeInTheDocument();
    await user.type(message, ' Un mot de plus.');
    await user.click(within(panel).getByRole('button', { name: 'Créer le brouillon Gmail' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/applications/b/follow-up/draft',
        body: {
          subject: 'Relance : Objet',
          body: 'Madame, Monsieur, voici ma relance. Un mot de plus.',
        },
      }),
    );
    expect(
      await screen.findByText(/Brouillon de relance créé dans Gmail pour Entreprise b/),
    ).toBeInTheDocument();
    // La candidature est maintenant « relancée » : plus de bouton, une mention.
    expect(await screen.findByText(/Relancée le .* : on attend/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Préparer la relance' })).not.toBeInTheDocument();
  });

  it('copie le message complet avec la signature du serveur, texte modifié compris', async () => {
    fakeApi();
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Poste ancien');
    await user.click(screen.getByRole('button', { name: 'Préparer la relance' }));
    const panel = await screen.findByRole('region', { name: /Relance de Entreprise b/ });
    const message = await within(panel).findByLabelText('Message');
    await user.type(message, ' Ajout.');

    await user.click(within(panel).getByRole('button', { name: 'Copier' }));

    expect(await navigator.clipboard.readText()).toBe(
      'Relance : Objet\n\nMadame, Monsieur, voici ma relance. Ajout.\n\nCordialement,\nCamille Exemple',
    );
    expect(await within(panel).findByRole('button', { name: 'Copié' })).toBeInTheDocument();
  });

  it('sans Gmail, seule la copie est proposée (pas de brouillon)', async () => {
    fakeApi({ gmail: false });
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Poste ancien');
    await user.click(screen.getByRole('button', { name: 'Préparer la relance' }));
    const panel = await screen.findByRole('region', { name: /Relance de Entreprise b/ });
    await within(panel).findByLabelText('Message');

    expect(within(panel).queryByRole('button', { name: 'Créer le brouillon Gmail' })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Copier' })).toBeInTheDocument();
  });

  it('bloque le brouillon tant que le texte contient un repère entre crochets', async () => {
    fakeApi();
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Poste ancien');
    await user.click(screen.getByRole('button', { name: 'Préparer la relance' }));
    const panel = await screen.findByRole('region', { name: /Relance de Entreprise b/ });
    const message = await within(panel).findByLabelText('Message');

    // « [[ » est la façon d'écrire un « [ » littéral avec user-event.
    await user.type(message, ' Bonjour [[prénom].');

    expect(within(panel).getByRole('button', { name: 'Créer le brouillon Gmail' })).toBeDisabled();
    expect(within(panel).getByText(/repère entre crochets/)).toBeInTheDocument();
  });

  it('« j’ai déjà relancé autrement » note la relance sans brouillon', async () => {
    const calls = fakeApi();
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Poste ancien');
    await user.click(screen.getByRole('button', { name: 'Préparer la relance' }));
    const panel = await screen.findByRole('region', { name: /Relance de Entreprise b/ });
    await within(panel).findByLabelText('Message');

    await user.click(within(panel).getByRole('button', { name: 'J’ai déjà relancé autrement' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/applications/b/follow-up/done',
        body: undefined,
      }),
    );
    expect(
      await screen.findByText('Relance de Entreprise b notée comme faite.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/follow-up/draft'))).toBe(false);
  });

  it.each([
    [429, /Quota du modèle atteint/],
    [422, /garde-fous/],
    [503, /clé Gemini/],
    [409, /ne peut plus être relancée/],
  ])('explique l’échec de la rédaction (%i) et propose de réessayer', async (status, message) => {
    fakeApi({ followUpStatus: status });
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Poste ancien');

    await user.click(screen.getByRole('button', { name: 'Préparer la relance' }));

    const panel = await screen.findByRole('region', { name: /Relance de Entreprise b/ });
    expect(await within(panel).findByRole('alert')).toHaveTextContent(message);
    expect(within(panel).getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('une candidature relancée depuis assez longtemps propose de la classer sans suite', async () => {
    const calls = fakeApi({
      extraRows: [row('f', 'APPLIED', 'Poste silencieux', 30, 'give_up', 11)],
    });
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Poste silencieux');
    expect(screen.getByText(/toujours sans réponse/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Classer sans suite' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/applications/f/status',
        body: { status: 'NO_RESPONSE' },
      }),
    );
  });

  it('une candidature envoyée depuis peu indique quand la relance sera possible', async () => {
    fakeApi();
    renderApp();
    await screen.findByText('Poste récent');

    expect(screen.getByText(/Relance possible après 8 jours/)).toBeInTheDocument();
  });

  it('une candidature déjà relancée n’offre plus de relance', async () => {
    fakeApi({ extraRows: [row('g', 'APPLIED', 'Poste relancé', 12, 'done', 2)] });
    renderApp();
    await screen.findByText('Poste relancé');

    expect(screen.getByText(/Relancée le .* : on attend/)).toBeInTheDocument();
    // Seule « Poste ancien » (b) reste à relancer.
    expect(screen.getAllByRole('button', { name: 'Préparer la relance' })).toHaveLength(1);
  });
});

describe('écran Suivi', () => {
  it('liste les candidatures suivies, sans celles encore en relecture', async () => {
    fakeApi();
    renderApp();
    expect(await screen.findByText('Poste validé')).toBeInTheDocument();
    expect(screen.queryByText('Encore en relecture')).not.toBeInTheDocument();
    expect(screen.getByText(/4\s+candidatures/)).toBeInTheDocument();
  });

  it('signale « à relancer » après 8 jours et filtre', async () => {
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
  it('crée le brouillon Gmail d’une candidature validée par e-mail', async () => {
    const calls = fakeApi();
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Créer le brouillon Gmail' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/applications/a/draft',
        body: undefined,
      }),
    );
    expect(
      await screen.findByRole('link', { name: /Ouvrir le brouillon dans Gmail/ }),
    ).toBeInTheDocument();
  });

  it('prévient quand le brouillon Gmail n’a pas pu être supprimé avec la candidature', async () => {
    fakeApi({ draftDeleted: false });
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Poste validé');
    await user.click(screen.getAllByRole('button', { name: 'Supprimer' })[0]);
    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
    expect(
      await screen.findByText(/brouillon n’a pas pu être retiré de Gmail/),
    ).toBeInTheDocument();
  });
  it('synchronise Gmail, affiche le dernier mail et permet de corriger sa catégorie', async () => {
    const calls = fakeApi();
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Synchroniser' }));
    expect(await screen.findByText('1 nouvelle réponse.')).toBeInTheDocument();
    expect(await screen.findByText(/Nous ne donnons pas suite/)).toBeInTheDocument();
    expect(screen.getAllByText('Refus').length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText(/Catégorie du dernier mail/), 'Autre');
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/replies/r1',
        body: { kind: 'OTHER' },
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/Catégorie du dernier mail/)).toHaveValue('OTHER'),
    );
  });
});
