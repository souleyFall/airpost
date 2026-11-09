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
- PR n°16 : candidatures. Machine à états testée, modification du brouillon, validation, suppression, export JSON et effacement complet du compte (mot de passe exigé). Revue de la PR n°19 : 5 constats, 4 corrigés (validation concurrente, objet sur une ligne, régénération sans mémoire). 330 tests dans `pnpm check`, 123 d'intégration.
- PR n°15 : génération des lettres. Prompt sans identité, signature ajoutée localement, sept garde-fous (longueur, texte à compléter, coordonnées, mention d'IA, chiffre inventé, citations ancrées dans le profil), une nouvelle tentative guidée, 409 sur une candidature validée. Revue de la PR n°18 : 5 constats, 4 corrigés. Essai réel avec Gemini : la première lettre refusée par l'ancrage, la seconde acceptée. 310 tests dans `pnpm check`, 85 d'intégration.
- PR n°14 : service Gemini. Fournisseur interchangeable, sortie JSON validée avec une nouvelle tentative, mémoire des réponses, minimisation des données envoyées, encadrement des textes de tiers. Formes d'erreur relevées sur la vraie API (clé invalide = 400). Faille trouvée par un test : expression régulière quadratique (déni de service par une offre). Revue de la PR n°17 : 5 constats, 5 corrigés. 282 tests dans `pnpm check`. À corriger par l'auteur : `GEMINI_MODEL` dans `.env` (modèle retiré).
- PR n°13 : scoring. Grille sur 100 en fonctions pures (38 tests), recalcul complet à chaque collecte, détail par critère stocké, GET /offers et GET /offers/:id. Défaut trouvé par un test d'intégration : le filtre minScore=0 par défaut excluait les offres pas encore notées. 225 tests dans pnpm check, 69 d'intégration.
- PR n°12 : pipeline de collecte. Géocodage du code postal, trois sources en séquence avec bilan par source, dédoublonnage entre sources, exclusions du profil, purge selon la durée de conservation (jamais une offre suivie), collecte à la demande (POST /collection/run) et planifiée (désactivée par défaut). Revue de la PR n°15 : 6 constats, 4 corrigés (traduction des statuts HTTP partagée...). 183 tests dans pnpm check, 54 d'intégration dont 9 de bout en bout avec de fausses API et la vraie base.
- PR n°11 : connecteurs La Bonne Boîte (entreprises qui recrutent, OAuth2) et Adzuna (annonces). Formes relevées sur les vraies API avant d'écrire le code ; 37 tests de connecteurs sans réseau ; essai réel : 100 entreprises et 50 annonces, 0 ignorée. Pièges : La Bonne Boîte répond 429 si on enchaîne les appels, page_size max 100 ; en PowerShell, [IO.File] résout les chemins relatifs depuis le dossier du processus (accès refusé évité de justesse).
- PR n°10 : connecteur La Bonne Alternance et OffersService. Forme de la réponse relevée sur la vraie API avant d'écrire le code ; 25 tests de connecteur sans réseau, 7 tests d'intégration ; essai réel : 13 offres (M1805), 450 sans filtre, 0 ignorée. Piège de test : passer undefined à un paramètre par défaut remet la valeur par défaut.
- PR n°9 : profil du candidat. Schéma Zod strict et borné, GET/PUT /profile, cloisonnement par utilisateur, 14 tests de schéma et 9 tests d'intégration (CSRF, champs inconnus, effacement avec l'utilisateur). Revue de la PR n°8 : 6 constats, 3 corrigés (empreinte factice au démarrage, paramètres argon2 partagés, alerte cookie non Secure).
- PR n°8 : authentification. Sessions côté serveur (jeton haché en base), cookie `HttpOnly` + `SameSite=Strict`, jeton anti-CSRF, argon2id, garde global (API privée par défaut), limite de 5 connexions par minute, `ConfigModule` global, script `user:create`. 64 tests dans `pnpm check`, 25 dans `pnpm test:db`. Vérifié sur l'API dans Docker : connexion, session, déconnexion refusée sans CSRF puis acceptée, session invalide après déconnexion. Piège rencontré : un cookie `Secure` n'est pas renvoyé en http, d'où `SESSION_COOKIE_SECURE`. Autre piège : PowerShell 5.1 ajoute un BOM aux entrées redirigées.
- PR n°7 : Prisma 7, schéma (5 modèles), migration `init`, `PrismaService`, seed de démonstration, 9 tests d'intégration sur base jetable, service `migrate` et attente de la base (`healthcheck`) dans Compose. PR n°1 à n°6 fusionnées dans `main`. Vérifié : l'API dans son conteneur lit les 3 offres de démonstration.
- PR n°6 : Dockerfile de l'API (3 étapes, non-root, lecture seule), `.dockerignore`, service `api` dans `docker-compose.yml`. Premier build échoué : `pnpm deploy` exécutait le script `prepare` (hooks Git) absent de l'image, corrigé avec `--ignore-scripts`.
- PR n°5 : documentation de sécurité et RGPD. Registre des risques (24 entrées classées OWASP, incident de l'e-mail), registre des traitements RGPD (finalités, destinataires dont Gemini, durées de conservation, droits), `SECURITY.md`.

## 2026-11-08

- Étape 0 : monorepo pnpm, PostgreSQL 17 dans Docker Compose.
- Étape 1 : API NestJS 12 minimale, route `GET /health`.

## 2026-11-10 : interface web

- PR 21 (socle, connexion) et PR 22 (écran À valider) : voir docs/decisions.md D27 et les revues locales. Après la PR 22, reconstruire l'API (docker compose up -d --build api) : l'écran lit le champ application des offres.

- PR 24 (image Docker de l'interface, TRUST_PROXY) et PR 25 (PWA) fusionnées. Interface : http://localhost:8080 apres docker compose up -d --build.
