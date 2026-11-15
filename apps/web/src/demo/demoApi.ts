/**
 * Faux serveur de la démo : il répond à la place de l'API, en mémoire, avec des données fictives (fixtures.ts).
 * AUCUNE requête réseau ne part d'ici : la démo ne peut ni appeler d'API, ni consommer de quota, ni toucher à des
 * données réelles. Tout est perdu au rechargement de la page (la démo repart de zéro).
 * Les textes « générés » (lettre, relance, lecture d'annonce) sont préparés : l'IA est simulée.
 */
import { ApiError } from '../api/client';
import type {
  ApiHealthItem,
  ApplicationRow,
  ApplicationStatus,
  FollowUpResult,
  FollowUpState,
  FullRunReport,
  OfferSource,
  Stats,
  SyncReport,
} from '../api/types';
import {
  DEMO_PROFILE,
  type DemoApplication,
  type DemoOffer,
  applications as makeApplications,
  arrivingOffers,
  daysAgo,
  followUpBody,
  letterBody,
  pendingOffers,
} from './fixtures';

const DAY = 86_400_000;

/** Pause qui laisse sentir un traitement (l'IA, la collecte). 0 dans les tests. */
let delayScale = 1;
export function setDemoDelayScale(scale: number): void {
  delayScale = scale;
}
const pause = (ms: number) =>
  delayScale === 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, ms * delayScale));

interface State {
  offers: DemoOffer[];
  applications: DemoApplication[];
  profile: typeof DEMO_PROFILE;
  collected: boolean;
  counter: number;
}

let state: State = freshState();

function freshState(): State {
  return {
    offers: pendingOffers(),
    applications: makeApplications(),
    profile: structuredClone(DEMO_PROFILE),
    collected: false,
    counter: 0,
  };
}

/** Remet la démo à son état de départ (tests, bouton « Recommencer »). */
export function resetDemo(): void {
  state = freshState();
}

const nextId = (prefix: string) => `${prefix}${(state.counter += 1)}`;

// ---------- règles reprises du vrai serveur, en version courte ----------

const FOLLOW_UP_STATUSES: ApplicationStatus[] = ['APPLIED', 'ACKNOWLEDGED', 'NO_RESPONSE'];

function followUpState(app: DemoApplication, now = Date.now()): FollowUpState {
  if (!FOLLOW_UP_STATUSES.includes(app.status)) return null;
  const days = (from: string) => (now - new Date(from).getTime()) / DAY;
  if (app.followedUpAt) {
    return app.status !== 'NO_RESPONSE' && days(app.followedUpAt) >= 10 ? 'give_up' : 'done';
  }
  if (!app.appliedAt) return null;
  const lastReply = app.replies.reduce<string | null>(
    (latest, r) => (latest === null || r.receivedAt > latest ? r.receivedAt : latest),
    null,
  );
  const lastContact = lastReply && lastReply > app.appliedAt ? lastReply : app.appliedAt;
  const d = days(lastContact);
  return d >= 8 && d <= 30 ? 'due' : null;
}

