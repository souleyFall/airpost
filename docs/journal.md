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
- PR n°10 : connecteur La Bonne Alternance et OffersService. Forme de la réponse relevée sur la vraie API avant d'écrire le code ; 25 tests de connecteur sans réseau, 7 tests d'intégration ; essai réel : 13 offres (M1805), 450 sans filtre, 0 ignorée. Piège de test : passer undefined à un paramètre par défaut remet la valeur par défaut.
- PR n°9 : profil du candidat. Schéma Zod strict et borné, GET/PUT /profile, cloisonnement par utilisateur, 14 tests de schéma et 9 tests d'intégration (CSRF, champs inconnus, effacement avec l'utilisateur). Revue de la PR n°8 : 6 constats, 3 corrigés (empreinte factice au démarrage, paramètres argon2 partagés, alerte cookie non Secure).
- PR n°8 : authentification. Sessions côté serveur (jeton haché en base), cookie `HttpOnly` + `SameSite=Strict`, jeton anti-CSRF, argon2id, garde global (API privée par défaut), limite de 5 connexions par minute, `ConfigModule` global, script `user:create`. 64 tests dans `pnpm check`, 25 dans `pnpm test:db`. Vérifié sur l'API dans Docker : connexion, session, déconnexion refusée sans CSRF puis acceptée, session invalide après déconnexion. Piège rencontré : un cookie `Secure` n'est pas renvoyé en http, d'où `SESSION_COOKIE_SECURE`. Autre piège : PowerShell 5.1 ajoute un BOM aux entrées redirigées.
- PR n°7 : Prisma 7, schéma (5 modèles), migration `init`, `PrismaService`, seed de démonstration, 9 tests d'intégration sur base jetable, service `migrate` et attente de la base (`healthcheck`) dans Compose. PR n°1 à n°6 fusionnées dans `main`. Vérifié : l'API dans son conteneur lit les 3 offres de démonstration.
- PR n°6 : Dockerfile de l'API (3 étapes, non-root, lecture seule), `.dockerignore`, service `api` dans `docker-compose.yml`. Premier build échoué : `pnpm deploy` exécutait le script `prepare` (hooks Git) absent de l'image, corrigé avec `--ignore-scripts`.
- PR n°5 : documentation de sécurité et RGPD. Registre des risques (24 entrées classées OWASP, incident de l'e-mail), registre des traitements RGPD (finalités, destinataires dont Gemini, durées de conservation, droits), `SECURITY.md`.

## 2026-11-08

- Étape 0 : monorepo pnpm, PostgreSQL 17 dans Docker Compose.
- Étape 1 : API NestJS 12 minimale, route `GET /health`.
