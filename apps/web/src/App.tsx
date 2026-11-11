import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { IS_DEMO } from './api/client';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/profile/ProfilePage';
import { SourcesPage } from './pages/sources/SourcesPage';
import { StatsPage } from './pages/stats/StatsPage';
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
        <Route path="resultats" element={<StatsPage />} />
        <Route path="sources" element={<SourcesPage />} />
        <Route path="profil" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// La démo est servie sous n'importe quel chemin (/demo/...) sans réglage du serveur : adresses en « #/... ».
const Router = IS_DEMO ? HashRouter : BrowserRouter;

export function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}
