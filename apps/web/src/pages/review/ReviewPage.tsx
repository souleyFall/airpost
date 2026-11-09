import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { ApplyChannel, OfferList, OfferSummary } from '../../api/types';
import { useShell } from '../../components/shellContext';
import { place, scoreTone, shortAge } from '../../lib/format';
import { OfferDetail } from './OfferDetail';

type ChannelFilter = 'ALL' | ApplyChannel;
type Sort = 'score' | 'recent';

const TONE_CLASS = {
  high: 'border-ink bg-ink text-paper',
  mid: 'border-ink bg-transparent text-ink',
  low: 'border-line-strong bg-transparent text-muted',
} as const;

/** Offres à traiter : sans candidature, ou dont la lettre attend encore ta relecture. */
export function isPending(offer: OfferSummary): boolean {
  return offer.application === null || offer.application.status === 'TO_REVIEW';
}

export function ReviewPage() {
  const { version, setCount } = useShell();
  const [offers, setOffers] = useState<OfferSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelFilter>('ALL');
  const [sort, setSort] = useState<Sort>('score');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<OfferList>('GET', '/offers?limit=200');
      setOffers(list.items.filter(isPending));
      setError(null);
    } catch {
      setError('Impossible de charger les offres. Vérifie que le serveur est démarré.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  const visible = useMemo(() => {
    const list = (offers ?? []).filter((o) => channel === 'ALL' || o.channel === channel);
    return [...list].sort((a, b) =>
      sort === 'score'
        ? (b.score ?? -1) - (a.score ?? -1)
        : new Date(b.publishedAt ?? b.firstSeenAt).getTime() -
          new Date(a.publishedAt ?? a.firstSeenAt).getTime(),
    );
  }, [offers, channel, sort]);

  const ready = (offers ?? []).filter((o) => o.application !== null).length;
  useEffect(() => {
    setCount('review', offers ? ready : null);
  }, [offers, ready, setCount]);

  // Sélection par défaut : la première offre ; si l'offre sélectionnée disparaît, la suivante.
  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null);
    } else if (!visible.some((o) => o.id === selectedId)) {
      setSelectedId(visible[0]?.id ?? null);
    }
  }, [visible, selectedId]);

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
      const index = visible.findIndex((o) => o.id === selectedId);
      const next = visible[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) setSelectedId(next.id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selectedId]);

  const emailCount = (offers ?? []).filter((o) => o.channel === 'EMAIL').length;
  const siteCount = (offers ?? []).filter((o) => o.channel === 'SITE').length;
  const segments: { id: ChannelFilter; label: string; count: number }[] = [
    { id: 'ALL', label: 'Toutes', count: offers?.length ?? 0 },
    { id: 'EMAIL', label: 'E-mail', count: emailCount },
    { id: 'SITE', label: 'Site', count: siteCount },
  ];

  return (
    <div className="flex min-h-screen flex-wrap items-stretch">
      <section
        aria-label="Offres à valider"
        className="flex min-w-[300px] flex-[0_1_420px] flex-col border-r border-line"
      >
        <div className="flex flex-col gap-3 border-b border-line px-4 pt-5 pb-3">
          <div className="flex items-baseline gap-2">
            <h1 className="m-0 text-[22px] leading-tight font-semibold">À valider</h1>
            <span className="text-muted">
              {ready} lettre{ready > 1 ? 's' : ''} prête{ready > 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="group"
              aria-label="Filtrer par canal"
              className="inline-flex overflow-hidden rounded-md border border-line-strong bg-surface"
            >
              {segments.map((segment, index) => (
                <button
                  key={segment.id}
                  type="button"
                  aria-pressed={channel === segment.id}
                  onClick={() => setChannel(segment.id)}
                  className={`inline-flex h-8 cursor-pointer items-center border-0 px-3 text-[13px] font-medium ${
                    index > 0 ? 'border-l border-line' : ''
                  } ${channel === segment.id ? 'bg-ink text-paper' : 'bg-transparent text-ink hover:bg-hover'}`}
                >
                  {segment.label}&nbsp;{segment.count}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-[13px] text-muted">
              Tri
              <select
                className="field !h-8 !w-auto !px-2 !text-[13px]"
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
              >
                <option value="score">Score, décroissant</option>
                <option value="recent">Plus récentes</option>
              </select>
            </label>
          </div>
        </div>

        {error ? (
          <p role="alert" className="m-4 text-danger">
            {error}
          </p>
        ) : offers === null ? (
          <p role="status" className="m-4 text-muted">
            Chargement…
          </p>
        ) : visible.length === 0 ? (
          <div className="m-4 text-muted">
            <p className="m-0 font-semibold text-ink">Aucune offre à traiter.</p>
            <p className="mt-1">Lance une collecte depuis la barre latérale pour en récupérer.</p>
          </div>
        ) : (
          <ul className="m-0 list-none p-0">
            {visible.map((offer) => (
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
                    className={`inline-flex h-8 w-11 items-center justify-center rounded-md border text-[15px] font-semibold ${TONE_CLASS[scoreTone(offer.score)]}`}
                  >
                    {offer.score ?? '–'}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="leading-snug font-semibold">{offer.title}</span>
                    <span className="truncate text-[13px] text-muted">
                      {offer.company} · {place(offer.city, offer.postcode)} ·{' '}
                      {shortAge(offer.publishedAt ?? offer.firstSeenAt)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-0.5 text-[13px] text-muted">
                    <span>{offer.channel === 'EMAIL' ? 'E-mail' : 'Site'}</span>
                    <span className={offer.application ? 'font-medium text-ok' : ''}>
                      {offer.application ? 'Lettre prête' : 'Sans lettre'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex flex-wrap gap-x-4 gap-y-2 border-t border-line px-4 py-3 text-xs text-muted">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> naviguer
          </span>
        </div>
      </section>

      <div className="min-w-0 flex-[1_1_520px]">
        {selectedId ? (
          <OfferDetail
            key={selectedId}
            offerId={selectedId}
            onChanged={() => {
              void load();
            }}
          />
        ) : (
          <p className="m-8 text-muted">Sélectionne une offre pour la consulter.</p>
        )}
      </div>
    </div>
  );
}
