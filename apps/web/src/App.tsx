import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/profile/ProfilePage';
import { SourcesPage } from './pages/sources/SourcesPage';
import { TrackingPage } from './pages/tracking/TrackingPage';
import { ReviewPage } from './pages/review/ReviewPage';

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
        <Route index element={<ReviewPage />} />
        <Route path="suivi" element={<TrackingPage />} />
        <Route path="sources" element={<SourcesPage />} />
        <Route path="profil" element={<ProfilePage />} />
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
