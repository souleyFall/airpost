import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from '../components/Logo';

function messageFor(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return 'Identifiant ou mot de passe incorrect.';
  }
  if (error instanceof ApiError && error.status === 429) {
    return 'Trop de tentatives. Réessaie dans une minute.';
  }
  return 'Connexion impossible pour le moment. Vérifie que le serveur est démarré.';
}

export function LoginPage() {
  const { state, signIn } = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn(login.trim(), password);
    } catch (caught) {
      setError(messageFor(caught));
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-2.5 px-8 py-6">
        <Logo />
        <span className="text-lg font-semibold tracking-tight">airpost</span>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pt-8 pb-24">
        <div className="w-full max-w-[400px] rounded-md border border-line bg-surface p-8">
          <h1 className="m-0 text-[22px] leading-tight font-semibold">Connexion</h1>
          <p className="mt-1.5 mb-6 text-muted">Accès réservé au propriétaire de l’outil.</p>

          <form
            onSubmit={(event) => void onSubmit(event)}
            className="flex flex-col gap-4"
            noValidate
          >
            {error ? (
              <p
                role="alert"
                className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-danger"
              >
                {error}
              </p>
            ) : null}
            <div>
              <label htmlFor="login" className="mb-1.5 block text-[13px] font-medium">
                Identifiant
              </label>
              <input
                id="login"
                className="field"
                type="text"
                name="login"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={login}
                onChange={(event) => setLogin(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  id="password"
                  className="field pr-24"
                  type={visible ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-quiet absolute top-1 right-1 !h-[34px] !px-2.5 !text-[13px]"
                  aria-pressed={visible}
                  aria-controls="password"
                  onClick={() => setVisible((value) => !value)}
                >
                  {visible ? 'Masquer' : 'Afficher'}
                </button>
              </div>
            </div>
            <button
              type="submit"
              className="btn btn-primary !h-11 w-full"
              disabled={pending || login.trim() === '' || password === ''}
            >
              {pending ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>
      </main>

      <footer className="px-8 py-4 text-[13px] text-muted">airpost · usage personnel</footer>
    </div>
  );
}
