import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/node_modules/**', 'docs/**', 'pnpm-lock.yaml'] },
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
  // Les fichiers JavaScript de configuration ne sont pas dans un tsconfig : pas de règles typées.
  { files: ['**/*.{js,mjs}'], extends: [tseslint.configs.disableTypeChecked] },
  // Toujours en dernier : désactive les règles de style qui entreraient en conflit avec Prettier.
  prettier,
);