const MANUAL_NEXT: Record<ApplicationStatus, ApplicationStatus[]> = {
  TO_REVIEW: ['VALIDATED', 'WITHDRAWN'],
  VALIDATED: ['TO_REVIEW', 'APPLIED', 'WITHDRAWN'],
  DRAFT_CREATED: ['VALIDATED', 'APPLIED', 'WITHDRAWN'],
  APPLIED: ['ACKNOWLEDGED', 'INTERVIEW', 'REJECTED', 'NO_RESPONSE', 'WITHDRAWN'],
  ACKNOWLEDGED: ['INTERVIEW', 'REJECTED', 'NO_RESPONSE', 'WITHDRAWN'],
  INTERVIEW: ['REJECTED', 'WITHDRAWN'],
  NO_RESPONSE: ['ACKNOWLEDGED', 'INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  REJECTED: [],
  WITHDRAWN: [],
};

const applicationOf = (offerId: string) => state.applications.find((a) => a.offer.id === offerId);

function offerSummary(offer: DemoOffer) {
  const application = applicationOf(offer.id);
  return {
    id: offer.id,
    source: offer.source,
    title: offer.title,
    company: offer.company,
    city: offer.city,
    postcode: offer.postcode,
    channel: offer.channel,
    contractType: offer.contractType,
    via: offer.via,
    distanceKm: offer.distanceKm,
    applyUrl: offer.applyUrl,
    publishedAt: offer.publishedAt,
    firstSeenAt: offer.firstSeenAt,
    score: offer.score,
    application: application ? { id: application.id, status: application.status } : null,
  };
}

function offerDetail(offer: DemoOffer) {
  return {
    ...offerSummary(offer),
    description: offer.description,
    contactEmail: offer.contactEmail,
    analysis: offer.analysis,
    analyzedAt: offer.analyzedAt,
    excluded: offer.excluded,
  };
}

function find<T extends { id: string }>(list: T[], id: string, what: string): T {
  const found = list.find((item) => item.id === id);
  if (!found) throw new ApiError(404, `${what} introuvable`);
  return found;
}

/** L'« analyse par l'IA » : révèle l'analyse préparée de l'offre (ou une analyse générique pour une offre ajoutée). */
function analyze(offer: DemoOffer): void {
  if (offer.score !== null) return;
  const prepared = offer.analysisAfter;
  offer.score = prepared?.score ?? 70;
  offer.analysis = prepared?.analysis ?? {
    verdict: 'good',
    summary: 'Offre cohérente avec ton profil, à confirmer en lisant l’annonce complète.',
    disqualifier: null,
    strengths: ['Technologies proches de ton profil'],
    gaps: ['Quelques détails à vérifier dans l’annonce'],
    brief: { company: null, stack: [], wantedProfile: null, rhythm: null },
  };
  offer.analyzedAt = new Date().toISOString();
}

function applicationRow(app: DemoApplication): ApplicationRow {
  return {
    id: app.id,
    status: app.status,
    subject: app.subject,
    validatedAt: app.validatedAt,
    appliedAt: app.appliedAt,
    followedUpAt: app.followedUpAt,
    followUp: followUpState(app),
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    replies: [...app.replies].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    offer: {
      id: app.offer.id,
      source: app.offer.source,
      title: app.offer.title,
      company: app.offer.company,
      city: app.offer.city,
      channel: app.offer.channel,
      applyUrl: app.offer.applyUrl,
      score: app.offer.score,
    },
  };
}

// ---------- tableau de bord (mêmes définitions que le vrai serveur) ----------

function monday(date: Date): Date {
  const day = (date.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day));
}

