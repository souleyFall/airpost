import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../App';
import { setCsrfToken } from '../../api/client';
import type { Analysis } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { NO_FILTERS, PAGE_SIZE, activeFilterCount, buildQuery } from './ReviewPage';

const ANALYSIS: Analysis = {
  verdict: 'excellent',
  summary: 'React et TypeScript demandés, trajet court.',
  disqualifier: null,
  strengths: ['React demandé, présent dans ton profil'],
  gaps: ['Kubernetes demandé'],
  brief: {
    company: 'Éditeur de logiciels pour les notaires.',
    stack: ['React', 'NestJS'],
    wantedProfile: 'Étudiant en Master, première expérience.',
    rhythm: '3 semaines / 1 semaine',
  },
};

const EMPTY_BRIEF_ANALYSIS: Analysis = {
  ...ANALYSIS,
  brief: { company: null, stack: [], wantedProfile: null, rhythm: null },
};

const now = new Date().toISOString();
const offer = (
  id: string,
  title: string,
  score: number | null,
  application: { id: string; status: string } | null = null,
  extra: Record<string, unknown> = {},
) => ({
  id,
  source: 'LBA',
  title,
  company: 'Atelier Pivot',
  city: 'Élancourt',
  postcode: '78990',
  channel: id === 'o2' ? 'SITE' : 'EMAIL',
  contractType: 'ALTERNANCE',
  distanceKm: 12.4,
  applyUrl: 'https://exemple.test/offre',
  publishedAt: now,
  firstSeenAt: now,
  score,
  application,
  ...extra,
});

const LETTER_BODY = Array.from({ length: 130 }, (_, i) => `mot${i}`).join(' ');

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

interface Options {
  generated?: boolean;
  /** Offres de la liste (par défaut : o1 et o2). */
  catalogue?: ReturnType<typeof offer>[];
  /** Analyse déjà faite sur le détail ? Sinon l'ouverture déclenche une analyse. */
  analyzed?: boolean;
  analyzeStatus?: number;
  /** Analyse dont le brief ne contient rien (annonce sans information). */
  emptyBrief?: boolean;
  /** La liste renvoie des offres sans note (jamais analysées). */
  unscored?: boolean;
  /** Offres que l'IA écarte quand on les analyse. */
  disqualify?: string[];
}

/** Fausse API avec un petit état : la lettre n'existe qu'après génération ; la liste honore limit/offset/source. */
function fakeApi(options: Options = {}) {
  const calls: Call[] = [];
  let hasLetter = options.generated ?? false;
  let status = 'TO_REVIEW';
  let analyzed = options.analyzed ?? true;
  // Notes de la liste : absentes tant que l'analyse des offres affichées n'a pas eu lieu (option unscored).
  let scored = !options.unscored;
  const hidden = new Set<string>();
  const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
  const appRef = () => (hasLetter ? { id: 'a1', status } : null);
  const catalogue = () =>
    options.catalogue ?? [
      offer('o1', 'Alternance full stack', 91, appRef()),
      offer('o2', 'Dev React', 80, null, { source: 'ADZUNA', contractType: 'STAGE' }),
    ];
  const detail = (id: string) => {
    const base = catalogue().find((o) => o.id === id) ?? offer(id, id, 70);
    return {
      ...base,
      score: analyzed ? base.score : null,
      description: 'Texte intégral de l’annonce',
      contactEmail: id === 'o1' ? 'rh@exemple.test' : null,
      analysis: analyzed ? (options.emptyBrief ? EMPTY_BRIEF_ANALYSIS : ANALYSIS) : null,
      analyzedAt: analyzed ? now : null,
      excluded: hidden.has(id),
    };
  };

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
        const params = new URL(path, 'http://x').searchParams;
        const visible = catalogue()
          .filter((o) => !hidden.has(o.id))
          .filter(
            (o) => o.application?.status !== 'WITHDRAWN' && o.application?.status !== 'VALIDATED',
          )
          .filter(
            (o) => !params.get('source') || params.get('source')?.split(',').includes(o.source),
          )
          .filter((o) => !params.get('channel') || o.channel === params.get('channel'))
          .filter((o) => !params.get('q') || o.title.toLowerCase().includes(params.get('q') ?? ''));
        const limit = Number(params.get('limit'));
        const offset = Number(params.get('offset'));
        return json({
          total: visible.length,
          limit,
          offset,
          items: visible
            .slice(offset, offset + limit)
            .map((o) => (scored ? o : { ...o, score: null })),
        });
      }
      if (path === '/offers/analyze' && method === 'POST') {
        const ids = (body as { ids: string[] }).ids;
        if (options.analyzeStatus) return json({ message: 'Quota' }, options.analyzeStatus);
        scored = true;
        for (const id of ids) if (options.disqualify?.includes(id)) hidden.add(id);
        return json({
          analyzed: ids.length,
          pendingBatch: ids.length,
          items: ids.map((id) => ({
            id,
            score: catalogue().find((o) => o.id === id)?.score ?? null,
            excluded: hidden.has(id),
          })),
        });
      }
      if (/^\/offers\/o\d+\/analyze/.test(path) && method === 'POST') {
        if (options.analyzeStatus) return json({ message: 'Quota' }, options.analyzeStatus);
        analyzed = true;
        return json(detail(path.split('/')[2] ?? 'o1'));
      }
      if (/^\/offers\/[\w-]+$/.test(path)) return json(detail(path.split('/')[2] ?? 'o1'));
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

