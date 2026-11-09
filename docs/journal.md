# Journal

## 2026-11-09

- PR n°1 : champ `version` et route `/health/ping` (exercices de l'étape 1).
- PR n°2 : outillage qualité. ESLint (règles typées), Prettier, Vitest avec SWC, tests de la route de santé, CI GitHub Actions (qualité, audit des dépendances, recherche de secrets), Dependabot, modèle de pull request.
- Constat : `pnpm audit` signale une faille modérée dans `minimatch`, uniquement via ESLint (outil de développement). Risque accepté, suivi par Dependabot.
- Corrections après revue de la PR n°2 :
  - BOM supprimé dans `.gitignore` et `apps/api/tsconfig.json`.
  - Actions GitHub figées par empreinte, jeton non conservé après le `checkout`, audit hebdomadaire, annulation de la CI limitée aux PR.
  - Audit sans réinstallation, Dependabot réduit à la racine, tests rendus plus robustes.
- PR n°3 : hook Git `pre-push` qui lance `pnpm check` avant chaque envoi (la CI GitHub est bloquée par un verrou de facturation du compte).
- Incident de confidentialité : l'adresse e-mail personnelle figurait dans les commits. Historique réécrit avec l'adresse « noreply » de GitHub, puis dépôt recréé : les anciens commits restaient joignables par leur hash après une réécriture. Détails et leçon dans le registre des risques (PR n°5).
- PR n°4 : durcissement de l'API. Configuration validée par Zod (sans fuite de valeur), en-têtes de sécurité (Helmet), CORS strict, limitation de débit, `/health` sans version. 27 tests. Un défaut trouvé par les tests : `new URL()` sur une valeur invalide levait une erreur native contenant la valeur saisie.
- Revue de la PR n°4 : 8 constats, 6 corrigés (https exigé en production pour `WEB_ORIGIN`, liste blanche d'en-têtes CORS, bornes hautes sur la limitation de débit, journalisation du `.env` chargé, avertissement si l'API écoute sur le réseau, tests Helmet sur le contenu des en-têtes), 2 écartés avec justification. 31 tests.
- PR n°6 : Dockerfile de l'API (3 étapes, non-root, lecture seule), `.dockerignore`, service `api` dans `docker-compose.yml`. Premier build échoué : `pnpm deploy` exécutait le script `prepare` (hooks Git) absent de l'image, corrigé avec `--ignore-scripts`.
- PR n°5 : documentation de sécurité et RGPD. Registre des risques (24 entrées classées OWASP, incident de l'e-mail), registre des traitements RGPD (finalités, destinataires dont Gemini, durées de conservation, droits), `SECURITY.md`.

## 2026-11-08

- Étape 0 : monorepo pnpm, PostgreSQL 17 dans Docker Compose.
- Étape 1 : API NestJS 12 minimale, route `GET /health`.
