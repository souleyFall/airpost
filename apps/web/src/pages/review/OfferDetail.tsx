import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../api/client';
import type {
  ApplicationDetail,
  LetterResult,
  OfferDetail as OfferDetailData,
  ScoreDetail,
} from '../../api/types';
import {
  MAX_WORDS,
  MIN_WORDS,
  SOURCE_LABEL,
  ageLabel,
  hasPlaceholder,
  place,
  wordCount,
} from '../../lib/format';

interface Props {
  offerId: string;
  /** Appelé après toute action : `done` = la candidature quitte l'écran « À valider ». */
  onChanged: (done: boolean) => void;
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) {
      return 'La lettre générée ne respecte pas les garde-fous. Régénère-la.';
    }
    return error.message;
  }
  return 'Action impossible pour le moment.';
}

const CRITERIA: {
  key: keyof Pick<
    ScoreDetail,
    'freshness' | 'stack' | 'rhythm' | 'commute' | 'competition' | 'channel'
  >;
  label: string;
  max: number;
  note: (detail: ScoreDetail, offer: OfferDetailData) => string;
}[] = [
  {
    key: 'freshness',
    label: 'Fraîcheur',
    max: 25,
    note: (_d, offer) => ageLabel(offer.publishedAt ?? offer.firstSeenAt),
  },
  {
    key: 'stack',
    label: 'Stack',
    max: 25,
    note: (d) =>
      d.matchedTerms.length > 0 ? d.matchedTerms.slice(0, 3).join(', ') : 'aucune trouvée',
  },
  {
    key: 'rhythm',
    label: 'Rythme',
    max: 15,
    note: (d) => d.detectedRhythm?.replace('_', ' / ') ?? 'non précisé',
  },
  {
    key: 'commute',
    label: 'Trajet',
    max: 15,
    note: (d) => (d.estimatedMinutes === null ? 'inconnu' : `≈ ${d.estimatedMinutes} min`),
  },
  { key: 'competition', label: 'Concurrence', max: 10, note: () => 'estimée' },
  {
    key: 'channel',
    label: 'Canal',
    max: 10,
    note: (_d, offer) => (offer.channel === 'EMAIL' ? 'e-mail direct' : 'site de l’entreprise'),
  },
];

