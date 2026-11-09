import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Vitest compile le TypeScript avec esbuild, qui ne sait pas émettre les métadonnées de décorateurs
// dont l'injection de dépendances de Nest a besoin. Le plugin SWC s'en charge.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.e2e-spec.ts'],
    // Ces tests ne touchent pas à la base. Prisma ouvre sa connexion à la première requête :
    // une URL factice suffit pour construire l'application, et rend les tests indépendants de .env.
    env: { DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test' },
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
