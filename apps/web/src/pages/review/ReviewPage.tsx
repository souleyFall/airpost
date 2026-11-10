import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type {
  ApplyChannel,
  ContractType,
  OfferList,
  OfferSource,
  OfferSummary,
} from '../../api/types';
import { useShell } from '../../components/shellContext';
import { CONTRACT_LABEL, distanceLabel, place, scoreTone, shortAge } from '../../lib/format';
import { OfferDetail } from './OfferDetail';

export const PAGE_SIZE = 20;

export type Sort = 'score' | 'fresh' | 'distance';

export interface Filters {
  q: string;
  sources: OfferSource[];
  contracts: ContractType[];
  channel: 'ALL' | ApplyChannel;
  minScore: number;
  maxDistanceKm: number | null;
  sort: Sort;
}

export const NO_FILTERS: Filters = {
  q: '',
  sources: [],
  contracts: [],
  channel: 'ALL',
  minScore: 0,
  maxDistanceKm: null,
  sort: 'score',
};

/** Nombre de filtres actifs (le tri et la recherche ne comptent pas : ils sont toujours visibles). */
export function activeFilterCount(filters: Filters): number {
  return (
    (filters.sources.length > 0 ? 1 : 0) +
    (filters.contracts.length > 0 ? 1 : 0) +
    (filters.channel !== 'ALL' ? 1 : 0) +
    (filters.minScore > 0 ? 1 : 0) +
    (filters.maxDistanceKm !== null ? 1 : 0)
  );
}

/** Requête envoyée à l'API : seules les offres à traiter, filtrées, triées, une page à la fois. */
export function buildQuery(filters: Filters, page: number): string {
  const params = new URLSearchParams({
    pending: 'true',
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
    sort: filters.sort,
  });
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.sources.length > 0) params.set('source', filters.sources.join(','));
  if (filters.contracts.length > 0) params.set('contract', filters.contracts.join(','));
  if (filters.channel !== 'ALL') params.set('channel', filters.channel);
  if (filters.minScore > 0) params.set('minScore', String(filters.minScore));
  if (filters.maxDistanceKm !== null) params.set('maxDistanceKm', String(filters.maxDistanceKm));
  return `/offers?${params.toString()}`;
}

const TONE_CLASS = {
  high: 'border-ink bg-ink text-paper',
  mid: 'border-ink bg-transparent text-ink',
  low: 'border-line-strong bg-transparent text-muted',
} as const;

const SOURCE_CHOICES: { id: OfferSource; label: string }[] = [
  { id: 'LBA', label: 'La Bonne Alternance' },
  { id: 'ADZUNA', label: 'Adzuna' },
  { id: 'GOOGLE_JOBS', label: 'Google Jobs' },
  { id: 'GLASSDOOR', label: 'Glassdoor' },
  { id: 'LBB', label: 'La Bonne Boîte' },
];