/** Marge pour les tests qui attendent l'analyse automatique différée (400 ms) sur une machine chargée. */
const SLOW = { timeout: 4000 };

const getList = () =>
  within(screen.getByRole('region', { name: 'Offres à valider' })).getByRole('list');
/** La liste des offres (et non les listes du brief : pile technique, points forts). */
const findList = async () =>
  within(await screen.findByRole('region', { name: 'Offres à valider' })).findByRole('list');
afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('requête de la liste', () => {
  it('ne demande que les offres à traiter, une page à la fois', () => {
    expect(buildQuery(NO_FILTERS, 0)).toBe(
      `/offers?pending=true&limit=${PAGE_SIZE}&offset=0&sort=score`,
    );
    expect(buildQuery(NO_FILTERS, 2)).toContain(`offset=${2 * PAGE_SIZE}`);
  });

  it('transmet chaque filtre actif, et seulement ceux-là', () => {
    const query = buildQuery(
      {
        q: '  react  ',
        sources: ['LBA', 'ADZUNA'],
        contracts: ['STAGE', 'CDI'],
        channel: 'EMAIL',
        minScore: 55,
        maxDistanceKm: 30,
        sort: 'distance',
      },
      0,
    );
    const params = new URL(query, 'http://x').searchParams;
    expect(params.get('q')).toBe('react');
    expect(params.get('source')).toBe('LBA,ADZUNA');
    expect(params.get('contract')).toBe('STAGE,CDI');
    expect(params.get('channel')).toBe('EMAIL');
    expect(params.get('minScore')).toBe('55');
    expect(params.get('maxDistanceKm')).toBe('30');
    expect(params.get('sort')).toBe('distance');
    expect(new URL(buildQuery(NO_FILTERS, 0), 'http://x').searchParams.has('source')).toBe(false);
  });

  it('compte les filtres actifs (hors recherche et tri)', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(
      activeFilterCount({ ...NO_FILTERS, sources: ['LBA'], minScore: 55, q: 'x', sort: 'fresh' }),
    ).toBe(2);
  });
});

