import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../api/client';
import type {
  ApplicationDetail,
  LetterResult,
  OfferDetail as OfferDetailData,
} from '../../api/types';
import {
  CONTRACT_LABEL,
  MAX_WORDS,
  MIN_WORDS,
  SOURCE_LABEL,
  VERDICT_LABEL,
  ageLabel,
  distanceLabel,
  hasPlaceholder,
  place,
  scoreTone,
  wordCount,
} from '../../lib/format';
import { buildLetterPdf, downloadPdf, letterContent, letterFileName } from '../../lib/letterPdf';
import type { Profile } from '../profile/profileForm';

interface Props {
  offerId: string;
  /** Appelé après toute action : `done` = la candidature quitte l'écran « À valider ». */
  onChanged: (done: boolean) => void;
  /** Appelé quand l'IA vient de noter l'offre : la liste met son badge à jour sans se recharger. */
  onAnalyzed?: (offerId: string, score: number | null, excluded: boolean) => void;
}

function analysisErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Quota du modèle atteint : réessaie dans quelques minutes.';
    if (error.status === 503)
      return 'Analyse indisponible : la clé Gemini est à vérifier (page Sources).';
    if (error.status === 400) return error.message;
  }
  return 'L’analyse a échoué.';
}

/** Délai avant l'analyse automatique d'une offre ouverte. */
const AUTO_ANALYZE_DELAY_MS = 400;

const TONE_CLASS = {
  high: 'border-ink bg-ink text-paper',
  mid: 'border-ink bg-transparent text-ink',
  low: 'border-line-strong bg-transparent text-muted',
} as const;

