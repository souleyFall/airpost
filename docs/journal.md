# Journal

## 2026-11-09

- PR n°1 : champ `version` et route `/health/ping` (exercices de l'étape 1).
- PR n°2 : outillage qualité. ESLint (règles typées), Prettier, Vitest avec SWC, tests de la route de santé, CI GitHub Actions (qualité, audit des dépendances, recherche de secrets), Dependabot, modèle de pull request.
- Constat : `pnpm audit` signale une faille modérée dans `minimatch`, uniquement via ESLint (outil de développement). Risque accepté, suivi par Dependabot.

## 2026-11-08

- Étape 0 : monorepo pnpm, PostgreSQL 17 dans Docker Compose.
- Étape 1 : API NestJS 12 minimale, route `GET /health`.
