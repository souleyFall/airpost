import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Tests d'intégration contre un vrai PostgreSQL (base jetable créée par globalSetup).
// Lancés par `pnpm test:db` : ils demandent que `pnpm db:up` ait été exécuté.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.db-spec.ts'],
    globalSetup: ['test/db-global-setup.ts'],
    // Les fichiers partagent une même base : on les exécute l'un après l'autre.
    fileParallelism: false,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