function computeStats(): Stats {
  const apps = state.applications;
  const sentApps = apps.filter((a) => a.appliedAt !== null);
  const answeredStatuses: ApplicationStatus[] = ['ACKNOWLEDGED', 'INTERVIEW', 'REJECTED'];
  const answered = (a: DemoApplication) =>
    a.replies.length > 0 || answeredStatuses.includes(a.status);
  const interview = (a: DemoApplication) =>
    a.status === 'INTERVIEW' || a.replies.some((r) => r.kind === 'INTERVIEW');
  const rejection = (a: DemoApplication) =>
    a.status === 'REJECTED' || a.replies.some((r) => r.kind === 'REJECTION');

  const delays = sentApps
    .filter((a) => a.replies.length > 0 && a.appliedAt)
    .map((a) => {
      const first = Math.min(...a.replies.map((r) => new Date(r.receivedAt).getTime()));
      return Math.max(0, (first - new Date(a.appliedAt as string).getTime()) / DAY);
    })
    .sort((x, y) => x - y);
  const middle = Math.floor(delays.length / 2);
  const median =
    delays.length === 0
      ? null
      : Math.round(
          (delays.length % 2 === 1
            ? (delays[middle] ?? 0)
            : ((delays[middle - 1] ?? 0) + (delays[middle] ?? 0)) / 2) * 10,
        ) / 10;

  const bySource = new Map<
    OfferSource,
    { source: OfferSource; applied: number; answered: number; interviews: number }
  >();
  for (const a of sentApps) {
    const entry = bySource.get(a.offer.source) ?? {
      source: a.offer.source,
      applied: 0,
      answered: 0,
      interviews: 0,
    };
    entry.applied++;
    if (answered(a)) entry.answered++;
    if (interview(a)) entry.interviews++;
    bySource.set(a.offer.source, entry);
  }

  const currentMonday = monday(new Date());
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(currentMonday.getTime() - (7 - i) * 7 * DAY);
    const end = new Date(start.getTime() + 7 * DAY);
    return {
      weekStart: start.toISOString().slice(0, 10),
      applied: sentApps.filter((a) => {
        const at = new Date(a.appliedAt as string);
        return at >= start && at < end;
      }).length,
    };
  });

  const followed = apps.filter((a) => a.followedUpAt);
  const weekAgo = Date.now() - 7 * DAY;
  const fresh = state.offers.filter((o) => new Date(o.firstSeenAt).getTime() >= weekAgo);
  const freshBySource = new Map<OfferSource, number>();
  for (const o of fresh) freshBySource.set(o.source, (freshBySource.get(o.source) ?? 0) + 1);

  const count = (statuses: ApplicationStatus[]) =>
    apps.filter((a) => statuses.includes(a.status)).length;
  return {
    pipeline: {
      toReview: count(['TO_REVIEW']),
      toSend: count(['VALIDATED', 'DRAFT_CREATED']),
      waiting: count(['APPLIED', 'ACKNOWLEDGED']),
      toFollowUp: apps.filter((a) => followUpState(a) === 'due').length,
    },
    funnel: {
      applied: sentApps.length,
      answered: sentApps.filter(answered).length,
      interviews: sentApps.filter(interview).length,
      rejections: sentApps.filter(rejection).length,
      unanswered: sentApps.length - sentApps.filter(answered).length,
      answerRate: sentApps.length === 0 ? null : sentApps.filter(answered).length / sentApps.length,
      interviewRate:
        sentApps.length === 0 ? null : sentApps.filter(interview).length / sentApps.length,
      medianDaysToFirstReply: median,
    },
    bySource: [...bySource.values()].sort(
      (a, b) => b.applied - a.applied || a.source.localeCompare(b.source),
    ),
    weekly,
    followUps: {
      sent: followed.length,
      answeredAfter: followed.filter((a) =>
        a.replies.some((r) => new Date(r.receivedAt) > new Date(a.followedUpAt as string)),
      ).length,
    },
    offers: {
      total: state.offers.length + 330,
      newThisWeek: fresh.length + 38,
      newThisWeekBySource: [
        { source: 'GLASSDOOR', count: 18 },
        { source: 'INDEED', count: 9 + (state.collected ? 1 : 0) },
        { source: 'LINKEDIN', count: 8 + (state.collected ? 1 : 0) },
        { source: 'GOOGLE_JOBS', count: 6 },
      ],
    },
    smallSample: sentApps.length < 5,
  };
}

// ---------- liste des offres (mêmes filtres que le vrai serveur) ----------

