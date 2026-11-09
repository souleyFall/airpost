import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../api/client';
import type { ApplicationRow, ApplicationStatus, ReplyKind, SyncReport } from '../../api/types';
import { useShell } from '../../components/shellContext';
import {
  FOLLOW_UP_DAYS,
  MANUAL_NEXT,
  STATUS_LABEL,
  daysSince,
  needsFollowUp,
  shortDate,
} from '../../lib/status';

const KIND_LABEL: Record<ReplyKind, string> = {
  ACKNOWLEDGEMENT: 'Accusé de réception',
  INTERVIEW: 'Entretien',
  REJECTION: 'Refus',
  OTHER: 'Autre',
};

type Filter = 'ALL' | 'TO_SEND' | 'FOLLOW_UP' | ApplicationStatus;

const TRACKED: readonly ApplicationStatus[] = [
  'VALIDATED',
  'DRAFT_CREATED',
  'APPLIED',
  'ACKNOWLEDGED',
  'INTERVIEW',
  'NO_RESPONSE',
  'REJECTED',
];

function matches(row: ApplicationRow, filter: Filter): boolean {
  switch (filter) {
    case 'ALL':
      return true;
    case 'TO_SEND':
      return row.status === 'VALIDATED' || row.status === 'DRAFT_CREATED';
    case 'FOLLOW_UP':
      return needsFollowUp(row.status, row.appliedAt);
    default:
      return row.status === filter;
  }
}

/** Pastille du statut, avec le même vocabulaire visuel que la maquette. */
function StatusIcon({ status }: { status: ApplicationStatus }) {
  const common = { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true } as const;
  switch (status) {
    case 'INTERVIEW':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6" fill="#1E3FA8" />
          <path
            d="m4.2 7.2 1.9 1.9 3.7-3.9"
            fill="none"
            stroke="#FFF"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'ACKNOWLEDGED':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.25" fill="none" stroke="#17191F" strokeWidth="1.5" />
          <path d="M7 1.75a5.25 5.25 0 0 1 0 10.5z" fill="#17191F" />
        </svg>
      );
    case 'REJECTED':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.25" fill="none" stroke="#A4231C" strokeWidth="1.5" />
          <path
            d="m4.9 4.9 4.2 4.2M9.1 4.9 4.9 9.1"
            stroke="#A4231C"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'NO_RESPONSE':
      return (
        <svg {...common}>
          <circle
            cx="7"
            cy="7"
            r="5.25"
            fill="none"
            stroke="#565B66"
            strokeWidth="1.5"
            strokeDasharray="2.4 2.2"
          />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.25" fill="none" stroke="#565B66" strokeWidth="1.5" />
        </svg>
      );
  }
}

