import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { RejectedList, RejectedOffer } from '../../api/types';
import { useShell } from '../../components/shellContext';
import { CONTRACT_LABEL, expiryLabel, place } from '../../lib/format';

/**
 * Offres rejetées : elles restent ici 7 jours et peuvent être restaurées ; passé ce délai leur contenu est supprimé
 * (le serveur le fait lui-même, cet écran ne fait que les montrer).
 */
export function RejectedPage() {
  const { version, setCount } = useShell();
  const [items, setItems] = useState<RejectedOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<RejectedList>('GET', '/offers/rejected');
      setItems(list.items);
      setCount('rejected', list.total);
      setError(null);
    } catch {
      setError('Impossible de charger les offres rejetées.');
    }
  }, [setCount]);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function restore(offer: RejectedOffer) {
    setRestoringId(offer.id);
    setError(null);
    try {
      await api('POST', `/offers/${offer.id}/restore`);
      await load();
    } catch {
      setError(
        'Restauration impossible : le délai de 7 jours est peut-être dépassé. Recharge la liste.',
      );
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <section
      aria-label="Offres rejetées"
      className="mx-auto flex max-w-[760px] flex-col gap-4 px-8 py-6"
    >
      <header>
        <h1 className="m-0 text-[22px] leading-tight font-semibold">Rejetées</h1>
        <p className="mt-1.5 mb-0 text-muted">
          Une offre rejetée reste ici 7 jours. Tu peux la restaurer ; sinon son contenu (annonce,
          analyse, lettre, contact) est supprimé.
        </p>
      </header>

      {error ? (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      ) : null}

      {items === null && !error ? (
        <p role="status" className="m-0 text-muted">
          Chargement…
        </p>
      ) : null}

      {items !== null && items.length === 0 ? (
        <div className="text-muted">
          <p className="m-0 font-semibold text-ink">Aucune offre rejetée.</p>
          <p className="mt-1">
            Le bouton « Rejeter » de la page À valider range ici les offres qui ne t’intéressent
            pas, sans écrire de lettre.
          </p>
        </div>
      ) : null}

      {items !== null && items.length > 0 ? (
        <ul className="m-0 list-none rounded-md border border-line p-0">
          {items.map((offer) => (
            <li
              key={offer.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="leading-snug font-semibold">{offer.title}</span>
                <span className="truncate text-[13px] text-muted">
                  {[
                    offer.company,
                    place(offer.city, offer.postcode),
                    CONTRACT_LABEL[offer.contractType],
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="text-[13px] text-muted">
                  {expiryLabel(offer.expiresAt)}
                  {offer.hasLetter ? ' · sa lettre sera supprimée aussi' : ''}
                </span>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => void restore(offer)}
                disabled={restoringId !== null}
                aria-label={`Restaurer ${offer.title}`}
              >
                {restoringId === offer.id ? 'Restauration…' : 'Restaurer'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
