import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Élément #root introuvable.');
}
// Service worker : seulement dans la version construite (en développement il gênerait le rechargement à chaud).
// Pas de service worker non plus dans la démo : rien à installer, rien à mettre en cache.
if (import.meta.env.PROD && import.meta.env.MODE !== 'demo' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Sans service worker l'application fonctionne, simplement sans installation ni coquille hors ligne.
    });
  });
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
