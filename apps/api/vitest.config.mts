import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Vitest compile le TypeScript avec esbuild, qui ne sait pas émettre les métadonnées de décorateurs
// dont l'injection de dépendances de Nest a besoin. Le plugin SWC s'en charge.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.e2e-spec.ts'],
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