export function TrackingPage() {
  const { version, setCount } = useShell();
  const [rows, setRows] = useState<ApplicationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [gmailReady, setGmailReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<ApplicationRow[]>('GET', '/applications?limit=500');
      setRows(list.filter((row) => TRACKED.includes(row.status)));
      setError(null);
    } catch {
      setError('Impossible de charger le suivi. Vérifie que le serveur est démarré.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => {
    api<{ configured: boolean }>('GET', '/gmail/status')
      .then((status) => setGmailReady(status.configured))
      .catch(() => setGmailReady(false));
    api<SyncReport>('GET', '/gmail/sync')
      .then((report) => setLastSync(report.finishedAt))
      .catch(() => setLastSync(null));
  }, []);

  useEffect(() => {
    setCount('tracking', rows ? rows.length : null);
  }, [rows, setCount]);

  async function changeStatus(row: ApplicationRow, status: ApplicationStatus) {
    setRowError(null);
    try {
      await api('POST', `/applications/${row.id}/status`, { status });
      await load();
    } catch (caught) {
      setRowError({
        id: row.id,
        message:
          caught instanceof ApiError && caught.status === 409
            ? 'Ce changement n’est plus possible : recharge la page.'
            : 'Le changement a échoué.',
      });
    }
  }

  async function synchronize() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const report = await api<SyncReport>('POST', '/gmail/sync');
      setLastSync(report.finishedAt);
      setSyncMessage(
        report.newReplies === 0
          ? 'Aucune nouvelle réponse.'
          : `${report.newReplies} nouvelle${report.newReplies > 1 ? 's' : ''} réponse${report.newReplies > 1 ? 's' : ''}.`,
      );
      await load();
    } catch (caught) {
      setSyncMessage(
        caught instanceof ApiError && caught.status === 503
          ? 'Gmail n’est pas disponible : reconnecte Gmail puis réessaie.'
          : caught instanceof ApiError && caught.status === 429
            ? 'Trop de synchronisations rapprochées : réessaie dans une minute.'
            : 'La synchronisation a échoué.',
      );
    } finally {
      setSyncing(false);
    }
  }

  async function correctReply(row: ApplicationRow, replyId: string, kind: ReplyKind) {
    setRowError(null);
    try {
      await api('PATCH', `/replies/${replyId}`, { kind });
      await load();
    } catch {
      setRowError({ id: row.id, message: 'La correction a échoué.' });
    }
  }

  async function createDraft(row: ApplicationRow) {
    setRowError(null);
    setCreatingDraft(row.id);
    try {
      await api('POST', `/applications/${row.id}/draft`);
      await load();
    } catch (caught) {
      setRowError({
        id: row.id,
        message:
          caught instanceof ApiError && caught.status === 503
            ? 'Gmail n’est pas disponible : reconnecte Gmail puis réessaie.'
            : caught instanceof ApiError && caught.status === 429
              ? 'Trop de demandes : réessaie dans une minute.'
              : 'Le brouillon n’a pas pu être créé.',
      });
    } finally {
      setCreatingDraft(null);
    }
  }

  async function remove(row: ApplicationRow) {
    setRowError(null);
    setConfirmDelete(null);
    try {
      const result = await api<{ gmailDraftDeleted: boolean | null }>(
        'DELETE',
        `/applications/${row.id}`,
      );
      setNotice(
        result.gmailDraftDeleted === false
          ? 'La candidature est supprimée, mais son brouillon n’a pas pu être retiré de Gmail : supprime-le toi-même dans Gmail.'
          : null,
      );
      await load();
    } catch {
      setRowError({ id: row.id, message: 'La suppression a échoué.' });
    }
  }

  const filters = useMemo(() => {
    const all = rows ?? [];
    const count = (f: Filter) => all.filter((row) => matches(row, f)).length;
    const list: { id: Filter; label: string }[] = [
      { id: 'ALL', label: 'Toutes' },
      { id: 'TO_SEND', label: 'À envoyer' },
      { id: 'FOLLOW_UP', label: 'À relancer' },
      { id: 'APPLIED', label: 'Envoyée' },
      { id: 'ACKNOWLEDGED', label: 'Accusé' },
      { id: 'INTERVIEW', label: 'Entretien' },
      { id: 'REJECTED', label: 'Refus' },
      { id: 'NO_RESPONSE', label: 'Sans réponse' },
    ];
    return list.map((item) => ({ ...item, count: count(item.id) }));
  }, [rows]);

  const visible = (rows ?? []).filter((row) => matches(row, filter));

  return (
    <div className="flex flex-col gap-4 px-8 pt-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="m-0 text-[22px] leading-tight font-semibold">Suivi</h1>
          <span className="text-muted">
            {rows?.length ?? 0}&nbsp;candidature{(rows?.length ?? 0) > 1 ? 's' : ''}
          </span>
        </div>
        {gmailReady ? (
          <div className="flex flex-wrap items-center gap-3">
            <span role="status" className="text-[13px] text-muted">
              {syncMessage ??
                (lastSync
                  ? `Gmail synchronisé à ${new Date(lastSync).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : 'Gmail pas encore synchronisé')}
            </span>
            <button
              type="button"
              className="btn !h-8 !text-[13px]"
              onClick={() => void synchronize()}
              disabled={syncing}
            >
              {syncing ? 'Synchronisation…' : 'Synchroniser'}
            </button>
          </div>
        ) : null}
      </div>

      <div
        role="group"
        aria-label="Filtrer par statut"
        className="inline-flex max-w-full flex-wrap self-start overflow-hidden rounded-md border border-line-strong bg-surface"
      >
        {filters.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={`inline-flex h-8 cursor-pointer items-center border-0 px-3 text-[13px] font-medium ${
              index > 0 ? 'border-l border-line' : ''
            } ${filter === item.id ? 'bg-ink text-paper' : 'bg-transparent text-ink hover:bg-hover'}`}
          >
            {item.label}&nbsp;{item.count}
          </button>
        ))}
      </div>

      {notice ? (
        <p
          role="alert"
          className="m-0 rounded-md border border-warn-line bg-warn-bg px-4 py-3 text-warn-ink"
        >
          {notice}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      ) : rows === null ? (
        <p role="status" className="m-0 text-muted">
          Chargement…
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-md border border-line bg-surface p-6 text-muted">
          <p className="m-0 font-semibold text-ink">Aucune candidature ici.</p>
          <p className="mt-1 mb-0">
            Une candidature apparaît dans le suivi dès que tu la valides dans « À valider ».
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-muted">
                {[
                  'Statut',
                  'Entreprise et poste',
                  'Canal',
                  'Envoyée',
                  'Dernier échange',
                  'Prochaine action',
                ].map((title) => (
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
              {visible.map((row) => {
                const days = daysSince(row.appliedAt ?? row.validatedAt);
                const followUp = needsFollowUp(row.status, row.appliedAt);
                const next = MANUAL_NEXT[row.status].filter((status) => status !== 'TO_REVIEW');
                return (
                  <tr key={row.id} className="align-top hover:bg-hover">
                    <td className="border-b border-line px-3 py-3">
                      <span className="inline-flex items-center gap-2 font-semibold">
                        <StatusIcon status={row.status} />
                        {STATUS_LABEL[row.status]}
                      </span>
                      {days !== null ? (
                        <div className="mt-0.5 ml-[22px] text-xs text-muted">J+{days}</div>
                      ) : null}
                    </td>
                    <td className="border-b border-line px-3 py-3">
                      <div className="font-semibold">{row.offer.title}</div>
                      <div className="text-[13px] text-muted">{row.offer.company}</div>
                    </td>
                    <td className="border-b border-line px-3 py-3 text-[13px] text-muted">
                      {row.offer.channel === 'EMAIL' ? 'E-mail' : 'Site'}
                    </td>
                    <td className="border-b border-line px-3 py-3 text-[13px] whitespace-nowrap text-muted">
                      {shortDate(row.appliedAt)}
                    </td>
                    <td className="max-w-[340px] border-b border-line px-3 py-3 text-[13px]">
                      {row.replies[0] ? (
                        <div className="flex flex-col gap-1.5">
                          <span>
                            Mail du {shortDate(row.replies[0].receivedAt)} :{' '}
                            {row.replies[0].snippet
                              ? `« ${row.replies[0].snippet.slice(0, 90)} »`
                              : ''}
                          </span>
                          <label className="flex items-center gap-1.5 text-xs text-muted">
                            Catégorie
                            <select
                              className="field !h-8 !w-auto !px-2 !text-[13px]"
                              value={row.replies[0].kind}
                              aria-label={`Catégorie du dernier mail de ${row.offer.company}`}
                              onChange={(event) =>
                                void correctReply(
                                  row,
                                  row.replies[0].id,
                                  event.target.value as ReplyKind,
                                )
                              }
                            >
                              {(Object.keys(KIND_LABEL) as ReplyKind[]).map((kind) => (
                                <option key={kind} value={kind}>
                                  {KIND_LABEL[kind]}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ) : (
                        'Aucun mail reçu'
                      )}
                    </td>
                    <td className="border-b border-line px-3 py-3">
                      <div className="flex flex-col items-start gap-2">
                        {row.status === 'VALIDATED' &&
                        gmailReady &&
                        row.offer.channel === 'EMAIL' ? (
                          <button
                            type="button"
                            className="btn btn-primary !h-8 !text-[13px]"
                            disabled={creatingDraft === row.id}
                            onClick={() => void createDraft(row)}
                          >
                            {creatingDraft === row.id ? 'Création…' : 'Créer le brouillon Gmail'}
                          </button>
                        ) : null}
                        {row.status === 'DRAFT_CREATED' ? (
                          <a
                            href="https://mail.google.com/mail/#drafts"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[13px]"
                          >
                            Ouvrir le brouillon dans Gmail
                          </a>
                        ) : null}
                        {row.status === 'VALIDATED' || row.status === 'DRAFT_CREATED' ? (
                          <button
                            type="button"
                            className={`btn !h-8 !text-[13px] ${
                              row.status === 'DRAFT_CREATED' ||
                              !gmailReady ||
                              row.offer.channel !== 'EMAIL'
                                ? 'btn-primary'
                                : ''
                            }`}
                            onClick={() => void changeStatus(row, 'APPLIED')}
                          >
                            Marquer envoyée
                          </button>
                        ) : followUp ? (
                          <span className="text-[13px] font-medium text-warn-text">
                            Sans nouvelle depuis {days} jours
                          </span>
                        ) : row.status === 'APPLIED' ? (
                          <span className="text-[13px] text-muted">
                            Attendre {FOLLOW_UP_DAYS} jours
                          </span>
                        ) : null}
                        {next.length > 0 ? (
                          <label className="flex items-center gap-1.5 text-xs text-muted">
                            <span className="sr-only">Changer le statut de {row.offer.title}</span>
                            <select
                              className="field !h-8 !w-auto !px-2 !text-[13px]"
                              value=""
                              aria-label={`Changer le statut de ${row.offer.title}`}
                              onChange={(event) => {
                                if (event.target.value) {
                                  void changeStatus(row, event.target.value as ApplicationStatus);
                                }
                              }}
                            >
                              <option value="">Changer le statut…</option>
                              {next.map((status) => (
                                <option key={status} value={status}>
                                  {STATUS_LABEL[status]}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {confirmDelete === row.id ? (
                          <span className="flex items-center gap-2 text-[13px]">
                            <button
                              type="button"
                              className="btn !h-8 !text-[13px] !text-danger"
                              onClick={() => void remove(row)}
                            >
                              Confirmer la suppression
                            </button>
                            <button
                              type="button"
                              className="btn btn-quiet !h-8 !text-[13px]"
                              onClick={() => setConfirmDelete(null)}
                            >
                              Annuler
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-quiet !h-8 !px-2 !text-[13px]"
                            onClick={() => setConfirmDelete(row.id)}
                          >
                            Supprimer
                          </button>
                        )}
                        {rowError?.id === row.id ? (
                          <span role="alert" className="text-[13px] text-danger">
                            {rowError.message}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="m-0 text-[13px] text-muted">
        Le brouillon Gmail n’est jamais envoyé par airpost : tu l’envoies toi-même depuis Gmail,
        puis tu marques la candidature « envoyée ». La synchronisation classe les réponses par
        mots-clés (corrige la catégorie si elle est fausse, le statut suit) ; une candidature passe
        en « sans réponse » après 14 jours sans mail. Supprimer une candidature efface aussi son
        brouillon Gmail et le contact du recruteur enregistré.
      </p>
    </div>
  );
}
