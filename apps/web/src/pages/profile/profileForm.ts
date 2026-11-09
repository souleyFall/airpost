/**
 * Conversion entre le profil de l'API et l'état du formulaire (tout en texte, pour la saisie).
 * La validation de fond reste celle de l'API (apps/api/src/profile/profile.schema.ts) : l'interface
 * affiche ses messages. Ici on ne fait que nettoyer (espaces, champs facultatifs vides omis).
 */
export const RHYTHMS = [
  { id: '1S_1S', label: '1 semaine / 1 semaine' },
  { id: '2J_3J', label: '2 jours / 3 jours' },
  { id: '3J_2J', label: '3 jours / 2 jours' },
  { id: 'AUTRE', label: 'Autre (3 semaines / 1 semaine, etc.)' },
] as const;

export interface Profile {
  identity: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    city: string;
    postcode: string;
    websiteUrl?: string;
  };
  headline: string;
  summary: string;
  education: { school: string; degree: string; startYear: number; endYear?: number }[];
  experiences: {
    company: string;
    role: string;
    startDate: string;
    endDate?: string;
    achievements: string[];
  }[];
  skills: { languages: string[]; frameworks: string[]; tools: string[]; other: string[] };
  search: {
    rhythms: string[];
    startDate: string;
    maxCommuteMinutes: number;
    keywords: string[];
    romeCodes: string[];
    excludedCompanies: string[];
  };
}

export interface ProfileForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  postcode: string;
  websiteUrl: string;
  headline: string;
  summary: string;
  education: { school: string; degree: string; startYear: string; endYear: string }[];
  experiences: {
    company: string;
    role: string;
    startDate: string;
    endDate: string;
    /** Une réalisation par ligne. */
    achievements: string;
  }[];
  languages: string;
  frameworks: string;
  tools: string;
  other: string;
  rhythms: string[];
  startDate: string;
  maxCommuteMinutes: string;
  keywords: string;
  romeCodes: string;
  excludedCompanies: string;
}

export const emptyForm = (): ProfileForm => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  city: '',
  postcode: '',
  websiteUrl: '',
  headline: '',
  summary: '',
  education: [],
  experiences: [],
  languages: '',
  frameworks: '',
  tools: '',
  other: '',
  rhythms: [],
  startDate: 'asap',
  maxCommuteMinutes: '60',
  keywords: '',
  romeCodes: 'M1805',
  excludedCompanies: '',
});

const join = (items: string[]) => items.join(', ');
/** « a, b ,, c » -> ['a', 'b', 'c'] */
export const splitList = (text: string): string[] =>
  text
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

export function toForm(profile: Profile): ProfileForm {
  return {
    firstName: profile.identity.firstName,
    lastName: profile.identity.lastName,
    email: profile.identity.email ?? '',
    phone: profile.identity.phone ?? '',
    city: profile.identity.city,
    postcode: profile.identity.postcode,
    websiteUrl: profile.identity.websiteUrl ?? '',
    headline: profile.headline,
    summary: profile.summary,
    education: profile.education.map((e) => ({
      school: e.school,
      degree: e.degree,
      startYear: String(e.startYear),
      endYear: e.endYear === undefined ? '' : String(e.endYear),
    })),
    experiences: profile.experiences.map((e) => ({
      company: e.company,
      role: e.role,
      startDate: e.startDate,
      endDate: e.endDate ?? '',
      achievements: e.achievements.join('\n'),
    })),
    languages: join(profile.skills.languages),
    frameworks: join(profile.skills.frameworks),
    tools: join(profile.skills.tools),
    other: join(profile.skills.other),
    rhythms: profile.search.rhythms,
    startDate: profile.search.startDate,
    maxCommuteMinutes: String(profile.search.maxCommuteMinutes),
    keywords: join(profile.search.keywords),
    romeCodes: join(profile.search.romeCodes),
    excludedCompanies: join(profile.search.excludedCompanies),
  };
}

const optional = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};
/** Nombre saisi ; une saisie illisible reste NaN, que l'API refusera avec un message clair. */
const toNumber = (value: string): number => Number(value.trim());

export function toPayload(form: ProfileForm): Profile {
  return {
    identity: {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      ...(optional(form.email) ? { email: optional(form.email) } : {}),
      ...(optional(form.phone) ? { phone: optional(form.phone) } : {}),
      city: form.city.trim(),
      postcode: form.postcode.trim(),
      ...(optional(form.websiteUrl) ? { websiteUrl: optional(form.websiteUrl) } : {}),
    },
    headline: form.headline.trim(),
    summary: form.summary.trim(),
    education: form.education.map((e) => ({
      school: e.school.trim(),
      degree: e.degree.trim(),
      startYear: toNumber(e.startYear),
      ...(optional(e.endYear) ? { endYear: toNumber(e.endYear) } : {}),
    })),
    experiences: form.experiences.map((e) => ({
      company: e.company.trim(),
      role: e.role.trim(),
      startDate: e.startDate.trim(),
      ...(optional(e.endDate) ? { endDate: e.endDate.trim() } : {}),
      achievements: e.achievements
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    })),
    skills: {
      languages: splitList(form.languages),
      frameworks: splitList(form.frameworks),
      tools: splitList(form.tools),
      other: splitList(form.other),
    },
    search: {
      rhythms: form.rhythms,
      startDate: form.startDate.trim() || 'asap',
      maxCommuteMinutes: toNumber(form.maxCommuteMinutes),
      keywords: splitList(form.keywords),
      romeCodes: splitList(form.romeCodes).map((code) => code.toUpperCase()),
      excludedCompanies: splitList(form.excludedCompanies),
    },
  };
}