describe('écran À valider', () => {
  it('liste les offres classées avec compatibilité, contrat, distance et état de la lettre', async () => {
    fakeApi();
    renderApp();
    const list = await findList();
    const rows = within(list).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('Alternance full stack');
    expect(rows[0]).toHaveTextContent('91');
    expect(rows[0]).toHaveTextContent('12 km');
    expect(rows[0]).toHaveTextContent('Alternance');
    expect(rows[0]).toHaveTextContent('Sans lettre');
    expect(rows[1]).toHaveTextContent('Dev React');
    expect(rows[1]).toHaveTextContent('Stage');
    expect(await screen.findByText(/Compatibilité 91 \/ 100/, {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Pas encore de lettre')).toBeInTheDocument();
  });

  it('affiche le brief : entreprise, stack demandée, profil recherché, rythme, points forts et manques', async () => {
    fakeApi();
    renderApp();
    const brief = await screen.findByRole('region', { name: 'Brief de l’offre' });
    expect(within(brief).getByText('Excellente piste', { exact: false })).toBeInTheDocument();
    expect(within(brief).getByText('Éditeur de logiciels pour les notaires.')).toBeInTheDocument();
    expect(within(brief).getByText('Étudiant en Master, première expérience.')).toBeInTheDocument();
    expect(within(brief).getByText('3 semaines / 1 semaine')).toBeInTheDocument();
    const stack = within(brief).getByText('NestJS');
    expect(stack.tagName).toBe('LI');
    expect(within(brief).getByText('React demandé, présent dans ton profil')).toBeInTheDocument();
    expect(within(brief).getByText('Kubernetes demandé')).toBeInTheDocument();
  });

  it('dit « non précisé » quand l’annonce ne donne ni entreprise, ni stack, ni profil', async () => {
    fakeApi({ emptyBrief: true });
    renderApp();
    const brief = await screen.findByRole('region', { name: 'Brief de l’offre' });
    expect(within(brief).getAllByText(/Non précisée?/)).toHaveLength(4);
  });

  it('analyse automatiquement une offre jamais analysée à son ouverture, et met la liste à jour', async () => {
    const calls = fakeApi({ analyzed: false });
    renderApp();
    expect(await screen.findByText(/Compatibilité 91 \/ 100/, {}, SLOW)).toBeInTheDocument();
    expect(
      calls.filter((c) => c.method === 'POST' && c.path === '/offers/o1/analyze'),
    ).toHaveLength(1);
    expect(within(getList()).getAllByRole('button')[0]).toHaveTextContent('91');
  });

  it('n’analyse pas les offres qu’on ne fait que traverser aux flèches du clavier', async () => {
    const calls = fakeApi({ analyzed: false });
    const user = userEvent.setup();
    renderApp();
    await findList();
    // Le détail de la première offre est affiché (son analyse différée est programmée) avant de la quitter.
    await screen.findByRole('heading', { name: 'Alternance full stack' });
    await user.keyboard('{ArrowDown}');
    expect(await screen.findByText(/Compatibilité 80 \/ 100/, {}, SLOW)).toBeInTheDocument();
    const analyses = calls.filter((c) => c.method === 'POST' && c.path.includes('/analyze'));
    expect(analyses.map((c) => c.path)).toEqual(['/offers/o2/analyze']);
  });
  it('analyse dès l’affichage les offres de la liste qui n’ont pas de note, sans ouvrir le détail', async () => {
    const calls = fakeApi({ unscored: true });
    renderApp();
    const list = await findList();
    await waitFor(() => expect(within(list).getAllByRole('button')[0]).toHaveTextContent('91'));
    const analyses = calls.filter((c) => c.method === 'POST' && c.path === '/offers/analyze');
    expect(analyses).toHaveLength(1);
    expect(analyses[0]?.body).toEqual({ ids: ['o1', 'o2'] });
    // La liste est rechargée pour que le tri tienne compte des notes, sans redemander l’analyse.
    await waitFor(() =>
      expect(
        calls.filter((c) => c.path.startsWith('/offers?') && c.path.includes('limit=20')).length,
      ).toBeGreaterThan(1),
    );
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/offers/analyze')).toHaveLength(
      1,
    );
  });

  it('les offres que l’IA écarte quittent le fil dès l’analyse', async () => {
    fakeApi({ unscored: true, disqualify: ['o2'] });
    renderApp();
    const list = await findList();
    await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(1));
    expect(within(list).getByRole('button')).toHaveTextContent('Alternance full stack');
    expect(screen.queryByText('Dev React')).not.toBeInTheDocument();
  });

  it('un quota atteint pendant l’analyse de la liste ne bloque pas l’écran et ne boucle pas', async () => {
    const calls = fakeApi({ unscored: true, analyzeStatus: 429 });
    renderApp();
    const list = await findList();
    expect(within(list).getAllByRole('button')[0]).toHaveTextContent('–');
    await waitFor(() => expect(screen.queryByText(/analyse IA en cours/)).not.toBeInTheDocument());
    expect(calls.filter((c) => c.path === '/offers/analyze')).toHaveLength(1);
  });

  it('indique l’échec de l’analyse (quota) et permet de réessayer', async () => {
    fakeApi({ analyzed: false, analyzeStatus: 429 });
    renderApp();
    expect(await screen.findByText(/Quota du modèle atteint/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyser' })).toBeEnabled();
    // La lettre reste générable malgré l'échec de l'analyse.
    expect(screen.getByRole('button', { name: 'Générer la lettre' })).toBeEnabled();
  });

  it('réanalyse à la demande', async () => {
    const calls = fakeApi();
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Réanalyser' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/offers/o1/analyze?force=true')).toBe(true),
    );
  });

  it('montre le texte de l’annonce à la demande', async () => {
    fakeApi();
    renderApp();
    expect(await screen.findByText('Texte de l’annonce')).toBeInTheDocument();
    expect(screen.getByText('Texte intégral de l’annonce')).toBeInTheDocument();
  });

  it('liste et détail défilent séparément : chacun a son propre conteneur à défilement', async () => {
    fakeApi();
    renderApp();
    const list = await findList();
    const listScroller = list.closest('[class*="overflow-y-auto"]');
    const detailScroller = (await screen.findByRole('region', { name: 'Détail de l’offre' }))
      .parentElement;
    expect(listScroller).not.toBeNull();
    expect(detailScroller?.className).toContain('overflow-y-auto');
    expect(listScroller).not.toBe(detailScroller);
    // Ni l'un ni l'autre ne contient l'autre : descendre dans la liste ne déplace pas le détail.
    expect(listScroller?.contains(detailScroller)).toBe(false);
    expect(detailScroller?.contains(listScroller)).toBe(false);
  });

  it('ramène le détail en haut quand on change d’offre', async () => {
    fakeApi();
    const user = userEvent.setup();
    renderApp();
    const detail = (await screen.findByRole('region', { name: 'Détail de l’offre' }))
      .parentElement as HTMLElement;
    detail.scrollTop = 300;
    await user.click(within(getList()).getAllByRole('button')[1]);
    await waitFor(() => expect(detail.scrollTop).toBe(0));
  });

  describe('filtres, recherche, tri', () => {
    it('filtre par canal côté serveur', async () => {
      const calls = fakeApi();
      const user = userEvent.setup();
      renderApp();
      await findList();
      await user.click(screen.getByRole('button', { name: /^Filtres/ }));
      await user.click(
        within(screen.getByRole('group', { name: 'Canal' })).getByRole('button', { name: 'Site' }),
      );
      await waitFor(() => {
        const rows = within(getList()).getAllByRole('button');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveTextContent('Dev React');
      });
      expect(calls.some((c) => c.path.includes('channel=SITE'))).toBe(true);
      expect(screen.getByRole('button', { name: 'Filtres (1)' })).toBeInTheDocument();
    });

    it('filtre par source, avec plusieurs sources possibles', async () => {
      const calls = fakeApi();
      const user = userEvent.setup();
      renderApp();
      await findList();
      await user.click(screen.getByRole('button', { name: /^Filtres/ }));
      const sources = screen.getByRole('group', { name: 'Source' });
      await user.click(within(sources).getByRole('button', { name: 'Adzuna' }));
      await waitFor(() => expect(calls.some((c) => c.path.includes('source=ADZUNA'))).toBe(true));
      await user.click(within(sources).getByRole('button', { name: 'La Bonne Alternance' }));
      await waitFor(() =>
        expect(calls.some((c) => decodeURIComponent(c.path).includes('source=ADZUNA,LBA'))).toBe(
          true,
        ),
      );
    });

    it('filtre par contrat, compatibilité minimale et distance', async () => {
      const calls = fakeApi();
      const user = userEvent.setup();
      renderApp();
      await findList();
      await user.click(screen.getByRole('button', { name: /^Filtres/ }));
      await user.click(
        within(screen.getByRole('group', { name: 'Contrat' })).getByRole('button', {
          name: 'Stage',
        }),
      );
      await user.selectOptions(screen.getByLabelText('Compatibilité minimale'), '75');
      await user.selectOptions(screen.getByLabelText('Distance maximale'), '30');
      await waitFor(() => {
        const last = calls.filter((c) => c.path.startsWith('/offers?')).at(-1)?.path ?? '';
        expect(last).toContain('contract=STAGE');
        expect(last).toContain('minScore=75');
        expect(last).toContain('maxDistanceKm=30');
      });
    });

    it('les candidatures spontanées ont leur propre filtre de contrat', async () => {
      const calls = fakeApi();
      const user = userEvent.setup();
      renderApp();
      await findList();
      await user.click(screen.getByRole('button', { name: /^Filtres/ }));
      await user.click(
        within(screen.getByRole('group', { name: 'Contrat' })).getByRole('button', {
          name: 'Spontanée',
        }),
      );
      await waitFor(() =>
        expect(calls.filter((c) => c.path.startsWith('/offers?')).at(-1)?.path).toContain(
          'contract=SPONTANEE',
        ),
      );
    });

    it('trie par fraîcheur ou par distance', async () => {
      const calls = fakeApi();
      const user = userEvent.setup();
      renderApp();
      await findList();
      await user.selectOptions(screen.getByLabelText('Tri'), 'distance');
      await waitFor(() => expect(calls.some((c) => c.path.includes('sort=distance'))).toBe(true));
      await user.selectOptions(screen.getByLabelText('Tri'), 'fresh');
      await waitFor(() => expect(calls.some((c) => c.path.includes('sort=fresh'))).toBe(true));
    });

    it('recherche après la frappe, sans interroger l’API à chaque lettre', async () => {
      const calls = fakeApi();
      const user = userEvent.setup();
      renderApp();
      await findList();
      const before = calls.filter(
        (c) => c.path.startsWith('/offers?') && c.path.includes('q='),
      ).length;
      await user.type(screen.getByLabelText('Rechercher une offre'), 'react');
      await waitFor(() => {
        const rows = within(getList()).getAllByRole('button');
        expect(rows).toHaveLength(1);
      });
      const searches = calls.filter((c) => c.path.startsWith('/offers?') && c.path.includes('q='));
      expect(searches.length - before).toBeLessThanOrEqual(2);
      expect(searches.at(-1)?.path).toContain('q=react');
    });

    it('propose de réinitialiser quand aucun résultat ne correspond', async () => {
      fakeApi();
      const user = userEvent.setup();
      renderApp();
      await findList();
      await user.type(screen.getByLabelText('Rechercher une offre'), 'zzz');
      expect(await screen.findByText('Aucune offre ne correspond.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'réinitialise-les' }));
      expect(await findList()).toBeInTheDocument();
      expect(screen.getByLabelText('Rechercher une offre')).toHaveValue('');
    });
  });

  describe('pagination', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, i) => offer(`o${i + 1}`, `Offre numéro ${i + 1}`, 90 - i));

    it('affiche une page à la fois et navigue entre les pages', async () => {
      const calls = fakeApi({ catalogue: many(PAGE_SIZE + 5) });
      const user = userEvent.setup();
      renderApp();
      const pager = await screen.findByRole('navigation', { name: 'Pagination' });
      await findList();
      expect(within(getList()).getAllByRole('button')).toHaveLength(PAGE_SIZE);
      expect(pager).toHaveTextContent(`1–${PAGE_SIZE} sur ${PAGE_SIZE + 5}`);
      expect(pager).toHaveTextContent('Page 1 sur 2');
      expect(within(pager).getByRole('button', { name: 'Précédent' })).toBeDisabled();

      await user.click(within(pager).getByRole('button', { name: 'Suivant' }));
      await waitFor(() => expect(within(getList()).getAllByRole('button')).toHaveLength(5));
      expect(calls.some((c) => c.path.includes(`offset=${PAGE_SIZE}`))).toBe(true);
      expect(pager).toHaveTextContent('Page 2 sur 2');
      expect(within(pager).getByRole('button', { name: 'Suivant' })).toBeDisabled();
      // La première offre de la nouvelle page est sélectionnée.
      expect(
        await screen.findByRole('heading', { name: `Offre numéro ${PAGE_SIZE + 1}` }),
      ).toBeInTheDocument();

      await user.click(within(pager).getByRole('button', { name: 'Précédent' }));
      await waitFor(() => expect(within(getList()).getAllByRole('button')).toHaveLength(PAGE_SIZE));
    });

    it('revient à la première page quand un filtre change', async () => {
      const calls = fakeApi({ catalogue: many(PAGE_SIZE + 5) });
      const user = userEvent.setup();
      renderApp();
      const pager = await screen.findByRole('navigation', { name: 'Pagination' });
      await user.click(within(pager).getByRole('button', { name: 'Suivant' }));
      await waitFor(() => expect(pager).toHaveTextContent('Page 2 sur 2'));
      await user.selectOptions(screen.getByLabelText('Tri'), 'fresh');
      await waitFor(() => expect(pager).toHaveTextContent('Page 1 sur'));
      expect(calls.filter((c) => c.path.includes('sort=fresh')).at(-1)?.path).toContain('offset=0');
    });

    it('une seule page : pas de navigation possible', async () => {
      fakeApi();
      renderApp();
      const pager = await screen.findByRole('navigation', { name: 'Pagination' });
      expect(pager).toHaveTextContent('Page 1 sur 1');
      expect(within(pager).getByRole('button', { name: 'Précédent' })).toBeDisabled();
      expect(within(pager).getByRole('button', { name: 'Suivant' })).toBeDisabled();
    });
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
    await waitFor(() => expect(within(getList()).getAllByRole('button')).toHaveLength(1));
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
