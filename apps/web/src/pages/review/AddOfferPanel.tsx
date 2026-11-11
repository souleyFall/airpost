import { useState } from 'react';
import { ApiError, api } from '../../api/client';

interface Extracted {
  title: string;
  company: string | null;
  city: string | null;
  contactEmail: string | null;
}

interface Created {
  id: string;
  created: boolean;
  analyzed: boolean;
}

interface Props {
  /** L'offre est enregistrée (ou existait déjà) : l'écran l'ouvre. */
  onAdded: (id: string, message: string) => void;
  onCancel: () => void;
}

const MIN_TEXT = 80;

function extractError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429)
      return 'Quota du modèle atteint : remplis les champs toi-même, ou réessaie dans quelques minutes.';
    if (error.status === 503)
      return 'Lecture automatique indisponible (clé Gemini à vérifier) : remplis les champs toi-même.';
    if (error.status === 400) return error.message;
    if (error.status === 502)
      return 'Gemini est momentanément indisponible : réessaie la lecture dans quelques secondes, ou remplis les champs toi-même.';
  }
  return 'La lecture automatique a échoué : réessaie, ou remplis les champs toi-même.';
}

/**
 * Ajout d'une offre vue ailleurs (LinkedIn, Indeed, Welcome to the Jungle, site d'entreprise) : tu colles le texte de
 * l'annonce et, si tu veux, son lien. airpost n'ouvre jamais le lien : il le garde pour que tu retrouves l'annonce.
 */
export function AddOfferPanel({ onAdded, onCancel }: Props) {
  const [step, setStep] = useState<'paste' | 'check'>('paste');
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [city, setCity] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [busy, setBusy] = useState<null | 'extract' | 'create'>(null);
  const [error, setError] = useState<string | null>(null);
  // La lecture automatique a échoué : on propose de la relancer sans tout recoller.
  const [readFailed, setReadFailed] = useState(false);

  const textOk = text.trim().length >= MIN_TEXT;

  async function read() {
    setBusy('extract');
    setError(null);
    setReadFailed(false);
    try {
      const fields = await api<Extracted>('POST', '/offers/manual/extract', { text });
      setTitle(fields.title);
      setCompany(fields.company ?? '');
      setCity(fields.city ?? '');
      setContactEmail(fields.contactEmail ?? '');
    } catch (caught) {
      setError(extractError(caught));
      setReadFailed(true);
    } finally {
      setBusy(null);
      setStep('check');
    }
  }

  async function add() {
    setBusy('create');
    setError(null);
    try {
      const result = await api<Created>('POST', '/offers/manual', {
        text,
        title,
        company,
        city: city.trim() || null,
        contactEmail: contactEmail.trim() || null,
        applyUrl: link.trim() || null,
      });
      onAdded(
        result.id,
        !result.created
          ? 'Cette offre était déjà dans ta liste : la voici.'
          : result.analyzed
            ? 'Offre ajoutée et analysée.'
            : 'Offre ajoutée. L’analyse se fera plus tard (quota du modèle).',
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : 'L’offre n’a pas pu être ajoutée.',
      );
      setBusy(null);
    }
  }

  return (
    <section aria-label="Ajouter une offre" className="flex flex-col gap-4 px-8 py-6">
      <header>
        <h2 className="m-0 text-[22px] leading-tight font-semibold">Ajouter une offre</h2>
        <p className="mt-1.5 mb-0 max-w-[72ch] text-muted">
          Copie le texte de l’annonce depuis sa page (LinkedIn, Indeed, Welcome to the Jungle, site
          d’entreprise) et colle-le ici. airpost n’ouvre jamais le lien : il le garde seulement pour
          que tu retrouves l’annonce.
        </p>
      </header>

      {step === 'paste' ? (
        <>
          <div>
            <label htmlFor="add-text" className="mb-1 block text-xs font-medium text-muted">
              Texte de l’annonce
            </label>
            <textarea
              id="add-text"
              className="block min-h-[240px] w-full resize-y rounded-md border border-line bg-surface px-4 py-3 text-sm leading-relaxed"

              maxLength={20_000}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            {!textOk && text.length > 0 ? (
              <p className="mt-1 mb-0 text-xs text-muted">
                Colle le texte complet de l’annonce ({MIN_TEXT} caractères au moins).
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="add-link" className="mb-1 block text-xs font-medium text-muted">
              Lien de l’annonce (facultatif)
            </label>
            <input
              id="add-link"
              className="field !h-10 !text-sm"
              type="url"
              inputMode="url"
              placeholder="https://…"
              maxLength={2_000}
              value={link}
              onChange={(event) => setLink(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!textOk || busy !== null}
              onClick={() => void read()}
            >
              {busy === 'extract' ? 'Lecture…' : 'Lire l’annonce'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!textOk || busy !== null}
              onClick={() => setStep('check')}
            >
              Remplir moi-même
            </button>
            <button type="button" className="btn btn-quiet" onClick={onCancel}>
              Annuler
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-[13px] text-muted">
            Vérifie et corrige si besoin. Le texte collé devient la description de l’offre.
          </p>
          {[
            { id: 'add-title', label: 'Intitulé du poste', value: title, set: setTitle, max: 200 },
            { id: 'add-company', label: 'Entreprise', value: company, set: setCompany, max: 200 },
            { id: 'add-city', label: 'Ville (facultatif)', value: city, set: setCity, max: 80 },
            {
              id: 'add-email',
              label: 'E-mail de contact (facultatif)',
              value: contactEmail,
              set: setContactEmail,
              max: 254,
            },
          ].map((field) => (
            <div key={field.id}>
              <label htmlFor={field.id} className="mb-1 block text-xs font-medium text-muted">
                {field.label}
              </label>
              <input
                id={field.id}
                className="field !h-10 !text-sm"
                type={field.id === 'add-email' ? 'email' : 'text'}
                maxLength={field.max}
                value={field.value}
                onChange={(event) => field.set(event.target.value)}
              />
            </div>
          ))}
          {readFailed ? (
            <div>
              <button
                type="button"
                className="btn"
                disabled={busy !== null}
                onClick={() => void read()}
              >
                {busy === 'extract' ? 'Lecture…' : 'Réessayer la lecture automatique'}
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={title.trim().length < 2 || company.trim() === '' || busy !== null}
              onClick={() => void add()}
            >
              {busy === 'create' ? 'Ajout et analyse…' : 'Ajouter l’offre'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() => {
                setError(null);
                setStep('paste');
              }}
            >
              Retour au texte
            </button>
            <button type="button" className="btn btn-quiet" onClick={onCancel}>
              Annuler
            </button>
          </div>
        </>
      )}

      {error ? (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