export function OfferDetail({ offerId, onChanged }: Props) {
  const [offer, setOffer] = useState<OfferDetailData | null>(null);
  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'generate' | 'save' | 'validate' | 'reject'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);

  const applyApplication = useCallback((data: ApplicationDetail) => {
    setApplication(data);
    setSubject(data.subject ?? '');
    setBody(data.body ?? '');
    setSaved(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setOffer(null);
    setApplication(null);
    setWarnings([]);
    setLoadError(null);
    setActionError(null);
    void (async () => {
      try {
        const detail = await api<OfferDetailData>('GET', `/offers/${offerId}`);
        const app = detail.application
          ? await api<ApplicationDetail>('GET', `/applications/${detail.application.id}`)
          : null;
        if (cancelled) return;
        setOffer(detail);
        if (app) applyApplication(app);
      } catch (error) {
        if (!cancelled) setLoadError(errorText(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offerId, applyApplication]);

  async function run(action: NonNullable<typeof busy>, task: () => Promise<boolean | void>) {
    setBusy(action);
    setActionError(null);
    try {
      const done = await task();
      onChanged(done === true);
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  const generate = () =>
    run('generate', async () => {
      const letter = await api<LetterResult>('POST', `/offers/${offerId}/letter`);
      setWarnings(letter.warnings);
      applyApplication(
        await api<ApplicationDetail>('GET', `/applications/${letter.applicationId}`),
      );
    });

  async function persist(id: string) {
    applyApplication(
      await api<ApplicationDetail>('PATCH', `/applications/${id}`, { subject, body }),
    );
  }

  const save = () =>
    run('save', async () => {
      if (application) await persist(application.id);
    });

  const validate = () =>
    run('validate', async () => {
      if (!application) return;
      if (!saved) await persist(application.id);
      await api('POST', `/applications/${application.id}/status`, { status: 'VALIDATED' });
      return true;
    });

  const reject = () =>
    run('reject', async () => {
      if (!application) return;
      await api('POST', `/applications/${application.id}/status`, { status: 'WITHDRAWN' });
      return true;
    });

  if (loadError) {
    return (
      <p role="alert" className="m-8 text-danger">
        {loadError}
      </p>
    );
  }
  if (!offer) {
    return (
      <p role="status" className="m-8 text-muted">
        Chargement de l’offre…
      </p>
    );
  }

  const words = wordCount(body);
  const wordsOk = words >= MIN_WORDS && words <= MAX_WORDS;
  const placeholder = hasPlaceholder(body) || hasPlaceholder(subject);
  const canValidate = application !== null && wordsOk && !placeholder && subject.trim() !== '';
  const detail = offer.scoreDetail;

  return (
    <section aria-label="Détail de l’offre" className="flex min-h-full flex-col">
      <div className="flex flex-1 flex-col gap-4 px-8 py-6">
        <header>
          <h2 className="m-0 text-[22px] leading-tight font-semibold text-balance">
            {offer.title}
          </h2>
          <p className="mt-1.5 mb-0 text-muted">
            {offer.company} · {place(offer.city, offer.postcode)} ·{' '}
            {ageLabel(offer.publishedAt ?? offer.firstSeenAt)} · {SOURCE_LABEL[offer.source]}
            {offer.applyUrl ? (
              <>
                {' · '}
                <a href={offer.applyUrl} target="_blank" rel="noopener noreferrer">
                  Voir l’offre
                </a>
              </>
            ) : null}
          </p>
        </header>

        {detail ? (
          <div className="rounded-md border border-line bg-surface">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
              <span className="text-base font-semibold">Score {offer.score} / 100</span>
            </div>
            <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))]">
              {CRITERIA.map((criterion, index) => (
                <div
                  key={criterion.key}
                  className={`px-4 py-2.5 ${index > 0 ? 'border-l border-line' : ''}`}
                >
                  <dt className="text-xs text-muted">{criterion.label}</dt>
                  <dd className="m-0 font-semibold">
                    {detail[criterion.key]}/{criterion.max}
                  </dd>
                  <dd className="m-0 text-xs text-muted">{criterion.note(detail, offer)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {application === null ? (
          <div className="rounded-md border border-line bg-surface p-6">
            <h3 className="m-0 text-base font-semibold">Pas encore de lettre</h3>
            <p className="mt-1.5 mb-4 text-muted">
              La lettre est écrite à partir de ton profil et de cette offre uniquement, puis
              vérifiée par des garde-fous. Tu la relis et la modifies avant toute validation.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void generate()}
              disabled={busy !== null}
            >
              {busy === 'generate' ? 'Génération en cours…' : 'Générer la lettre'}
            </button>
          </div>
        ) : (
          <>
            {warnings.length > 0 || placeholder ? (
              <div
                role="note"
                className="flex gap-3 rounded-md border border-warn-line bg-warn-bg px-4 py-3 text-warn-ink"
              >
                <div>
                  <p className="m-0 font-semibold">À vérifier avant de valider</p>
                  <ul className="mt-1 mb-0 pl-[18px]">
                    {placeholder ? (
                      <li>
                        Le texte contient un repère entre crochets à remplacer par un fait précis.
                      </li>
                    ) : null}
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              {offer.channel === 'EMAIL' && offer.contactEmail ? (
                <div>
                  <label htmlFor="to" className="mb-1 block text-xs font-medium text-muted">
                    Destinataire
                  </label>
                  <input
                    id="to"
                    className="field !h-10 !text-sm"
                    type="email"
                    readOnly
                    value={offer.contactEmail}
                  />
                </div>
              ) : null}
              <div>
                <label htmlFor="subject" className="mb-1 block text-xs font-medium text-muted">
                  Objet
                </label>
                <input
                  id="subject"
                  className="field !h-10 !text-sm"
                  type="text"
                  maxLength={120}
                  value={subject}
                  onChange={(event) => {
                    setSubject(event.target.value);
                    setSaved(false);
                  }}
                />
              </div>
            </div>

            <div className="rounded-md border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 pr-2 pl-4">
                <label htmlFor="letter-body" className="text-[13px] font-semibold">
                  Corps du mail
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-[13px] font-medium ${wordsOk ? 'text-ok' : 'text-warn-text'}`}
                    aria-live="polite"
                  >
                    {words} mots · cible {MIN_WORDS}–{MAX_WORDS}
                  </span>
                  <button
                    type="button"
                    className="btn btn-quiet !h-8 !text-[13px]"
                    onClick={() => void generate()}
                    disabled={busy !== null}
                  >
                    {busy === 'generate' ? 'Génération…' : 'Régénérer'}
                  </button>
                </div>
              </div>
              <textarea
                id="letter-body"
                className="block w-full resize-y rounded-b-md border-0 bg-transparent px-8 py-6 font-serif text-base leading-[1.65]"
                style={{ minHeight: 320, maxWidth: '72ch' }}
                maxLength={3000}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  setSaved(false);
                }}
              />
            </div>
          </>
        )}

        {actionError ? (
          <p role="alert" className="m-0 text-danger">
            {actionError}
          </p>
        ) : null}
      </div>

      {application !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-paper px-8 py-4">
          <p className="m-0 max-w-[360px] text-[13px] text-muted">
            Rien n’est envoyé : l’envoi reste manuel.
            {!canValidate && !placeholder && !wordsOk ? ' Longueur du texte hors cible.' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => void reject()}
              disabled={busy !== null}
            >
              Rejeter
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void save()}
              disabled={busy !== null || saved}
            >
              {busy === 'save' ? 'Enregistrement…' : saved ? 'Enregistré' : 'Enregistrer'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void validate()}
              disabled={busy !== null || !canValidate}
            >
              {busy === 'validate' ? 'Validation…' : 'Valider la candidature'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
