import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { FullRunReport, OfferSource, SourceReport, SourcesStatus } from '../../api/types';
import { useShell } from '../../components/shellContext';

type Tone = 'ok' | 'warn' | 'neutral';

interface Row {
  name: string;
  state: string;
  tone: Tone;
  count: string;
  note: string;
}

const REASONS: Record<string, string> = {
  unauthorized: 'clé refusée par la source',
  rate_limited: 'quota atteint',
  unavailable: 'source indisponible',
  unexpected: 'erreur inattendue',
};

function sourceRow(
  name: string,
  note: string,
  configured: boolean,
  report: SourceReport | undefined,
): Row {
  if (!configured) {
    return {
      name,
      state: 'Non configurée',
      tone: 'warn',
      count: '—',
      note: `${note} Clé absente du fichier .env.`,
    };
  }
  if (!report) {
    return {
      name,
      state: 'Configurée',
      tone: 'neutral',
      count: '—',
      note: `${note} Pas encore collectée depuis le démarrage.`,
    };
  }
  if (report.status === 'error') {
    const reason = report.reason ? (REASONS[report.reason] ?? report.reason) : 'échec';
    return {
      name,
      state: 'En erreur',
      tone: 'warn',
      count: '—',
      note: `${note} Dernier échec : ${reason}.`,
    };
  }
  return {
    name,
    state: 'Connectée',
    tone: 'ok',
    count: `${report.fetched} lues, ${report.created} nouvelles`,
    note,
  };
}

export function SourcesPage() {
  const { version } = useShell();
  const [status, setStatus] = useState<SourcesStatus | null>(null);
  const [report, setReport] = useState<FullRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const current = await api<SourcesStatus>('GET', '/collection/status');
        let last: FullRunReport | null = null;
        try {
          last = await api<FullRunReport>('GET', '/collection/last');
        } catch {
          // 404 : aucune collecte depuis le démarrage de l'API.
        }
        if (!cancelled) {
          setStatus(current);
          setReport(last);
        }
      } catch {
        if (!cancelled) setError('Impossible de charger l’état des sources.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  const find = (source: OfferSource) => report?.sources.find((s) => s.source === source);
  const rows: Row[] = status
    ? [
        sourceRow(
          'La Bonne Alternance',
          'Offres d’alternance (API officielle).',
          status.sources.LBA,
          find('LBA'),
        ),
        sourceRow(
          'La Bonne Boîte (France Travail)',
          'Entreprises qui recrutent souvent en alternance : candidatures spontanées.',
          status.sources.LBB,
          find('LBB'),
        ),
        sourceRow(
          'Adzuna',
          'Jobs by Adzuna : attribution obligatoire, descriptions parfois tronquées.',
          status.sources.ADZUNA,
          find('ADZUNA'),
        ),
        {
          name: 'Gemini',
          state: status.gemini.configured ? 'Configuré' : 'Non configuré',
          tone: status.gemini.configured ? 'ok' : 'warn',
          count: '—',
          note: `Rédaction des lettres, modèle ${status.gemini.model}. ${
            status.gemini.configured ? '' : 'Clé absente du fichier .env.'
          }`.trim(),
        },
        {
          name: 'Gmail',
          state: 'Pas encore connecté',
          tone: 'neutral',
          count: '—',
          note: 'Création de brouillons et lecture des réponses : arrive avec le module Gmail. Aucun envoi automatique.',
        },
      ]
    : [];

  const totals = report
    ? report.sources.reduce(
        (sum, s) => ({ fetched: sum.fetched + s.fetched, created: sum.created + s.created }),
        { fetched: 0, created: 0 },
      )
    : null;

  return (
    <div className="flex flex-col gap-4 px-8 pt-5 pb-8">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="m-0 text-[22px] leading-tight font-semibold">Sources</h1>
        <span className="text-muted">{rows.length > 0 ? `${rows.length} connexions` : ''}</span>
      </div>

      {error ? (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      ) : status === null ? (
        <p role="status" className="m-0 text-muted">
          Chargement…
        </p>
      ) : (
        <>
          <p className="m-0 max-w-[78ch]">
            {report && totals
              ? `Dernière collecte à ${new Date(report.finishedAt).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })} : ${totals.fetched} éléments lus, ${totals.created} nouveaux, ${report.scored} offres notées, ${report.purged} purgées.`
              : 'Aucune collecte depuis le démarrage. Lance-en une depuis la barre latérale.'}
          </p>

          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table aria-label="État des sources" className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-muted">
                  {['Source', 'État', 'Éléments', 'Remarque'].map((title) => (
                    <th
                      key={title}
                      scope="col"
                      className="border-b border-line-strong px-3 py-2.5 whitespace-nowrap"
                    >
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name} className="align-top hover:bg-hover">
                    <th
                      scope="row"
                      className="border-b border-line px-3 py-3 text-left font-semibold"
                    >
                      {row.name}
                    </th>
                    <td className="border-b border-line px-3 py-3">
                      <span
                        className={`font-semibold ${
                          row.tone === 'ok'
                            ? 'text-ok'
                            : row.tone === 'warn'
                              ? 'text-warn-text'
                              : 'text-muted'
                        }`}
                      >
                        {row.tone === 'ok' ? '✓ ' : row.tone === 'warn' ? '⚠ ' : ''}
                        {row.state}
                      </span>
                    </td>
                    <td className="border-b border-line px-3 py-3 text-[13px]">{row.count}</td>
                    <td className="max-w-[360px] border-b border-line px-3 py-3 text-[13px]">
                      {row.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="m-0 max-w-[78ch] text-[13px] text-muted">
        La collecte ne lit que des API officielles. Aucune connexion à LinkedIn, Indeed ou Welcome
        to the Jungle n’est utilisée, pour ne pas exposer ton compte.
      </p>
    </div>
  );
}