function Brief({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
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

export function OfferDetail({ offerId, onChanged, onAnalyzed }: Props) {
  const [offer, setOffer] = useState<OfferDetailData | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'generate' | 'save' | 'validate' | 'reject' | 'apply'>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  const applyApplication = useCallback((data: ApplicationDetail) => {
    setApplication(data);
    setSubject(data.subject ?? '');
    setBody(data.body ?? '');
    setSaved(true);
  }, []);

  /** Demande l'analyse à l'IA (ou la refait si `force`) et met l'offre à jour. */
  const analyze = useCallback(
    async (force: boolean) => {
      setAnalyzing(true);
      setAnalysisError(null);
      try {
        const fresh = await api<OfferDetailData>(
          'POST',
          `/offers/${offerId}/analyze${force ? '?force=true' : ''}`,
        );
        if (!mounted.current) return;
        setOffer((current) => (current ? { ...current, ...fresh } : current));
        onAnalyzed?.(offerId, fresh.score, fresh.excluded);
      } catch (error) {
        if (mounted.current) setAnalysisError(analysisErrorText(error));
      } finally {
        if (mounted.current) setAnalyzing(false);
      }
    },
    [offerId, onAnalyzed],
  );

  // Une offre jamais analysée l'est dès qu'on l'ouvre (une seule fois par offre ouverte).
  const needsAnalysis = offer !== null && offer.analysis === null;
  const autoAnalyzed = useRef(false);
  useEffect(() => {
    if (!needsAnalysis || autoAnalyzed.current) return;
    // Petit délai : en parcourant la liste aux flèches, on ne lance pas une analyse (donc un appel au modèle,
    // au quota limité) pour chaque offre qu'on ne fait que traverser.
    const timer = setTimeout(() => {
      autoAnalyzed.current = true;
      void analyze(false);
    }, AUTO_ANALYZE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [needsAnalysis, analyze]);

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

  /** Rejette l'offre, avec ou sans lettre : elle va dans « Rejetées » et y reste restaurable 7 jours. */
  const reject = () =>
    run('reject', async () => {
      await api('POST', `/offers/${offerId}/reject`);
      return true;
    });

  /** Postule sans lettre : la candidature passe au suivi, déjà « envoyée » (airpost n'envoie rien). */
  const applyWithoutLetter = () =>
    run('apply', async () => {
      await api('POST', '/applications/without-letter', { offerId });
      return true;
    });

  /** Copie le texte de la lettre tel qu'il est à l'écran (modifications non enregistrées comprises). */
  async function copyLetter() {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => mounted.current && setCopied(false), 2000);
    } catch {
      setActionError('Copie impossible : sélectionne le texte et copie-le à la main.');
    }
  }

  /** Fabrique le PDF dans le navigateur : en-tête tiré du profil, date du jour, objet, texte, signature. */
  async function downloadLetter() {
    if (!offer) return;
    setExporting(true);
    setActionError(null);
    try {
      const profile = await api<Profile>('GET', '/profile');
      const sender = { ...profile.identity, headline: profile.headline };
      const bytes = await buildLetterPdf(
        letterContent(sender, subject, body, new Date(), {
          company: offer.company,
          postcode: offer.postcode,
          city: offer.city,
        }),
      );
      downloadPdf(bytes, letterFileName(sender, offer.company));
    } catch {
      setActionError('Le PDF n’a pas pu être créé.');
    } finally {
      if (mounted.current) setExporting(false);
    }
  }

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
  const analysis = offer.analysis;
  const meta = [
    offer.company,
    place(offer.city, offer.postcode),
    distanceLabel(offer.distanceKm),
    CONTRACT_LABEL[offer.contractType],
  ].filter(Boolean);

  return (
    <section aria-label="Détail de l’offre" className="flex min-h-full flex-col">
      <div className="flex flex-1 flex-col gap-4 px-8 py-6">
        <header>
          <h2 className="m-0 text-[22px] leading-tight font-semibold text-balance">
            {offer.title}
          </h2>
          <p className="mt-1.5 mb-0 text-muted">
            {meta.join(' · ')} · {ageLabel(offer.publishedAt ?? offer.firstSeenAt)} ·{' '}
            {SOURCE_LABEL[offer.source]}
            {offer.via ? `, via ${offer.via}` : ''}
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

        <section aria-label="Brief de l’offre" className="rounded-md border border-line bg-surface">
          {analysis ? (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                <span
                  className={`inline-flex h-9 min-w-12 items-center justify-center rounded-md border px-2 text-base font-semibold ${TONE_CLASS[scoreTone(offer.score)]}`}
                >
                  {offer.score}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 font-semibold">
                    Compatibilité {offer.score} / 100 · {VERDICT_LABEL[analysis.verdict]}
                  </p>
                  <p className="m-0 text-[13px] text-muted">{analysis.summary}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-quiet !h-8 !text-[13px]"
                  onClick={() => void analyze(true)}
                  disabled={analyzing}
                >
                  {analyzing ? 'Analyse…' : 'Réanalyser'}
                </button>
              </div>

              {analysis.disqualifier ? (
                <p
                  role="note"
                  className="m-0 border-b border-warn-line bg-warn-bg px-4 py-2.5 text-warn-ink"
                >
                  <strong>Offre écartée :</strong> {analysis.disqualifier}
                </p>
              ) : null}

              <dl className="m-0 grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2">
                <Brief label="L’entreprise">
                  {analysis.brief.company ?? (
                    <span className="text-muted">Non précisé dans l’offre.</span>
                  )}
                </Brief>
                <Brief label="Profil recherché">
                  {analysis.brief.wantedProfile ?? (
                    <span className="text-muted">Non précisé dans l’offre.</span>
                  )}
                </Brief>
                <Brief label="Stack demandée">
                  {analysis.brief.stack.length > 0 ? (
                    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                      {analysis.brief.stack.map((tech) => (
                        <li
                          key={tech}
                          className="rounded border border-line-strong px-2 py-0.5 text-[13px]"
                        >
                          {tech}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted">Non précisée dans l’offre.</span>
                  )}
                </Brief>
                <Brief label="Rythme">
                  {analysis.brief.rhythm ?? <span className="text-muted">Non précisé.</span>}
                </Brief>
              </dl>

              {analysis.strengths.length > 0 || analysis.gaps.length > 0 ? (
                <div className="grid gap-x-6 gap-y-3 border-t border-line px-4 py-3 sm:grid-cols-2">
                  <div>
                    <h3 className="m-0 mb-1 text-xs font-medium text-muted">Points forts</h3>
                    <ul className="m-0 pl-[18px]">
                      {analysis.strengths.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="m-0 mb-1 text-xs font-medium text-muted">À vérifier</h3>
                    <ul className="m-0 pl-[18px]">
                      {analysis.gaps.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              {analyzing ? (
                <p role="status" className="m-0 text-muted">
                  Analyse de l’offre par l’IA en cours…
                </p>
              ) : (
                <p className="m-0 text-muted">Cette offre n’a pas encore été analysée.</p>
              )}
              {!analyzing ? (
                <button
                  type="button"
                  className="btn btn-quiet !h-8 !text-[13px]"
                  onClick={() => void analyze(false)}
                >
                  Analyser
                </button>
              ) : null}
            </div>
          )}
          {analysisError ? (
            <p role="alert" className="m-0 border-t border-line px-4 py-2.5 text-danger">
              {analysisError}
            </p>
          ) : null}
        </section>

        {offer.description ? (
          <details className="rounded-md border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-semibold">
              Texte de l’annonce
            </summary>
            <p className="m-0 max-h-80 overflow-y-auto px-4 pb-3 text-[13px] leading-relaxed whitespace-pre-line text-muted">
              {offer.description}
            </p>
          </details>
        ) : null}

        {application === null ? (
          <div className="rounded-md border border-line bg-surface p-6">
            <h3 className="m-0 text-base font-semibold">Pas encore de lettre</h3>
            <p className="mt-1.5 mb-4 text-muted">
              La lettre est écrite à partir de ton profil et de cette offre uniquement, puis
              vérifiée par des garde-fous. Tu la relis et la modifies avant toute validation.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void generate()}
                disabled={busy !== null}
              >
                {busy === 'generate' ? 'Génération en cours…' : 'Générer la lettre'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void applyWithoutLetter()}
                disabled={busy !== null}
              >
                {busy === 'apply' ? 'Enregistrement…' : 'Postuler sans lettre'}
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => void reject()}
                disabled={busy !== null}
              >
                {busy === 'reject' ? 'Rejet…' : 'Rejeter'}
              </button>
            </div>
            <p className="mt-3 mb-0 text-[13px] text-muted">
              <strong>Postuler sans lettre</strong> : à utiliser une fois ta candidature faite sur
              le site ou par mail ; l’offre passe dans le Suivi comme « Envoyée ». Airpost n’envoie
              rien. <strong>Rejeter</strong> : l’offre va dans « Rejetées » et reste restaurable 7
              jours.
            </p>
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
                    onClick={() => void copyLetter()}
                    disabled={body.trim() === ''}
                  >
                    {copied ? 'Copié' : 'Copier'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet !h-8 !text-[13px]"
                    onClick={() => void downloadLetter()}
                    disabled={exporting || body.trim() === ''}
                  >
                    {exporting ? 'Préparation…' : 'Télécharger en PDF'}
                  </button>
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
                className="block min-h-[320px] w-full max-w-[72ch] resize-y rounded-b-md border-0 bg-transparent px-8 py-6 font-serif text-base leading-[1.65]"

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
        <div className="flex flex-wrap items-center justify-between gap-3 sticky bottom-0 border-t border-line bg-paper px-8 py-4">
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
