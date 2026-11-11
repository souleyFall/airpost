import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Parcours de la version démo, complète : l'application s'affiche avec ses fausses données et marche sans jamais
 * toucher au réseau. `IS_DEMO` est figé à l'import du client d'API : on déclare le mode AVANT d'importer l'application.
 */
async function startDemo() {
  vi.stubEnv('MODE', 'demo');
  vi.resetModules();
  const fetchSpy = vi.fn(() => {
    throw new Error('requête réseau interdite dans la démo');
  });
  vi.stubGlobal('fetch', fetchSpy);
  const { setDemoDelayScale, resetDemo } = await import('./demoApi');
  setDemoDelayScale(0);
  resetDemo();
  window.location.hash = '#/';
  const { App } = await import('../App');
  render(<App />);
  return { fetchSpy, user: userEvent.setup() };
}

beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('application en mode démo', () => {
  it('s’ouvre déjà connectée, avec les fausses offres, l’encart « Démo » et aucune requête réseau', async () => {
    const { fetchSpy } = await startDemo();

    expect(
      await screen.findByText('Alternance Développeur Full Stack TypeScript'),
    ).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/Démo : données fictives, aucun serveur/);
    expect(screen.getByText('Connecté : démo')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('génère une lettre, la valide, la retrouve dans le suivi, et la page Résultats suit', async () => {
    const { fetchSpy, user } = await startDemo();
    await user.click(await screen.findByText('Alternance Développeur Full Stack TypeScript'));

    await user.click(await screen.findByRole('button', { name: 'Générer la lettre' }));
    const letter = await screen.findByLabelText('Corps du mail');
    expect((letter as HTMLTextAreaElement).value).toContain('Atelier Nova');
    await user.click(screen.getByRole('button', { name: 'Valider la candidature' }));

    await user.click(screen.getByRole('link', { name: /^Suivi/ }));
    expect(
      await screen.findByText('Alternance Développeur Full Stack TypeScript'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Préparer la relance' }).length).toBeGreaterThan(
      0,
    );

    await user.click(screen.getByRole('link', { name: /Résultats/ }));
    const funnel = await screen.findByRole('region', { name: 'Candidatures envoyées' });
    // 7 candidatures déjà envoyées au départ ; la lettre validée n'est pas encore « envoyée ».
    expect(within(funnel).getByText('Envoyées').nextElementSibling).toHaveTextContent('7');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('prépare une relance et la copie, sans réseau', async () => {
    const { fetchSpy, user } = await startDemo();
    await user.click(await screen.findByRole('link', { name: /^Suivi/ }));
    const buttons = await screen.findAllByRole('button', { name: 'Préparer la relance' });

    await user.click(buttons[0] as HTMLElement);

    const panel = await screen.findByRole('region', { name: /^Relance de / });
    const message = (await within(panel).findByLabelText('Message')) as HTMLTextAreaElement;
    expect(message.value).toContain('Il y a quelques jours');
    await user.click(within(panel).getByRole('button', { name: 'Copier' }));
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Copié' })).toBeInTheDocument(),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('la collecte fait arriver de nouvelles offres et affiche leur nombre', async () => {
    const { fetchSpy, user } = await startDemo();
    await screen.findByText('Alternance Développeur Full Stack TypeScript');

    await user.click(screen.getByRole('button', { name: 'Lancer la collecte' }));

    expect(await screen.findByText(/nouvelles offres/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
