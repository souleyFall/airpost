import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { RunReport } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from './Logo';
import type { ShellContext } from './shellContext';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type CountKey = 'review' | 'tracking';

const LINKS: { to: string; label: string; count?: CountKey; icon: ReactNode }[] = [
  {
    to: '/',
    label: 'À valider',
    count: 'review',
    icon: (
      <>
        <path d="M2 9.5 4 3.5h8l2 6v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
        <path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" />
      </>
    ),
  },
  {
    to: '/suivi',
    label: 'Suivi',
    count: 'tracking',
    icon: <path d="M3 4h10M3 8h10M3 12h6" />,
  },
  {
    to: '/sources',
    label: 'Sources',
    icon: <path d="M6 2v3M10 2v3M4.5 5h7v3a3.5 3.5 0 0 1-7 0zM8 11.5V14" />,
  },
];

function lastRunLabel(report: RunReport | null | undefined, now = new Date()): string {
  if (report === undefined) return 'Dernière collecte : …';
  if (report === null) return 'Aucune collecte depuis le démarrage';
  const finished = new Date(report.finishedAt);
  const time = finished.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const sameDay = finished.toDateString() === now.toDateString();
  return `Dernière collecte : ${sameDay ? 'aujourd’hui' : finished.toLocaleDateString('fr-FR')}, ${time}`;
}

/** Cadre commun des écrans connectés : barre latérale de la maquette + zone de contenu. */
export function AppShell() {
  const { state, signOut } = useAuth();
  const [counts, setCounts] = useState<Record<CountKey, number | null>>({
    review: null,
    tracking: null,
  });
  const [version, setVersion] = useState(0);
  const [lastRun, setLastRun] = useState<RunReport | null | undefined>(undefined);
  const [collecting, setCollecting] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);

  const setCount = useCallback((key: CountKey, value: number | null) => {
    setCounts((current) => (current[key] === value ? current : { ...current, [key]: value }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<RunReport>('GET', '/collection/last')
      .then((report) => !cancelled && setLastRun(report))
      .catch(() => !cancelled && setLastRun(null));
    return () => {
      cancelled = true;
    };
  }, []);

  async function collect() {
    setCollecting(true);
    setCollectError(null);
    try {
      setLastRun(await api<RunReport>('POST', '/collection/run'));
      setVersion((value) => value + 1);
    } catch (error) {
      setCollectError(
        error instanceof ApiError && error.status === 429
          ? 'Trop de collectes rapprochées. Réessaie dans une minute.'
          : 'La collecte a échoué.',
      );
    } finally {
      setCollecting(false);
    }
  }

  const context = useMemo<ShellContext>(() => ({ version, setCount }), [version, setCount]);

  return (
    <div className="flex min-h-screen flex-wrap items-stretch">
      <aside className="flex flex-[1_1_100%] flex-col gap-6 border-b border-line bg-sidebar px-3 py-5 md:max-w-[232px] md:flex-[0_0_232px] md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5 px-2.5">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">airpost</span>
        </div>
        <nav aria-label="Navigation principale" className="flex flex-col gap-1">
          {LINKS.map((link) => {
            const count = link.count ? counts[link.count] : null;
            return (
              <NavLink key={link.to} to={link.to} end={link.to === '/'} className="nav">
                <Icon>{link.icon}</Icon>
                <span className="flex-1">{link.label}</span>
                {count !== null ? (
                  <span className="h-5 min-w-[22px] rounded-full bg-badge px-1.5 text-center text-xs leading-5 font-semibold">
                    {count}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-3 px-2.5">
          <p className="m-0 text-[13px] text-muted">{lastRunLabel(lastRun)}</p>
          {collectError ? (
            <p role="alert" className="m-0 text-[13px] text-danger">
              {collectError}
            </p>
          ) : null}
          <button
            type="button"
            className="btn"
            onClick={() => void collect()}
            disabled={collecting}
          >
            <Icon>
              <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
            </Icon>
            {collecting ? 'Collecte en cours…' : 'Lancer la collecte'}
          </button>
          {state.status === 'authenticated' ? (
            <p className="m-0 text-[13px] text-muted">Connecté : {state.login}</p>
          ) : null}
          <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-[999_1_560px]">
        <Outlet context={context} />
      </main>
    </div>
  );
}
