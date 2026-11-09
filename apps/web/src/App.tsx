import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { Placeholder } from './pages/Placeholder';

/** Écrans réservés : sans session, retour à la connexion (l'API refuse de toute façon les données). */
function RequireAuth() {
  const { state } = useAuth();
  if (state.status === 'loading') {
    return (
      <p role="status" className="p-8 text-muted">
        Chargement…
      </p>
    );
  }
  if (state.status === 'anonymous') {
    return <Navigate to="/connexion" replace />;
  }
  return <AppShell />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<Placeholder title="À valider" />} />
        <Route path="suivi" element={<Placeholder title="Suivi" />} />
        <Route path="sources" element={<Placeholder title="Sources" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