function listOffers(params: URLSearchParams) {
  const limit = Math.min(100, Number(params.get('limit') ?? 20));
  const offset = Number(params.get('offset') ?? 0);
  const sources = params.get('source')?.split(',').filter(Boolean) ?? [];
  const contracts = params.get('contract')?.split(',').filter(Boolean) ?? [];
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const minScore = Number(params.get('minScore') ?? 0);
  const maxDistance = params.get('maxDistanceKm');
  const channel = params.get('channel');
  const pending = params.get('pending') === 'true';
  const sort = params.get('sort') ?? 'score';

  let items = state.offers.filter((o) => {
    if (o.rejectedAt) return false;
    const application = applicationOf(o.id);
    if (pending) {
      if (application && application.status !== 'TO_REVIEW') return false;
      if (o.excluded && !application) return false;
    }
    if (sources.length > 0 && !sources.includes(o.source)) return false;
    if (contracts.length > 0 && !contracts.includes(o.contractType)) return false;
    if (channel && o.channel !== channel) return false;
    if (minScore > 0 && (o.score ?? -1) < minScore) return false;
    if (maxDistance !== null && o.distanceKm !== null && o.distanceKm > Number(maxDistance))
      return false;
    if (q) {
      const haystack = `${o.title} ${o.company} ${o.city ?? ''} ${o.description}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const byDate = (a: DemoOffer, b: DemoOffer) =>
    (b.publishedAt ?? b.firstSeenAt).localeCompare(a.publishedAt ?? a.firstSeenAt);
  items = [...items].sort((a, b) => {
    if (sort === 'distance') {
      return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || byDate(a, b);
    }
    if (sort === 'fresh') return byDate(a, b);
    // Par note : les offres notées d'abord, puis celles sans note de la plus récente à la plus ancienne.
    return (b.score ?? -1) - (a.score ?? -1) || byDate(a, b);
  });
  return {
    total: items.length,
    limit,
    offset,
    items: items.slice(offset, offset + limit).map(offerSummary),
  };
}

// ---------- routes ----------

const FULL_REPORT = (created: number): FullRunReport => ({
  startedAt: daysAgo(0),
  finishedAt: new Date().toISOString(),
  purged: 2,
  analyzed: created,
  pendingAnalysis: 0,
  sources: (
    [
      ['LBA', 12, 2],
      ['LINKEDIN', 16, 8],
      ['INDEED', 9, 7],
      ['GLASSDOOR', 60, 18],
      ['GOOGLE_JOBS', 20, 6],
    ] as const
  ).map(([source, fetched, made]) => ({
    source,
    status: 'ok' as const,
    fetched,
    skipped: 0,
    excluded: 0,
    irrelevant: Math.round(fetched / 6),
    duplicates: 0,
    created: made,
    updated: 0,
  })),
});

const HEALTH: ApiHealthItem[] = [
  'LBA',
  'LINKEDIN',
  'INDEED',
  'GLASSDOOR',
  'GOOGLE_JOBS',
  'GEMINI',
].map((key) => ({ key, status: 'OK' as const, checkedAt: daysAgo(0), lastOkAt: daysAgo(0) }));

function extractFromText(text: string) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const company = /chez ([^,.\n]+)/i.exec(text)?.[1]?.trim() ?? lines[1] ?? null;
  const city =
    ['Paris', 'Versailles', 'Lyon', 'Nantes', 'Lille', 'Massy', 'Nanterre'].find((c) =>
      text.includes(c),
    ) ?? null;
  return {
    title: (lines[0] ?? '').replace(/^[-•·\s]+/, '').slice(0, 120),
    company: company ? company.slice(0, 80) : null,
    city,
    contactEmail:
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(text)?.[0].toLowerCase() ?? null,
  };
}

type Body = Record<string, unknown>;

/** Texte d'un champ du corps de la requête (le corps arrive en `unknown` : jamais de « [object Object] »). */
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Point d'entrée : même signature que le vrai client d'API. */
export async function demoApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = new URL(path, 'http://demo.local');
  const route = url.pathname;
  const b = (body ?? {}) as Body;
  const m = (pattern: RegExp) => pattern.exec(route);
  let hit: RegExpExecArray | null;

  // -- session : la démo est toujours « connectée »
  if (route === '/auth/me') return { login: 'démo', csrfToken: 'demo' } as T;
  if (route === '/auth/login' && method === 'POST')
    return { login: 'démo', csrfToken: 'demo' } as T;
  if (route === '/auth/logout') return undefined as T;

  // -- profil
  if (route === '/profile') {
    if (method === 'PUT') {
      state.profile = structuredClone(b as unknown as typeof DEMO_PROFILE);
      await pause(200);
    }
    return structuredClone(state.profile) as T;
  }

  // -- offres
  if (route === '/offers' && method === 'GET') return listOffers(url.searchParams) as T;
  // Avant « /offers/:id » : « rejected » ne doit pas être pris pour un identifiant.
  if (route === '/offers/rejected' && method === 'GET') {
    const items = state.offers
      .filter((o) => o.rejectedAt)
      .sort((a, b) => (b.rejectedAt as string).localeCompare(a.rejectedAt as string))
      .map((o) => ({
        id: o.id,
        title: o.title,
        company: o.company,
        city: o.city,
        postcode: o.postcode,
        contractType: o.contractType,
        score: o.score,
        rejectedAt: o.rejectedAt as string,
        expiresAt: new Date(new Date(o.rejectedAt as string).getTime() + 7 * DAY).toISOString(),
        hasLetter: applicationOf(o.id) !== undefined,
      }));
    return { total: items.length, items } as T;
  }
  if ((hit = m(/^\/offers\/([^/]+)\/reject$/)) && method === 'POST') {
    const offer = find(state.offers, hit[1], 'Offre');
    const application = applicationOf(offer.id);
    if (application && application.status !== 'TO_REVIEW') {
      throw new ApiError(
        409,
        'Cette offre est déjà en suivi : change son statut depuis la page Suivi',
      );
    }
    offer.rejectedAt ??= new Date().toISOString();
    return { id: offer.id, rejected: true } as T;
  }
  if ((hit = m(/^\/offers\/([^/]+)\/restore$/)) && method === 'POST') {
    const offer = find(state.offers, hit[1], 'Offre');
    offer.rejectedAt = null;
    return { id: offer.id, rejected: false } as T;
  }
  if (route === '/applications/without-letter' && method === 'POST') {
    const offer = find(state.offers, str(b.offerId), 'Offre');
    if (offer.rejectedAt)
      throw new ApiError(409, 'Cette offre est rejetée : restaure-la avant de postuler');
    const now = new Date().toISOString();
    const existing = applicationOf(offer.id);
    if (existing && existing.status !== 'TO_REVIEW') {
      throw new ApiError(409, 'Cette offre a déjà une candidature en suivi');
    }
    const application: DemoApplication = existing ?? {
      id: nextId('app'),
      status: 'APPLIED',
      subject: null,
      body: null,
      validatedAt: now,
      appliedAt: now,
      followedUpAt: null,
      createdAt: now,
      updatedAt: now,
      replies: [],
      offer,
    };
    Object.assign(application, {
      status: 'APPLIED',
      subject: null,
      body: null,
      validatedAt: now,
      appliedAt: now,
      updatedAt: now,
    });
    if (!existing) state.applications.push(application);
    return { id: application.id, status: 'APPLIED', subject: null, body: null } as T;
  }
  if (route === '/offers/analyze' && method === 'POST') {
    const ids = (b.ids as string[]) ?? [];
    await pause(900);
    let analyzed = 0;
    for (const id of ids) {
      const offer = state.offers.find((o) => o.id === id);
      if (offer && offer.score === null && offer.analysisAfter) {
        analyze(offer);
        analyzed++;
      }
    }
    return {
      analyzed,
      remaining: 0,
      items: ids.map((id) => {
        const offer = state.offers.find((o) => o.id === id);
        return { id, score: offer?.score ?? null, excluded: offer?.excluded ?? false };
      }),
    } as T;
  }
  if (route === '/offers/manual/extract' && method === 'POST') {
    await pause(900);
    return extractFromText(str(b.text)) as T;
  }
  if (route === '/offers/manual' && method === 'POST') {
    const title = str(b.title).trim();
    const company = str(b.company).trim();
    const city = str(b.city) || null;
    const key = `${title}|${company}|${city ?? ''}`.toLowerCase();
    const existing = state.offers.find(
      (o) => `${o.title}|${o.company}|${o.city ?? ''}`.toLowerCase() === key,
    );
    if (existing) return { id: existing.id, created: false, analyzed: false } as T;
    await pause(900);
    const offer: DemoOffer = {
      id: nextId('m'),
      source: 'MANUAL',
      via: null,
      title,
      company,
      city,
      postcode: null,
      channel: str(b.contactEmail) ? 'EMAIL' : 'SITE',
      contractType: /stage/i.test(title)
        ? 'STAGE'
        : /alternan|apprenti/i.test(title)
          ? 'ALTERNANCE'
          : 'AUTRE',
      distanceKm: city === 'Versailles' ? 3 : city ? 20 : null,
      applyUrl: str(b.applyUrl) || null,
      contactEmail: str(b.contactEmail) || null,
      publishedAt: null,
      firstSeenAt: new Date().toISOString(),
      description: str(b.text),
      score: null,
      analysis: null,
      analyzedAt: null,
      excluded: false,
    };
    analyze(offer);
    state.offers.unshift(offer);
    return { id: offer.id, created: true, analyzed: true } as T;
  }
  if ((hit = m(/^\/offers\/([^/]+)\/analyze$/)) && method === 'POST') {
    const offer = find(state.offers, hit[1], 'Offre');
    await pause(900);
    analyze(offer);
    return offerDetail(offer) as T;
  }
  if ((hit = m(/^\/offers\/([^/]+)\/letter$/)) && method === 'POST') {
    const offer = find(state.offers, hit[1], 'Offre');
    await pause(1_400);
    const existing = applicationOf(offer.id);
    const subject = `Candidature en alternance : ${offer.title}`;
    const text = letterBody(offer.title, offer.company);
    if (existing) {
      existing.subject = subject;
      existing.body = text;
    } else {
      state.applications.push({
        id: nextId('app'),
        status: 'TO_REVIEW',
        subject,
        body: text,
        validatedAt: null,
        appliedAt: null,
        followedUpAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        replies: [],
        offer,
      });
    }
    const application = applicationOf(offer.id) as DemoApplication;
    return {
      applicationId: application.id,
      subject,
      body: text,
      preview: `${text}\n\nCordialement,\nLéa Marchand`,
      warnings: [],
    } as T;
  }
  if ((hit = m(/^\/offers\/([^/]+)$/)) && method === 'GET') {
    return offerDetail(find(state.offers, hit[1], 'Offre')) as T;
  }

  // -- candidatures
  if (route === '/applications' && method === 'GET') {
    return [...state.applications]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(applicationRow) as T;
  }
  if ((hit = m(/^\/applications\/([^/]+)\/status$/)) && method === 'POST') {
    const app = find(state.applications, hit[1], 'Candidature');
    const to = b.status as ApplicationStatus;
    if (!MANUAL_NEXT[app.status].includes(to)) throw new ApiError(409, 'Passage impossible');
    if (to === 'VALIDATED' && (!app.subject?.trim() || !app.body?.trim())) {
      throw new ApiError(422, 'Objet et lettre requis pour valider');
    }
    app.status = to;
    app.updatedAt = new Date().toISOString();
    if (to === 'VALIDATED') app.validatedAt = app.updatedAt;
    if (to === 'APPLIED') app.appliedAt = app.updatedAt;
    return { id: app.id, status: app.status, subject: app.subject, body: app.body } as T;
  }
  if ((hit = m(/^\/applications\/([^/]+)\/draft$/)) && method === 'POST') {
    const app = find(state.applications, hit[1], 'Candidature');
    await pause(500);
    app.status = 'DRAFT_CREATED';
    app.updatedAt = new Date().toISOString();
    return { applicationId: app.id, draftId: 'brouillon-demo', to: app.offer.contactEmail } as T;
  }
  if ((hit = m(/^\/applications\/([^/]+)\/follow-up$/)) && method === 'POST') {
    const app = find(state.applications, hit[1], 'Candidature');
    if (!FOLLOW_UP_STATUSES.includes(app.status) || app.followedUpAt) {
      throw new ApiError(409, 'Cette candidature ne peut plus être relancée');
    }
    await pause(1_200);
    const text = followUpBody(app.offer.title, app.offer.company);
    return {
      applicationId: app.id,
      subject: `Relance : ${app.subject ?? 'ma candidature'}`,
      body: text,
      preview: `${text}\n\nCordialement,\nLéa Marchand`,
      warnings: [],
      to: app.offer.contactEmail,
    } satisfies FollowUpResult as T;
  }
  if ((hit = m(/^\/applications\/([^/]+)\/follow-up\/(draft|done)$/)) && method === 'POST') {
    const app = find(state.applications, hit[1], 'Candidature');
    if (!FOLLOW_UP_STATUSES.includes(app.status) || app.followedUpAt) {
      throw new ApiError(409, 'Cette candidature ne peut plus être relancée');
    }
    await pause(hit[2] === 'draft' ? 500 : 150);
    app.followedUpAt = new Date().toISOString();
    app.updatedAt = app.followedUpAt;
    return { applicationId: app.id, draftId: 'relance-demo', to: app.offer.contactEmail } as T;
  }
  if ((hit = m(/^\/applications\/([^/]+)$/))) {
    const app = find(state.applications, hit[1], 'Candidature');
    if (method === 'PATCH') {
      if (app.status !== 'TO_REVIEW')
        throw new ApiError(409, 'Seule une candidature « à valider » peut être modifiée');
      if (typeof b.subject === 'string') app.subject = b.subject.trim();
      if (typeof b.body === 'string') app.body = b.body.trim();
    }
    if (method === 'DELETE') {
      state.applications = state.applications.filter((a) => a.id !== app.id);
      return { gmailDraftDeleted: null } as T;
    }
    return { id: app.id, status: app.status, subject: app.subject, body: app.body } as T;
  }
  if ((hit = m(/^\/replies\/([^/]+)$/)) && method === 'PATCH') {
    for (const app of state.applications) {
      const reply = app.replies.find((r) => r.id === hit?.[1]);
      if (reply) reply.kind = b.kind as typeof reply.kind;
    }
    return {} as T;
  }

  // -- Gmail (simulé)
  if (route === '/gmail/status') return { configured: true } as T;
  if (route === '/gmail/sync') {
    if (method === 'POST') await pause(700);
    return {
      checked: state.applications.filter((a) => a.status === 'APPLIED').length,
      newReplies: 0,
      statusChanges: 0,
      noResponse: 0,
      skipped: 0,
      finishedAt: new Date().toISOString(),
    } satisfies SyncReport as T;
  }

  // -- collecte et sources
  if (route === '/collection/status') {
    return {
      sources: {
        LBA: true,
        LBB: true,
        ADZUNA: false,
        GOOGLE_JOBS: true,
        GLASSDOOR: true,
        INDEED: true,
        LINKEDIN: true,
        MANUAL: true,
      },
      gemini: { configured: true, model: 'gemini-3.5-flash-lite' },
    } as T;
  }
  if (route === '/collection/last') return FULL_REPORT(state.collected ? 3 : 41) as T;
  if (route === '/collection/run' && method === 'POST') {
    await pause(1_600);
    let created = 0;
    if (!state.collected) {
      state.collected = true;
      const arrivals = arrivingOffers();
      state.offers.unshift(...arrivals);
      created = arrivals.length;
    }
    return FULL_REPORT(created) as T;
  }
  if (route === '/api-health') return { items: HEALTH } as T;
  if (route === '/stats') return computeStats() as T;

  throw new ApiError(404, 'Non disponible dans la démo');
}
