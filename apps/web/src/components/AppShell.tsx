import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from './Logo';

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

const LINKS = [
  {
    to: '/',
    label: 'À valider',
    icon: (
      <>
        <path d="M2 9.5 4 3.5h8l2 6v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
        <path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" />
      </>
    ),
  },
  { to: '/suivi', label: 'Suivi', icon: <path d="M3 4h10M3 8h10M3 12h6" /> },
  {
    to: '/sources',
    label: 'Sources',
    icon: <path d="M6 2v3M10 2v3M4.5 5h7v3a3.5 3.5 0 0 1-7 0zM8 11.5V14" />,
  },
];

/** Cadre commun des écrans connectés : barre latérale de la maquette + zone de contenu. */
export function AppShell() {
  const { state, signOut } = useAuth();
  return (
    <div className="flex min-h-screen flex-wrap items-stretch">
      <aside className="flex flex-[1_1_100%] flex-col gap-6 border-b border-line bg-sidebar px-3 py-5 md:max-w-[232px] md:flex-[0_0_232px] md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5 px-2.5">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">airpost</span>
        </div>
        <nav aria-label="Navigation principale" className="flex flex-col gap-1">
          {LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.to === '/'} className="nav">
              <Icon>{link.icon}</Icon>
              <span className="flex-1">{link.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3 px-2.5">
          {state.status === 'authenticated' ? (
            <p className="m-0 text-[13px] text-muted">Connecté : {state.login}</p>
          ) : null}
          <button type="button" className="btn" onClick={() => void signOut()}>
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-[999_1_560px]">
        <Outlet />
      </main>
    </div>
  );
}
