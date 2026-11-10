import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { Stats } from '../../api/types';
import { useShell } from '../../components/shellContext';
import { SOURCE_LABEL } from '../../lib/format';
import { percent, weekLabel } from '../../lib/stats';

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-surface px-4 py-3">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="m-0 text-[26px] leading-none font-semibold">{value}</dd>
      {note ? <dd className="m-0 text-[13px] text-muted">{note}</dd> : null}
    </div>
  );
}

const sourceName = (source: string) => (SOURCE_LABEL as Record<string, string>)[source] ?? source;

export function StatsPage() {
  const { version } = useShell();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Stats>('GET', '/stats')
      .then((data) => {
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      })
      .catch(() => !cancelled && setError('Impossible de charger les résultats.'));
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (error) {
    return (
      <p role="alert" className="m-8 text-danger">
        {error}
      </p>
    );
  }
  if (!stats) {
    return (
      <p role="status" className="m-8 text-muted">
        Chargement…
      </p>
    );
  }

  const { funnel, pipeline } = stats;
  const maxWeek = Math.max(1, ...stats.weekly.map((w) => w.applied));

  return (
    <div className="flex flex-col gap-6 px-8 pt-5 pb-8">
      <h1 className="m-0 text-[22px] leading-tight font-semibold">Résultats</h1>

      {stats.smallSample ? (
        <p
          role="note"
          className="m-0 max-w-[78ch] rounded-md border border-warn-line bg-warn-bg px-4 py-3 text-warn-ink"
        >
          <strong>Trop tôt pour conclure :</strong> {funnel.applied} candidature
          {funnel.applied > 1 ? 's' : ''} envoyée{funnel.applied > 1 ? 's' : ''} (il en faut au
          moins 5). Les pourcentages ci-dessous sont indicatifs.
        </p>
      ) : null}

      <section aria-label="Candidatures envoyées" className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-semibold">Ce que donnent tes candidatures</h2>
        <dl className="m-0 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card label="Envoyées" value={String(funnel.applied)} />
          <Card
            label="Réponses reçues"
            value={String(funnel.answered)}
            note={`${percent(funnel.answerRate)} des envoyées`}
          />
          <Card
            label="Entretiens"
            value={String(funnel.interviews)}
            note={`${percent(funnel.interviewRate)} des envoyées`}
          />
          <Card
            label="Délai médian de réponse"
            value={
              funnel.medianDaysToFirstReply === null ? '—' : `${funnel.medianDaysToFirstReply} j`
            }
            note={funnel.medianDaysToFirstReply === null ? 'Aucune réponse encore' : undefined}
          />
        </dl>
        <p className="m-0 text-[13px] text-muted">
          {funnel.unanswered} sans réponse, {funnel.rejections} refus. Une « réponse » est un mail
          classé (accusé, entretien, refus, autre) ou un statut que tu as posé toi-même.
        </p>
      </section>

      <section aria-label="En cours" className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-semibold">En cours</h2>
        <dl className="m-0 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card label="À valider" value={String(pipeline.toReview)} />
          <Card label="À envoyer" value={String(pipeline.toSend)} />
          <Card label="En attente de réponse" value={String(pipeline.waiting)} />
          <Card
            label="À relancer"
            value={String(pipeline.toFollowUp)}
            note={pipeline.toFollowUp > 0 ? 'Voir le suivi' : undefined}
          />
        </dl>
        {pipeline.toFollowUp > 0 ? (
          <p className="m-0 text-[13px]">
            <Link to="/suivi">Ouvrir le suivi pour préparer les relances</Link>
          </p>
        ) : null}
      </section>

      <section aria-label="Par source" className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-semibold">Par source</h2>
        {stats.bySource.length === 0 ? (
          <p className="m-0 text-muted">Aucune candidature envoyée pour l’instant.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table aria-label="Résultats par source" className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-muted">
                  {['Source', 'Envoyées', 'Réponses', 'Entretiens', 'Taux de réponse'].map(
                    (title) => (
                      <th
                        key={title}
                        scope="col"
                        className="border-b border-line-strong px-3 py-2.5 whitespace-nowrap"
                      >
                        {title}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {stats.bySource.map((row) => (
                  <tr key={row.source} className="hover:bg-hover">
                    <th
                      scope="row"
                      className="border-b border-line px-3 py-2.5 text-left font-semibold"
                    >
                      {sourceName(row.source)}
                    </th>
                    <td className="border-b border-line px-3 py-2.5">{row.applied}</td>
                    <td className="border-b border-line px-3 py-2.5">{row.answered}</td>
                    <td className="border-b border-line px-3 py-2.5">{row.interviews}</td>
                    <td className="border-b border-line px-3 py-2.5">
                      {percent(row.answered / row.applied)}
                      {row.applied < 3 ? (
                        <span className="ml-1.5 text-xs text-muted">(sur {row.applied})</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Envois par semaine" className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-semibold">Envois par semaine</h2>
        <ul className="m-0 flex max-w-[640px] list-none flex-col gap-1.5 p-0">
          {stats.weekly.map((week) => (
            <li key={week.weekStart} className="flex items-center gap-3 text-[13px]">
              <span className="w-24 shrink-0 text-muted">{weekLabel(week.weekStart)}</span>
              <span className="h-3 flex-1 rounded-sm bg-badge" aria-hidden="true">
                <span
                  className="block h-3 rounded-sm bg-ink"
                  style={{ width: `${(week.applied / maxWeek) * 100}%` }}
                />
              </span>
              <span className="w-6 text-right font-semibold">{week.applied}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Relances" className="flex flex-col gap-2">
        <h2 className="m-0 text-base font-semibold">Relances</h2>
        <p className="m-0 max-w-[78ch]">
          {stats.followUps.sent === 0
            ? 'Aucune relance faite pour l’instant.'
            : `${stats.followUps.sent} relance${stats.followUps.sent > 1 ? 's' : ''} faite${stats.followUps.sent > 1 ? 's' : ''}, dont ${stats.followUps.answeredAfter} suivie${stats.followUps.answeredAfter > 1 ? 's' : ''} d’une réponse.`}
        </p>
      </section>

      <section aria-label="Offres collectées" className="flex flex-col gap-2">
        <h2 className="m-0 text-base font-semibold">Offres collectées</h2>
        <p className="m-0 max-w-[78ch]">
          {stats.offers.total} offre{stats.offers.total > 1 ? 's' : ''} en base, dont{' '}
          {stats.offers.newThisWeek} nouvelle{stats.offers.newThisWeek > 1 ? 's' : ''} ces 7
          derniers jours
          {stats.offers.newThisWeekBySource.length > 0
            ? ` (${stats.offers.newThisWeekBySource
                .map((entry) => `${sourceName(entry.source)} ${entry.count}`)
                .join(', ')})`
            : ''}
          .
        </p>
      </section>
    </div>
  );
}
