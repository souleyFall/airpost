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

## D20. Connecteur La Bonne Alternance et enregistrement des offres

- **Format commun** (NormalizedOffer) pour toutes les sources, puis OffersService.saveMany : upsert par (source, externalId), le score et la candidature ne sont jamais écrasés, irstSeenAt est conservé, lastSeenAt rafraîchi, empreinte de dédoublonnage (dedupKey, partagée avec le seed) recalculée.
- **Forme de la réponse vérifiée sur la vraie API** (13 offres pour M1805 près de Paris, 450 sans filtre) : jobs[].identifier.id, workplace (nom, marque, raison sociale souvent absents : repli sur « Entreprise non indiquée »), workplace.location.address + geopoint GeoJSON [longitude, latitude], offer (titre, description, statut, dates), pply.url. Plusieurs codes ROME : séparés par une virgule ; un paramètre répété donne 400. Clé absente ou fausse : 401.
- **Tolérance** : le schéma Zod ne lit que ce qui sert ; une entrée illisible est comptée (skipped), jamais fatale ; les offres expirées ou non actives sont écartées.
- **Canal** : La Bonne Alternance ne publie ni e-mail ni téléphone de recruteur, donc toutes ses offres sont en canal « site » (l'utilisateur postule lui-même). Les « recruteurs » sans offre (candidatures spontanées) sont ignorés pour l'instant.
- **Sécurité** : clé lue dans LBA_API_KEY (facultative ; sans elle le connecteur refuse de s'appeler, sans réseau), envoyée en en-tête Authorization, jamais dans l'URL, jamais dans une erreur (testé pour 401, 429, 500 et réseau coupé). Délai maximal de 10 s. Seules les URL http(s) sont conservées (javascript: écarté). etch est injecté : tests sans réseau.
- **Limite de débit** (60 appels/min) : respectée par le pipeline de collecte (PR n°12), qui fera peu d'appels ; pas de file d'attente dans le connecteur.

## D19. Profil du candidat

- **Schéma Zod strict** (profile.schema.ts) : identité, titre, résumé, formations, expériences avec réalisations (méthode XYZ), compétences, critères de recherche (rythmes, démarrage « asap » ou date, trajet maximal, mots-clés, codes ROME, entreprises exclues). Un champ inconnu est refusé, toutes les tailles sont bornées : le profil part vers un modèle de langage, on ne laisse pas grossir sans limite ce qui y est envoyé.
- **Minimisation** : ni adresse complète ni date de naissance. Ville et code postal suffisent ; le géocodage pour le trajet se fera à partir du code postal (PR du scoring). E-mail, téléphone et site sont facultatifs et n'apparaissent dans une lettre que s'ils sont renseignés. Le site doit être en https.
- **Une ligne Profile par utilisateur**, colonne JSON ; GET /profile (404 tant que vide) et PUT /profile (remplace tout : idempotent, pas de fusion partielle ; CSRF exigé). L'identifiant vient de la session, jamais du corps (un userId envoyé est refusé comme champ inconnu). Le profil est relu à travers le schéma à la lecture.
- **Le schéma reste dans pps/api** pour l'instant. Il sera extrait dans packages/shared quand l'interface web (PR n°15) devra le réutiliser pour valider ses formulaires.
- **Règle pour la génération des lettres (PR n°13)** : elle ne cite que ce qui figure dans ce profil (réalisations comprises), rien d'inventé.

## D18. Authentification mono-utilisateur

- **Privée par défaut** : un garde global (`AuthGuard`) exige une session sur toute route ; seules celles marquées `@Public()` (santé, connexion) y échappent. Oublier le décorateur ferme une porte, ne l'ouvre pas.
- **Sessions côté serveur**, pas de JWT : un jeton aléatoire de 256 bits dans un cookie, dont seule l'empreinte SHA-256 est en base (une fuite de la base ne permet pas de se connecter). On peut révoquer une session (déconnexion, changement de mot de passe) ; un JWT ne le permet pas sans liste noire. Durée de vie absolue de 7 jours ; nouveau jeton à chaque connexion (pas de fixation) ; sessions expirées purgées à chaque connexion.
- **Cookie** : `HttpOnly` (illisible par JavaScript, donc non volable par XSS), `SameSite=Strict`, `Path=/`, `Secure` en production avec le préfixe `__Host-` (non écrasable par un sous-domaine). `SESSION_COOKIE_SECURE=false` permet l'usage local en http (le compose le fixe par défaut : l'API n'est publiée que sur `127.0.0.1`) ; à passer à `true` dès qu'il y a HTTPS.
- **CSRF** : en plus de `SameSite=Strict`, chaque session a un jeton, renvoyé à la connexion et par `GET /auth/me`, exigé dans l'en-tête `X-CSRF-Token` sur toute requête qui modifie (comparaison en temps constant). L'interface le garde en mémoire, pas dans un stockage persistant. 401 avant 403 : un anonyme n'apprend rien sur le jeton.
- **Mot de passe** : argon2id (`@node-rs/argon2`, binaires précompilés, aucun script d'installation), paramètres OWASP (19 Mio, 2 passes). 12 caractères minimum à la création (longueur plutôt que complexité). Le compte se crée depuis la machine : `pnpm --filter @airpost/api user:create <identifiant>` (mot de passe saisi sans écho, jamais en argument ni en variable d'environnement). Pas d'inscription en ligne.
- **Connexion** : message identique pour un identifiant inconnu et un mot de passe faux, et temps équivalent (empreinte factice vérifiée quand l'utilisateur n'existe pas) ; 5 essais par minute et par IP (429) ; corps validé par Zod avec bornes hautes (pas d'argon2 sur 10 Mo) ; les erreurs de validation ne recopient jamais la valeur reçue.
- **Cookies lus à la main** (`readCookie`, testé) plutôt que par la bibliothèque `cookie`, publiée depuis quatre jours en ESM seul : une dépendance de moins pour douze lignes.
- **`ConfigModule` global** (jeton `ENV`) : la configuration est validée une fois et injectée partout (réponse au constat de la revue de la PR n°4).

## D17. Base de données : Prisma 7, schéma et tests

- **Prisma 7.10.1** (version stable ; le tag `latest` de npm pointe sur une 8.0 RC, écartée). Générateur `prisma-client` en sortie CommonJS dans `src/generated/prisma` (ignoré par Git, régénéré par `postinstall` et `build`). Connexion par l'adaptateur `@prisma/adapter-pg` : le pool `pg` ouvre la connexion à la première requête, l'API démarre même si la base tarde.
- **Identifiants UUID v7** (triés dans le temps, non devinables) ; pas d'identifiant auto-incrémenté qui révélerait le volume.
- **Schéma** : `User` (login + empreinte du mot de passe, sans e-mail), `Profile` (JSON validé par Zod), `Offer` (unicité `source` + `externalId`, clé de dédoublonnage, score), `Application` (une par offre, statut), `Reply` (extrait court de la réponse Gmail). Les suppressions se font **en cascade depuis l'offre** : effacer une offre efface la candidature, les réponses et le contact recruteur (droit à l'effacement).
- **`DATABASE_URL` obligatoire**, validée au démarrage ; elle contient le mot de passe et n'est jamais recopiée dans une erreur (un seul `refine` : plusieurs s'exécutent tous et le second appellerait `new URL()` sur une valeur invalide).
- **Tests d'intégration séparés** (`pnpm test:db`) : une base jetable `<base>_test` est recréée, les migrations y sont rejouées, puis elle est supprimée ; la base de développement n'est jamais touchée. Hors de `pnpm check` (qui reste exécutable sans Docker, donc dans le hook) ; à lancer avant de pousser un changement de schéma.
- **Migrations** : `pnpm --filter @airpost/api db:migrate` en développement ; `docker compose run --rm migrate` pour appliquer les migrations versionnées (service du profil `tools`, utilise l'étape de construction de l'image).
- **Seed** : trois offres fictives, rejouable, refusé en production.

## D15. Durcissement HTTP

- **Helmet** : en-têtes de sécurité (nosniff, anti-framing, HSTS, CSP) et suppression de `X-Powered-By`.
- **CORS** désactivé par défaut ; une seule origine autorisée (`WEB_ORIGIN`), jamais `*`, car l'API portera des cookies de session.
- **Limitation de débit** globale par adresse IP (`@nestjs/throttler`), 100 requêtes par minute par défaut. Derrière un reverse proxy, il faudra déclarer le proxy de confiance, sinon toutes les requêtes auront l'IP du proxy.
- La route publique `/health` n'expose plus la version.
- Les réglages communs sont dans `configureApp`, utilisée par `main.ts` **et** par les tests : on teste exactement ce qui tourne.
