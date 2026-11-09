import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiError, type ApiIssue, api } from '../../api/client';
import {
  type Profile,
  type ProfileForm,
  CONTRACTS,
  RHYTHMS,
  emptyForm,
  toForm,
  toPayload,
} from './profileForm';

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 mb-0 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5">
      <div>
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        {hint ? <p className="mt-1 mb-0 text-[13px] text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

const input = 'field !h-10 !text-sm';

export function ProfilePage() {
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ApiIssue[]>([]);

  useEffect(() => {
    let cancelled = false;
    api<Profile>('GET', '/profile')
      .then((profile) => !cancelled && setForm(toForm(profile)))
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setIsNew(true);
          setForm(emptyForm());
        } else {
          setLoadError('Impossible de charger le profil. Vérifie que le serveur est démarré.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <p role="alert" className="m-8 text-danger">
        {loadError}
      </p>
    );
  }
  if (!form) {
    return (
      <p role="status" className="m-8 text-muted">
        Chargement…
      </p>
    );
  }

  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setForm({ ...form, [key]: value });
    setSaved(false);
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setIssues([]);
    try {
      const profile = await api<Profile>('PUT', '/profile', toPayload(form));
      setForm(toForm(profile));
      setIsNew(false);
      setSaved(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 400) {
        setError('Certains champs ne sont pas valides :');
        setIssues(caught.issues);
      } else {
        setError('L’enregistrement a échoué. Réessaie.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex max-w-[860px] flex-col gap-4 px-8 pt-5 pb-8"
      noValidate
    >
      <div>
        <h1 className="m-0 text-[22px] leading-tight font-semibold">Profil</h1>
        <p className="mt-1.5 mb-0 text-muted">
          {isNew
            ? 'Renseigne ton profil pour noter les offres et générer des lettres.'
            : 'Ce que le score et les lettres savent de toi. Les lettres ne citent que ce qui est écrit ici.'}
        </p>
      </div>

      <Section
        title="Identité"
        hint="L’adresse e-mail et le téléphone n’apparaissent dans les lettres que s’ils sont renseignés. Aucune adresse complète : la ville et le code postal suffisent."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="firstName" label="Prénom">
            <input
              id="firstName"
              className={input}
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
              autoComplete="given-name"
            />
          </Field>
          <Field id="lastName" label="Nom">
            <input
              id="lastName"
              className={input}
              value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)}
              autoComplete="family-name"
            />
          </Field>
          <Field id="email" label="E-mail de signature (facultatif)">
            <input
              id="email"
              type="email"
              className={input}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              autoComplete="email"
            />
          </Field>
          <Field id="phone" label="Téléphone (facultatif)">
            <input
              id="phone"
              type="tel"
              className={input}
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              autoComplete="tel"
            />
          </Field>
          <Field id="city" label="Ville">
            <input
              id="city"
              className={input}
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
            />
          </Field>
          <Field id="postcode" label="Code postal" hint="Sert à estimer les trajets.">
            <input
              id="postcode"
              inputMode="numeric"
              maxLength={5}
              className={input}
              value={form.postcode}
              onChange={(e) => set('postcode', e.target.value)}
            />
          </Field>
          <Field id="websiteUrl" label="Site ou portfolio (https, facultatif)">
            <input
              id="websiteUrl"
              type="url"
              className={input}
              value={form.websiteUrl}
              onChange={(e) => set('websiteUrl', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Présentation">
        <Field id="headline" label="Titre">
          <input
            id="headline"
            className={input}
            value={form.headline}
            onChange={(e) => set('headline', e.target.value)}
            maxLength={160}
          />
        </Field>
        <Field
          id="summary"
          label="Résumé"
          hint={`${form.summary.length} / 1000 caractères. Formation, projets : tout ce que les lettres peuvent citer.`}
        >
          <textarea
            id="summary"
            rows={6}
            maxLength={1000}
            className="field !h-auto py-2 !text-sm"
            value={form.summary}
            onChange={(e) => set('summary', e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Formation">
        {form.education.map((item, index) => (
          <div
            key={index}
            className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_90px_90px_auto]"
          >
            <Field id={`edu-school-${index}`} label="École">
              <input
                id={`edu-school-${index}`}
                className={input}
                value={item.school}
                onChange={(e) =>
                  set(
                    'education',
                    form.education.map((x, i) =>
                      i === index ? { ...x, school: e.target.value } : x,
                    ),
                  )
                }
              />
            </Field>
            <Field id={`edu-degree-${index}`} label="Diplôme">
              <input
                id={`edu-degree-${index}`}
                className={input}
                value={item.degree}
                onChange={(e) =>
                  set(
                    'education',
                    form.education.map((x, i) =>
                      i === index ? { ...x, degree: e.target.value } : x,
                    ),
                  )
                }
              />
            </Field>
            <Field id={`edu-start-${index}`} label="Début">
              <input
                id={`edu-start-${index}`}
                inputMode="numeric"
                className={input}
                value={item.startYear}
                onChange={(e) =>
                  set(
                    'education',
                    form.education.map((x, i) =>
                      i === index ? { ...x, startYear: e.target.value } : x,
                    ),
                  )
                }
              />
            </Field>
            <Field id={`edu-end-${index}`} label="Fin">
              <input
                id={`edu-end-${index}`}
                inputMode="numeric"
                className={input}
                placeholder="en cours"
                value={item.endYear}
                onChange={(e) =>
                  set(
                    'education',
                    form.education.map((x, i) =>
                      i === index ? { ...x, endYear: e.target.value } : x,
                    ),
                  )
                }
              />
            </Field>
            <button
              type="button"
              className="btn btn-quiet !h-10"
              onClick={() =>
                set(
                  'education',
                  form.education.filter((_, i) => i !== index),
                )
              }
            >
              Retirer
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn self-start"
          onClick={() =>
            set('education', [
              ...form.education,
              { school: '', degree: '', startYear: '', endYear: '' },
            ])
          }
        >
          Ajouter une formation
        </button>
      </Section>

      <Section
        title="Expériences"
        hint="Une réalisation par ligne, chiffrée si possible. N’écris que des faits que tu peux expliquer à l’oral : les lettres s’appuient uniquement dessus."
      >
        {form.experiences.map((item, index) => {
          const update = (patch: Partial<typeof item>) =>
            set(
              'experiences',
              form.experiences.map((x, i) => (i === index ? { ...x, ...patch } : x)),
            );
          return (
            <div key={index} className="flex flex-col gap-3 rounded-md border border-line p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field id={`exp-company-${index}`} label="Entreprise">
                  <input
                    id={`exp-company-${index}`}
                    className={input}
                    value={item.company}
                    onChange={(e) => update({ company: e.target.value })}
                  />
                </Field>
                <Field id={`exp-role-${index}`} label="Poste">
                  <input
                    id={`exp-role-${index}`}
                    className={input}
                    value={item.role}
                    onChange={(e) => update({ role: e.target.value })}
                  />
                </Field>
                <Field id={`exp-start-${index}`} label="Début (AAAA-MM)">
                  <input
                    id={`exp-start-${index}`}
                    placeholder="2025-09"
                    className={input}
                    value={item.startDate}
                    onChange={(e) => update({ startDate: e.target.value })}
                  />
                </Field>
                <Field id={`exp-end-${index}`} label="Fin (AAAA-MM, vide si en cours)">
                  <input
                    id={`exp-end-${index}`}
                    placeholder="2025-12"
                    className={input}
                    value={item.endDate}
                    onChange={(e) => update({ endDate: e.target.value })}
                  />
                </Field>
              </div>
              <Field id={`exp-ach-${index}`} label="Réalisations (une par ligne)">
                <textarea
                  id={`exp-ach-${index}`}
                  rows={4}
                  className="field !h-auto py-2 !text-sm"
                  value={item.achievements}
                  onChange={(e) => update({ achievements: e.target.value })}
                />
              </Field>
              <button
                type="button"
                className="btn btn-quiet self-start"
                onClick={() =>
                  set(
                    'experiences',
                    form.experiences.filter((_, i) => i !== index),
                  )
                }
              >
                Retirer cette expérience
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="btn self-start"
          onClick={() =>
            set('experiences', [
              ...form.experiences,
              { company: '', role: '', startDate: '', endDate: '', achievements: '' },
            ])
          }
        >
          Ajouter une expérience
        </button>
      </Section>

      <Section title="Compétences" hint="Sépare par des virgules.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="languages" label="Langages">
            <input
              id="languages"
              className={input}
              value={form.languages}
              onChange={(e) => set('languages', e.target.value)}
            />
          </Field>
          <Field id="frameworks" label="Frameworks">
            <input
              id="frameworks"
              className={input}
              value={form.frameworks}
              onChange={(e) => set('frameworks', e.target.value)}
            />
          </Field>
          <Field id="tools" label="Outils">
            <input
              id="tools"
              className={input}
              value={form.tools}
              onChange={(e) => set('tools', e.target.value)}
            />
          </Field>
          <Field id="other" label="Autres">
            <input
              id="other"
              className={input}
              value={form.other}
              onChange={(e) => set('other', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Recherche">
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-1 text-xs font-medium text-muted">Contrats recherchés</legend>
          <div className="flex gap-6">
            {CONTRACTS.map((contract) => (
              <label key={contract.id} className="flex min-h-8 items-center gap-3">
                <input
                  type="checkbox"
                  className="h-[18px] w-[18px] accent-accent"
                  checked={form.contracts.includes(contract.id)}
                  onChange={(e) =>
                    set(
                      'contracts',
                      e.target.checked
                        ? [...form.contracts, contract.id]
                        : form.contracts.filter((c) => c !== contract.id),
                    )
                  }
                />
                {contract.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-1 text-xs font-medium text-muted">
            Rythmes d’alternance acceptés
          </legend>
          <div className="flex flex-col gap-1">
            {RHYTHMS.map((rhythm) => (
              <label key={rhythm.id} className="flex min-h-8 items-center gap-3">
                <input
                  type="checkbox"
                  className="h-[18px] w-[18px] accent-accent"
                  checked={form.rhythms.includes(rhythm.id)}
                  onChange={(e) =>
                    set(
                      'rhythms',
                      e.target.checked
                        ? [...form.rhythms, rhythm.id]
                        : form.rhythms.filter((r) => r !== rhythm.id),
                    )
                  }
                />
                {rhythm.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="startDate" label="Début souhaité" hint="« asap » ou une date AAAA-MM-JJ.">
            <input
              id="startDate"
              className={input}
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
          </Field>
          <Field id="maxCommuteMinutes" label="Trajet maximum (minutes)">
            <input
              id="maxCommuteMinutes"
              inputMode="numeric"
              className={input}
              value={form.maxCommuteMinutes}
              onChange={(e) => set('maxCommuteMinutes', e.target.value)}
            />
          </Field>
          <Field
            id="keywords"
            label="Mots-clés recherchés"
            hint="Utilisés pour noter la correspondance avec la stack de l’offre."
          >
            <input
              id="keywords"
              className={input}
              value={form.keywords}
              onChange={(e) => set('keywords', e.target.value)}
            />
          </Field>
          <Field
            id="romeCodes"
            label="Codes ROME"
            hint="M1805 : études et développement informatique."
          >
            <input
              id="romeCodes"
              className={input}
              value={form.romeCodes}
              onChange={(e) => set('romeCodes', e.target.value)}
            />
          </Field>
          <Field id="excludedCompanies" label="Entreprises à exclure">
            <input
              id="excludedCompanies"
              className={input}
              value={form.excludedCompanies}
              onChange={(e) => set('excludedCompanies', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-danger-line bg-danger-bg px-4 py-3 text-danger"
        >
          <p className="m-0 font-semibold">{error}</p>
          {issues.length > 0 ? (
            <ul className="mt-1 mb-0 pl-[18px]">
              {issues.map((issue) => (
                <li key={`${issue.champ}-${issue.probleme}`}>
                  <code>{issue.champ || 'profil'}</code> : {issue.probleme}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-line bg-paper py-3">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer le profil'}
        </button>
        {saved ? (
          <span role="status" className="text-[13px] font-medium text-ok">
            Profil enregistré. Les prochaines notes et lettres l’utilisent.
          </span>
        ) : null}
      </div>
    </form>
  );
}
