# Décisions techniques

Chaque décision est numérotée. Une décision remplacée n'est pas supprimée : on l'annote.

## D1. Monorepo pnpm

Un seul dépôt, des sous-projets dans `apps/` (API, interface) et `packages/` (code partagé). Les types et les schémas de validation sont ainsi partagés entre l'API et l'interface.

## D2. NestJS, Prisma, PostgreSQL

NestJS impose une structure par modules et l'injection de dépendances, ce qui garde un projet de cette taille lisible. Prisma fournit un schéma typé et des migrations. PostgreSQL gère bien le JSON (détail des scores, analyses) et l'hébergement futur.

## D3. Tests : Vitest avec le plugin SWC

Un seul outil pour l'API et l'interface. Vitest compile avec esbuild, qui n'émet pas les métadonnées de décorateurs nécessaires à l'injection de dépendances : le plugin SWC s'en charge. Les tests unitaires s'appellent `*.spec.ts`, les tests d'intégration (HTTP complet) `*.e2e-spec.ts`, à côté du code testé.

## D4. Flux de travail

Une branche et une pull request par sujet, nommées `feat/...`, `fix/...`, `chore/...`. Fusion en « squash » : un commit par PR sur `main`. Chaque PR est relue (revue écrite dans la PR), et la CI doit être verte avant fusion.

## D5. Qualité automatique

ESLint avec règles typées, Prettier, vérification des types, tests, compilation. Les mêmes contrôles tournent en local (`pnpm check`) et dans la CI.

## D6. Fins de ligne

LF partout (`.gitattributes`, `.editorconfig`), pour éviter le bruit des différences entre Windows et Linux.

## D7. TypeScript fixé en 5.9

Version fixée pour éviter qu'une montée de version majeure ne casse la configuration. À réévaluer volontairement.

## D8. Scripts d'installation des dépendances

pnpm 10 bloque par défaut les scripts d'installation des paquets. On n'en autorise aucun tant qu'un paquet n'en a pas réellement besoin, et chaque autorisation est notée ici. À ce jour : aucune.

## D9. Le cours personnel reste local

`docs/cours/` est exclu de Git et n'est jamais poussé sur GitHub.

## D10. Actions GitHub figées par empreinte

Les actions de la CI sont référencées par l'empreinte (SHA) de leur commit, avec la version en commentaire, et non par une étiquette mobile. Une étiquette peut être déplacée vers du code malveillant ; une empreinte, non. Dependabot propose les mises à jour. Le jeton de la CI est en lecture seule et n'est pas conservé après le `checkout` (`persist-credentials: false`).

## D11. Audit des dépendances planifié

L'audit de production tourne à chaque PR et chaque lundi (tâche planifiée), pour détecter une faille publiée après la dernière PR. Il ne réinstalle pas les dépendances : il lit seulement le fichier de verrouillage.

## D12. Encodage des fichiers

UTF-8 **sans BOM**. Sous Windows PowerShell 5.1, `Set-Content -Encoding utf8` ajoute un BOM ; on utilise l'outil d'écriture de l'éditeur, ou `[IO.File]::WriteAllText` avec `UTF8Encoding($false)`. Un BOM dans un JSON fait échouer `JSON.parse`.

Autre piège du même genre : dans une chaîne PowerShell entre guillemets doubles, l'accent grave et `$` sont interprétés. Pour écrire du texte brut, on utilise des guillemets simples ou l'outil d'écriture.

## D13. Garde-fou local en attendant la CI

Le compte GitHub est verrouillé pour un problème de facturation : les tâches de `.github/workflows/ci.yml` sont refusées au démarrage. En attendant, un hook `pre-push` (`.githooks/pre-push`) lance `pnpm check` avant tout envoi vers GitHub. `pnpm install` l'active (`scripts/install-hooks.mjs`, via le script `prepare`).

Limites connues : le hook contrôle l'arbre de travail et non le commit poussé ; `git push --no-verify` le contourne ; il n'y a ni audit planifié ni recherche de secrets automatique (GitGuardian reste actif côté GitHub). Le workflow `ci.yml` est conservé : il reprendra du service quand la facturation sera réglée.

## D14. Configuration validée au démarrage

Les variables d'environnement sont validées par un schéma Zod (`apps/api/src/config/env.ts`) avant tout le reste. Une valeur invalide fait échouer le démarrage avec la liste des variables en cause, **sans jamais afficher la valeur reçue** (une variable mal saisie peut être un secret). Les variables absentes du schéma sont ignorées et jamais recopiées. Les valeurs par défaut sont les plus restrictives : écoute sur `127.0.0.1`, CORS désactivé.

En développement, le `.env` est chargé par `process.loadEnvFile` (natif dans Node 24, aucune dépendance) ; jamais en production, où l'environnement fournit les variables. Piège évité : `new URL()` lève une erreur native qui contient la valeur saisie, d'où `URL.canParse` en amont.

## D16. Image Docker de l'API

- **Trois étapes** : construction (tous les outils), `pnpm deploy --prod` (code compilé + dépendances de production seulement), exécution (`node:24-slim`). Aucun compilateur ni dépendance de développement dans l'image finale.
- **Utilisateur `node` (non-root)**, système de fichiers en lecture seule, `cap_drop: ALL`, `no-new-privileges`.
- **`--ignore-scripts`** à l'installation et au déploiement : aucun script de dépendance ne s'exécute pendant le build (et le script `prepare` de la racine, qui installe les hooks Git, n'a pas de sens dans l'image).
- **`.dockerignore`** : `.env`, `credentials.json`, `token.json`, `.git`, `docs/cours` n'entrent jamais dans le contexte de build.
- **Écoute** : `API_HOST=0.0.0.0` dans le conteneur (sinon inaccessible), mais le port n'est publié que sur `127.0.0.1` de la machine.
- Le service `api` ne reçoit que les variables qu'il utilise, pas tout le `.env`.
- Vérifié : image de ~246 Mo, uid 1000, healthcheck vert, aucun fichier secret, valeur invalide jamais affichée.
- Reste à faire : épingler l'image de base par empreinte (digest) avec Dependabot (PR n°24), et le proxy de confiance avec le déploiement (R8).

## D15. Durcissement HTTP

- **Helmet** : en-têtes de sécurité (nosniff, anti-framing, HSTS, CSP) et suppression de `X-Powered-By`.
- **CORS** désactivé par défaut ; une seule origine autorisée (`WEB_ORIGIN`), jamais `*`, car l'API portera des cookies de session.
- **Limitation de débit** globale par adresse IP (`@nestjs/throttler`), 100 requêtes par minute par défaut. Derrière un reverse proxy, il faudra déclarer le proxy de confiance, sinon toutes les requêtes auront l'IP du proxy.
- La route publique `/health` n'expose plus la version.
- Les réglages communs sont dans `configureApp`, utilisée par `main.ts` **et** par les tests : on teste exactement ce qui tourne.