const CONTRACT_CHOICES: ContractType[] = [
  'ALTERNANCE',
  'STAGE',
  'CDI',
  'CDD',
  'SPONTANEE',
  'AUTRE',
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-[13px] font-medium ${
        pressed
          ? 'border-ink bg-ink text-paper'
          : 'border-line-strong bg-transparent text-ink hover:bg-hover'
      }`}
    >
      {children}
    </button>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function ReviewPage() {
  const { version, setCount } = useShell();
  const [items, setItems] = useState<OfferSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analyzingCount, setAnalyzingCount] = useState(0);
  // Offres déjà soumises à l'analyse : un échec (quota) ne doit pas relancer la demande en boucle.
  const attempted = useRef(new Set<string>());
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  // Une réponse tardive d'une requête périmée (filtre changé entre-temps) ne doit pas écraser la bonne.
  const requestId = useRef(0);

  const query = buildQuery(filters, page);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const list = await api<OfferList>('GET', query);
      if (id !== requestId.current) return;
      setItems(list.items);
      setTotal(list.total);
      setError(null);
    } catch {
      if (id !== requestId.current) return;
      setError('Impossible de charger les offres. Vérifie que le serveur est démarré.');
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load, version]);

  // Badge de la barre latérale : toutes les offres à traiter, quels que soient les filtres.
  const refreshBadge = useCallback(async () => {
    try {
      const all = await api<OfferList>('GET', '/offers?pending=true&limit=1');
      setCount('review', all.total);
    } catch {
      setCount('review', null);
    }
  }, [setCount]);

  useEffect(() => {
    void refreshBadge();
  }, [refreshBadge, version]);

  // Dès que des offres sans note s'affichent, l'IA les analyse (pas besoin d'ouvrir le détail).
  useEffect(() => {
    if (!items) return;
    const ids = items
      .filter((o) => o.score === null && !attempted.current.has(o.id))
      .map((o) => o.id);
    if (ids.length === 0) return;
    for (const id of ids) attempted.current.add(id);
    setAnalyzingCount((count) => count + ids.length);
    void (async () => {
      try {
        const result = await api<{
          analyzed: number;
          items: { id: string; score: number | null }[];
        }>('POST', '/offers/analyze', { ids });
        const scores = new Map(result.items.map((o) => [o.id, o.score]));
        setItems((current) =>
          current
            ? current.map((o) => (scores.has(o.id) ? { ...o, score: scores.get(o.id) ?? null } : o))
            : current,
        );
        // Nouvelles notes (tri par compatibilité) et offres écartées par l'IA, qui quittent le fil.
        if (result.analyzed > 0) {
          void load();
          void refreshBadge();
        }
      } catch {
        // Quota ou service indisponible : les offres restent sans note, l'ouverture du détail réessaiera.
      } finally {
        setAnalyzingCount((count) => Math.max(0, count - ids.length));
      }
    })();
  }, [items, load, refreshBadge]);

  // Recherche : on attend la fin de la frappe avant d'interroger l'API.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => (current.q === searchText ? current : { ...current, q: searchText }));
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  function changeFilters(change: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...change }));
    setPage(0);
  }

  function reset() {
    setSearchText('');
    setFilters(NO_FILTERS);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Une page devenue vide (offres validées) : retour à la dernière page existante.
  useEffect(() => {
    if (items !== null && items.length === 0 && page > 0 && page >= pageCount) {
      setPage(pageCount - 1);
    }
  }, [items, page, pageCount]);

  // Sélection par défaut : la première offre de la page ; si l'offre sélectionnée disparaît, la première.
  useEffect(() => {
    if (items === null) return;
    if (items.length === 0) {
      setSelectedId(null);
    } else if (!items.some((o) => o.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [items, selectedId]);

  // Changer d'offre : le détail repart du haut, et la ligne choisie reste visible dans SA liste.
  useEffect(() => {
    if (detailRef.current) detailRef.current.scrollTop = 0;
    const row = listRef.current?.querySelector('[aria-current="true"]');
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  // Raccourcis de la maquette : ↑ ↓ pour naviguer (hors champs de saisie).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        event.metaKey ||
        event.ctrlKey
      ) {
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const list = items ?? [];
      const index = list.findIndex((o) => o.id === selectedId);
      const next = list[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) setSelectedId(next.id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, selectedId]);

  const activeCount = activeFilterCount(filters);
  const hasCriteria = activeCount > 0 || filters.q !== '';
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="flex flex-wrap items-stretch md:h-full md:flex-nowrap md:overflow-hidden">
      <section
        aria-label="Offres à valider"
        className="flex min-w-[300px] flex-[0_1_440px] flex-col border-r border-line md:h-full md:overflow-hidden"
      >
        <div className="flex shrink-0 flex-col gap-3 border-b border-line px-4 pt-5 pb-3">
          <div className="flex items-baseline gap-2">
            <h1 className="m-0 text-[22px] leading-tight font-semibold">À valider</h1>
            <span className="text-muted" aria-live="polite">
              {total} offre{total > 1 ? 's' : ''}
            </span>
            {analyzingCount > 0 ? (
              <span role="status" className="text-[13px] text-muted">
                · analyse IA en cours…
              </span>
            ) : null}
          </div>

          <input
            type="search"
            aria-label="Rechercher une offre"
            placeholder="Rechercher : intitulé, entreprise, ville…"
            className="field !h-9 !text-[13px]"
            value={searchText}
            maxLength={100}
            onChange={(event) => setSearchText(event.target.value)}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
              className="btn btn-quiet !h-8 !text-[13px]"
            >
              Filtres{activeCount > 0 ? ` (${activeCount})` : ''}
            </button>
            <label className="flex items-center gap-1.5 text-[13px] text-muted">
              Tri
              <select
                className="field !h-8 !w-auto !px-2 !text-[13px]"
                value={filters.sort}
                onChange={(event) => changeFilters({ sort: event.target.value as Sort })}
              >
                <option value="score">Compatibilité</option>
                <option value="fresh">Plus récentes</option>
                <option value="distance">Plus proches</option>
              </select>
            </label>
          </div>

          {filtersOpen ? (
            <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3">
              <FilterGroup label="Source">
                {SOURCE_CHOICES.map((source) => (
                  <Chip
                    key={source.id}
                    pressed={filters.sources.includes(source.id)}
                    onClick={() => changeFilters({ sources: toggle(filters.sources, source.id) })}
                  >
                    {source.label}
                  </Chip>
                ))}
              </FilterGroup>
              <FilterGroup label="Contrat">
                {CONTRACT_CHOICES.map((contract) => (
                  <Chip
                    key={contract}
                    pressed={filters.contracts.includes(contract)}
                    onClick={() =>
                      changeFilters({ contracts: toggle(filters.contracts, contract) })
                    }
                  >
                    {contract === 'AUTRE' ? 'Autre' : CONTRACT_LABEL[contract]}
                  </Chip>
                ))}
              </FilterGroup>
              <FilterGroup label="Canal">
                {(
                  [
                    ['ALL', 'Tous'],
                    ['EMAIL', 'E-mail'],
                    ['SITE', 'Site'],
                  ] as const
                ).map(([id, label]) => (
                  <Chip
                    key={id}
                    pressed={filters.channel === id}
                    onClick={() => changeFilters({ channel: id })}
                  >
                    {label}
                  </Chip>
                ))}
              </FilterGroup>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
                  Compatibilité minimale
                  <select
                    className="field !h-8 !w-auto !px-2 !text-[13px]"
                    value={filters.minScore}
                    onChange={(event) => changeFilters({ minScore: Number(event.target.value) })}
                  >
                    <option value={0}>Toutes</option>
                    <option value={55}>Bonnes pistes (55 et plus)</option>
                    <option value={75}>Excellentes (75 et plus)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
                  Distance maximale
                  <select
                    className="field !h-8 !w-auto !px-2 !text-[13px]"
                    value={filters.maxDistanceKm ?? ''}
                    onChange={(event) =>
                      changeFilters({
                        maxDistanceKm:
                          event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                  >
                    <option value="">Toutes</option>
                    <option value={15}>15 km</option>
                    <option value={30}>30 km</option>
                    <option value={50}>50 km</option>
                  </select>
                </label>
              </div>
              {hasCriteria ? (
                <button
                  type="button"
                  className="btn btn-quiet !h-8 self-start !text-[13px]"
                  onClick={reset}
                >
                  Réinitialiser
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 md:overflow-y-auto">
          {error ? (
            <p role="alert" className="m-4 text-danger">
              {error}
            </p>
          ) : items === null ? (
            <p role="status" className="m-4 text-muted">
              Chargement…
            </p>
          ) : items.length === 0 ? (
            <div className="m-4 text-muted">
              {hasCriteria ? (
                <>
                  <p className="m-0 font-semibold text-ink">Aucune offre ne correspond.</p>
                  <p className="mt-1">
                    Élargis les filtres ou{' '}
                    <button type="button" className="cursor-pointer underline" onClick={reset}>
                      réinitialise-les
                    </button>
                    .
                  </p>
                </>
              ) : (
                <>
                  <p className="m-0 font-semibold text-ink">Aucune offre à traiter.</p>
                  <p className="mt-1">
                    Lance une collecte depuis la barre latérale pour en récupérer.
                  </p>
                </>
              )}
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              {items.map((offer) => (
                <li key={offer.id}>
                  <button
                    type="button"
                    aria-current={offer.id === selectedId}
                    onClick={() => setSelectedId(offer.id)}
                    className={`grid w-full cursor-pointer grid-cols-[44px_minmax(0,1fr)_auto] items-start gap-3 border-0 border-b border-line px-4 py-3 text-left font-[inherit] text-ink ${
                      offer.id === selectedId ? 'bg-selected' : 'bg-transparent hover:bg-hover'
                    }`}
                  >
                    <span
                      title={
                        offer.score === null ? 'Pas encore analysée par l’IA' : 'Compatibilité'
                      }
                      className={`inline-flex h-8 w-11 items-center justify-center rounded-md border text-[15px] font-semibold ${TONE_CLASS[scoreTone(offer.score)]}`}
                    >
                      {offer.score ?? '–'}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="leading-snug font-semibold">{offer.title}</span>
                      <span className="truncate text-[13px] text-muted">
                        {[
                          offer.company,
                          place(offer.city, offer.postcode),
                          distanceLabel(offer.distanceKm),
                          shortAge(offer.publishedAt ?? offer.firstSeenAt),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-0.5 text-[13px] text-muted">
                      <span>{CONTRACT_LABEL[offer.contractType]}</span>
                      <span className={offer.application ? 'font-medium text-ok' : ''}>
                        {offer.application ? 'Lettre prête' : 'Sans lettre'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <nav
          aria-label="Pagination"
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[13px] text-muted"
        >
          <span>
            {from}–{to} sur {total}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-quiet !h-8 !text-[13px]"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
            >
              Précédent
            </button>
            <span>
              Page {page + 1} sur {pageCount}
            </span>
            <button
              type="button"
              className="btn btn-quiet !h-8 !text-[13px]"
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              disabled={page >= pageCount - 1}
            >
              Suivant
            </button>
          </span>
        </nav>
      </section>

      <div ref={detailRef} className="min-w-0 flex-[1_1_520px] md:h-full md:overflow-y-auto">
        {selectedId ? (
          <OfferDetail
            key={selectedId}
            offerId={selectedId}
            onAnalyzed={(id, score, excluded) => {
              setItems((current) =>
                current ? current.map((o) => (o.id === id ? { ...o, score } : o)) : current,
              );
              // Écartée par l'IA : elle quitte le fil.
              if (excluded) {
                void load();
                void refreshBadge();
              }
            }}
            onChanged={() => {
              void load();
              void refreshBadge();
            }}
          />
        ) : (
          <p className="m-8 text-muted">Sélectionne une offre pour la consulter.</p>
        )}
      </div>
    </div>
  );
}
