import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, setCsrfToken } from '../api/client';

type Session = { login: string; csrfToken: string };

type AuthState =
  { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; login: string };

type AuthContextValue = {
  state: AuthState;
  signIn: (login: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const adopt = useCallback((session: Session) => {
    setCsrfToken(session.csrfToken);
    setState({ status: 'authenticated', login: session.login });
  }, []);

  // Au chargement : la session existe-t-elle encore (cookie valide) ?
  useEffect(() => {
    let cancelled = false;
    api<Session>('GET', '/auth/me')
      .then((session) => {
        if (!cancelled) {
          adopt(session);
        }
      })
      .catch(() => {
        // 401 = pas connecté ; toute autre erreur (API éteinte) est traitée de même : on demande de se connecter.
        if (!cancelled) {
          setState({ status: 'anonymous' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  const signIn = useCallback(
    async (login: string, password: string) => {
      adopt(await api<Session>('POST', '/auth/login', { login, password }));
    },
    [adopt],
  );

  const signOut = useCallback(async () => {
    try {
      await api<void>('POST', '/auth/logout');
    } finally {
      // Même si le réseau échoue, l'interface oublie la session.
      setCsrfToken(null);
      setState({ status: 'anonymous' });
    }
  }, []);

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth doit être utilisé dans <AuthProvider>.');
  }
  return value;
}
