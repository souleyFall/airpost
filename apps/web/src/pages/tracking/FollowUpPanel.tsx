import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../api/client';
import type { FollowUpResult } from '../../api/types';
import { hasPlaceholder, wordCount } from '../../lib/format';

interface Props {
  applicationId: string;
  company: string;
  /** Gmail est-il configuré ? Sinon seul « Copier » est proposé. */
  gmailReady: boolean;
  /** Après une relance enregistrée (brouillon créé, ou déclarée faite) : le suivi se recharge. */
  onDone: (message: string) => void;
  onClose: () => void;
}

function generationError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Quota du modèle atteint : réessaie dans quelques minutes.';
    if (error.status === 503)
      return 'Rédaction indisponible : la clé Gemini est à vérifier (page Sources).';
    if (error.status === 422)
      return 'Le message généré ne respecte pas les garde-fous. Régénère-le.';
    if (error.status === 409)
      return 'Cette candidature ne peut plus être relancée : recharge la page.';
    if (error.status === 400) return error.message;
  }
  return 'La rédaction a échoué.';
}

/**
 * Relance d'une candidature restée sans réponse : le message est rédigé, tu le relis et le modifies, puis tu en fais
 * un brouillon Gmail (ou tu le copies). Rien n'est jamais envoyé par airpost. Une seule relance par candidature.
 */
export function FollowUpPanel({ applicationId, company, gmailReady, onDone, onClose }: Props) {
  const [draft, setDraft] = useState<FollowUpResult | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<null | 'generate' | 'draft' | 'done'>('generate');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const generate = useCallback(async () => {
    setBusy('generate');
    setError(null);
    try {
      const result = await api<FollowUpResult>('POST', `/applications/${applicationId}/follow-up`);
      if (!mounted.current) return;
      setDraft(result);
      setSubject(result.subject);
      setBody(result.body);
    } catch (caught) {
      if (mounted.current) setError(generationError(caught));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [applicationId]);

  useEffect(() => {
    void generate();
  }, [generate]);

  /** Message complet tel qu'il partirait : ton texte (modifié ou non) + la formule de politesse et la signature du serveur. */
  function fullText(): string {
    const signature = draft ? draft.preview.slice(draft.body.trim().length) : '';
    return `${body.trim()}${signature}`;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${fullText()}`);
      setCopied(true);
      setTimeout(() => mounted.current && setCopied(false), 2000);
    } catch {
      setError('Copie impossible : sélectionne le texte et copie-le à la main.');
    }
  }

  async function createDraft() {
    setBusy('draft');
    setError(null);
    try {
      await api('POST', `/applications/${applicationId}/follow-up/draft`, { subject, body });
      onDone(
        `Brouillon de relance créé dans Gmail pour ${company}. Relis-le puis envoie-le toi-même depuis Gmail.`,
      );
    } catch (caught) {
      if (!mounted.current) return;
      setError(
        caught instanceof ApiError && caught.status === 503
          ? 'Gmail n’est pas disponible : reconnecte Gmail puis réessaie.'
          : caught instanceof ApiError && caught.status === 429
            ? 'Trop de demandes : réessaie dans une minute.'
            : caught instanceof ApiError && caught.status === 409
              ? 'Cette candidature ne peut plus être relancée : recharge la page.'
              : caught instanceof ApiError && caught.status === 422
                ? 'Le message contient un repère entre crochets à remplacer.'
                : 'Le brouillon n’a pas pu être créé.',
      );
      setBusy(null);
    }
  }

  async function alreadyDone() {
    setBusy('done');
    setError(null);
    try {
      await api('POST', `/applications/${applicationId}/follow-up/done`);
      onDone(`Relance de ${company} notée comme faite.`);
    } catch {
      if (!mounted.current) return;
      setError('Le changement a échoué : recharge la page.');
      setBusy(null);
    }
  }

  const words = wordCount(body);
  const placeholder = hasPlaceholder(body) || hasPlaceholder(subject);
  const canDraft =
    draft !== null &&
    busy === null &&
    body.trim().length >= 20 &&
    subject.trim() !== '' &&
    !placeholder;

  return (
    <section
      aria-label={`Relance de ${company}`}
      className="flex flex-col gap-3 border-t border-line bg-paper px-4 py-4"
    >
      {busy === 'generate' ? (
        <p role="status" className="m-0 text-muted">
          Rédaction de la relance…
        </p>
      ) : null}

      {draft ? (
        <>
          <p className="m-0 text-[13px] text-muted">
            Une seule relance par candidature. Relis, modifie, puis crée le brouillon : tu l’envoies
            toi-même depuis Gmail. Ta signature et tes coordonnées sont ajoutées automatiquement.
          </p>
          {draft.warnings.length > 0 || placeholder ? (
            <div
              role="note"
              className="rounded-md border border-warn-line bg-warn-bg px-4 py-3 text-warn-ink"
            >
              <p className="m-0 font-semibold">À vérifier avant de continuer</p>
              <ul className="mt-1 mb-0 pl-[18px]">
                {placeholder ? (
                  <li>Le texte contient un repère entre crochets à remplacer.</li>
                ) : null}
                {draft.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {draft.to ? (
            <p className="m-0 text-[13px] text-muted">
              Destinataire : <span className="font-medium text-ink">{draft.to}</span>
            </p>
          ) : null}
          <div>
            <label
              htmlFor={`fu-subject-${applicationId}`}
              className="mb-1 block text-xs font-medium text-muted"
            >
              Objet
            </label>
            <input
              id={`fu-subject-${applicationId}`}
              className="field !h-10 !text-sm"
              type="text"
              maxLength={120}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label
                htmlFor={`fu-body-${applicationId}`}
                className="text-xs font-medium text-muted"
              >
                Message
              </label>
              <span className="text-xs text-muted" aria-live="polite">
                {words} mots
              </span>
            </div>
            <textarea
              id={`fu-body-${applicationId}`}
              className="block min-h-[200px] w-full max-w-[72ch] resize-y rounded-md border border-line bg-surface px-4 py-3 font-serif text-base leading-[1.6]"

              maxLength={1500}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
        </>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {draft ? (
          <>
            {gmailReady ? (
              <button
                type="button"
                className="btn btn-primary !h-8 !text-[13px]"
                disabled={!canDraft}
                onClick={() => void createDraft()}
              >
                {busy === 'draft' ? 'Création…' : 'Créer le brouillon Gmail'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn !h-8 !text-[13px]"
              disabled={body.trim() === ''}
              onClick={() => void copy()}
            >
              {copied ? 'Copié' : 'Copier'}
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="btn btn-quiet !h-8 !text-[13px]"
          disabled={busy !== null}
          onClick={() => void generate()}
        >
          {draft ? 'Régénérer' : 'Réessayer'}
        </button>
        <button
          type="button"
          className="btn btn-quiet !h-8 !text-[13px]"
          disabled={busy !== null}
          onClick={() => void alreadyDone()}
        >
          {busy === 'done' ? 'Enregistrement…' : 'J’ai déjà relancé autrement'}
        </button>
        <button type="button" className="btn btn-quiet !h-8 !text-[13px]" onClick={onClose}>
          Fermer
        </button>
      </div>
    </section>
  );
}
