import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/dist-demo/**',
      'site/**',
      '**/node_modules/**',
      '**/src/generated/**', // client Prisma généré : jamais relu ni modifié à la main
      'docs/**',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Tests : les doublures renvoient souvent une promesse sans rien attendre (`async () => valeur`) ; la règle
  // `require-await` n'y apporte que du bruit. Elle reste active pour le code de l'application.
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/*.db-spec.ts', '**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  // Service worker : s'exécute dans le navigateur, pas dans Node.
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  // Les fichiers JavaScript de configuration ne sont pas dans un tsconfig : pas de règles typées.
  { files: ['**/*.{js,mjs}'], extends: [tseslint.configs.disableTypeChecked] },
  // Toujours en dernier : désactive les règles de style qui entreraient en conflit avec Prettier.
  prettier,
);
