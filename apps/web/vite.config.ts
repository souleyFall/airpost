/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * En-têtes de la démo (format Netlify / Cloudflare Pages) : la démo ne parle à personne. `connect-src 'none'` interdit au
 * navigateur toute requête réseau depuis la page, même si le code en tentait une.
 */
const DEMO_HEADERS = `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`;

const demoHeaders = (): Plugin => ({
  name: 'airpost-demo-headers',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: '_headers', source: DEMO_HEADERS });
  },
});

// En développement, l'interface et l'API partagent la même origine (/api -> API) : le cookie de session
// SameSite=Strict fonctionne sans CORS, exactement comme derrière le futur proxy de production.
export default defineConfig(({ mode }) => ({
  // Démo : fichiers statiques servis sous n'importe quel chemin (liens relatifs), dans leur propre dossier de sortie.
  ...(mode === 'demo' ? { base: './', build: { outDir: 'dist-demo' } } : {}),
  plugins: [react(), tailwindcss(), ...(mode === 'demo' ? [demoHeaders()] : [])],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    // Marge pour une machine chargée : les tests lancés en parallèle (API et interface) dépassaient les 5 s par défaut sans qu'aucun ne soit lent seul.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
}));
