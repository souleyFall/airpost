import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../api/client';
import { AddOfferPanel } from './AddOfferPanel';

const TEXT =
  'Alternance - Développeur Full Stack (H/F)\nAtelier Exemple · Paris\nNous recherchons un alternant pour notre équipe produit. Candidature : rh@exemple.test';

function fakeApi(options: { extractStatus?: number; created?: boolean; analyzed?: boolean } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/api/, '');
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      calls.push({ method, path, body });
      if (path === '/offers/manual/extract') {
        return options.extractStatus
          ? json({ message: 'refus' }, options.extractStatus)
          : json({
              title: 'Alternance - Développeur Full Stack (H/F)',
              company: 'Atelier Exemple',
              city: 'Paris',
              contactEmail: 'rh@exemple.test',
            });
      }
      if (path === '/offers/manual') {
        return json({
          id: 'nouvelle',
          created: options.created ?? true,
          analyzed: options.analyzed ?? true,
        });
      }
      return json({}, 404);
    }),
  );
  setCsrfToken('csrf');
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

function setup() {
  const onAdded = vi.fn();
  const onCancel = vi.fn();
  render(<AddOfferPanel onAdded={onAdded} onCancel={onCancel} />);
  return { onAdded, onCancel, user: userEvent.setup() };
}

describe('AddOfferPanel', () => {
  it('lit le texte collé, propose les champs, puis ajoute l’offre avec le lien, sans le visiter', async () => {
    const calls = fakeApi();
    const { onAdded, user } = setup();

    await user.click(screen.getByLabelText('Texte de l’annonce'));
    await user.paste(TEXT);
    await user.type(
      screen.getByLabelText('Lien de l’annonce (facultatif)'),
      'https://www.linkedin.com/jobs/view/1/',
    );
    await user.click(screen.getByRole('button', { name: 'Lire l’annonce' }));

    expect(await screen.findByLabelText('Intitulé du poste')).toHaveValue(
      'Alternance - Développeur Full Stack (H/F)',
    );
    expect(screen.getByLabelText('Entreprise')).toHaveValue('Atelier Exemple');
    expect(screen.getByLabelText('Ville (facultatif)')).toHaveValue('Paris');
    expect(screen.getByLabelText('E-mail de contact (facultatif)')).toHaveValue('rh@exemple.test');

    await user.clear(screen.getByLabelText('Ville (facultatif)'));
    await user.type(screen.getByLabelText('Ville (facultatif)'), 'Boulogne-Billancourt');
    await user.click(screen.getByRole('button', { name: 'Ajouter l’offre' }));

    await waitFor(() =>
      expect(onAdded).toHaveBeenCalledWith('nouvelle', 'Offre ajoutée et analysée.'),
    );
    expect(calls.find((c) => c.path === '/offers/manual')?.body).toEqual({
      text: TEXT,
      title: 'Alternance - Développeur Full Stack (H/F)',
      company: 'Atelier Exemple',
      city: 'Boulogne-Billancourt',
      contactEmail: 'rh@exemple.test',
      applyUrl: 'https://www.linkedin.com/jobs/view/1/',
    });
    // Seules les deux routes d'airpost sont appelées : jamais le lien de l'annonce.
    expect(calls.map((c) => c.path)).toEqual(['/offers/manual/extract', '/offers/manual']);
  });

  it('n’accepte pas un texte trop court', async () => {
    fakeApi();
    const { user } = setup();

    await user.type(screen.getByLabelText('Texte de l’annonce'), 'Trop court');

    expect(screen.getByRole('button', { name: 'Lire l’annonce' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remplir moi-même' })).toBeDisabled();
    expect(screen.getByText(/80 caractères au moins/)).toBeInTheDocument();
  });

  it('quota du modèle atteint : passe aux champs vides, à remplir soi-même', async () => {
    fakeApi({ extractStatus: 429 });
    const { user } = setup();

    await user.click(screen.getByLabelText('Texte de l’annonce'));
    await user.paste(TEXT);
    await user.click(screen.getByRole('button', { name: 'Lire l’annonce' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Quota du modèle atteint/);
    expect(screen.getByLabelText('Intitulé du poste')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Ajouter l’offre' })).toBeDisabled();
  });

  it('« Remplir moi-même » saute la lecture automatique (aucune requête au modèle)', async () => {
    const calls = fakeApi();
    const { onAdded, user } = setup();

    await user.click(screen.getByLabelText('Texte de l’annonce'));
    await user.paste(TEXT);
    await user.click(screen.getByRole('button', { name: 'Remplir moi-même' }));
    await user.type(screen.getByLabelText('Intitulé du poste'), 'Développeur');
    await user.type(screen.getByLabelText('Entreprise'), 'Atelier Exemple');
    await user.click(screen.getByRole('button', { name: 'Ajouter l’offre' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(calls.some((c) => c.path === '/offers/manual/extract')).toBe(false);
    expect(calls.find((c) => c.path === '/offers/manual')?.body).toMatchObject({
      city: null,
      contactEmail: null,
      applyUrl: null,
    });
  });

  it('annonce déjà en base : le dit et l’ouvre', async () => {
    fakeApi({ created: false, analyzed: false });
    const { onAdded, user } = setup();

    await user.click(screen.getByLabelText('Texte de l’annonce'));
    await user.paste(TEXT);
    await user.click(screen.getByRole('button', { name: 'Lire l’annonce' }));
    await user.click(await screen.findByRole('button', { name: 'Ajouter l’offre' }));

    await waitFor(() =>
      expect(onAdded).toHaveBeenCalledWith(
        'nouvelle',
        'Cette offre était déjà dans ta liste : la voici.',
      ),
    );
  });

  it('annuler ne crée rien', async () => {
    const calls = fakeApi();
    const { onCancel, user } = setup();

    await user.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(onCancel).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});
